import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'crypto';
import { getDealerProfileBySlug } from '@/lib/dealer-auth';
import { buildMobileDeSearchUrl } from '@/lib/mobile-de-search';
import { MAKES, FUELS, TRANSMISSIONS, COLORS } from '@/lib/mobile-de-search';
import { notifyDealerNewClient } from '@/lib/dealer-notifications';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface TallyField {
  key: string;
  label: string;
  type: string;
  value: unknown;
  options?: { id: string; text: string }[];
}

interface TallyPayload {
  eventId: string;
  eventType: 'FORM_RESPONSE';
  createdAt: string;
  data: {
    responseId: string;
    submissionId: string;
    respondentId: string;
    formId: string;
    formName: string;
    createdAt: string;
    fields: TallyField[];
  };
}

function findField(fields: TallyField[], label: string): string {
  const normalized = label.toLowerCase();
  const field = fields.find(f => f.label.toLowerCase().includes(normalized));
  if (!field || field.value == null) return '';
  if (Array.isArray(field.value)) {
    return field.value.map((v: { id?: string; text?: string } | string) =>
      typeof v === 'object' && v !== null ? (v.text ?? '') : String(v)
    ).filter(Boolean).join(', ');
  }
  return String(field.value);
}

function findChoices(fields: TallyField[], label: string): string[] {
  const normalized = label.toLowerCase();
  const field = fields.find(f => f.label.toLowerCase().includes(normalized));
  if (!field || !field.value) return [];
  if (Array.isArray(field.value)) {
    return field.value.map((v: { id?: string; text?: string } | string) =>
      typeof v === 'object' && v !== null ? (v.text ?? '') : String(v)
    ).filter(Boolean);
  }
  return [String(field.value)];
}

function resolveMake(name: string) {
  if (!name) return { make: null, make_id: null };
  const lower = name.toLowerCase().trim();
  const found = MAKES.find(m => m.label.toLowerCase() === lower);
  return found
    ? { make: found.label, make_id: found.id }
    : { make: name.trim(), make_id: null };
}

function resolveModel(makeId: number | null, name: string) {
  if (!name || !makeId) return { model: name || null, model_id: null, model_ms: undefined as string | undefined };
  const make = MAKES.find(m => m.id === makeId);
  if (!make) return { model: name, model_id: null, model_ms: undefined };
  const lower = name.toLowerCase().trim();
  const found = make.models.find(m => m.label.toLowerCase() === lower);
  return found
    ? { model: found.label, model_id: found.id, model_ms: found.ms }
    : { model: name.trim(), model_id: null, model_ms: undefined };
}

function resolveFuel(name: string): string | null {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  if (lower.includes('da igual') || lower.includes('indiferente')) return null;
  const found = FUELS.find(f => f.label.toLowerCase() === lower);
  return found ? found.value : null;
}

function resolveTransmission(name: string): string | null {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  if (lower.includes('da igual') || lower.includes('indiferente')) return null;
  const found = TRANSMISSIONS.find(t => t.label.toLowerCase() === lower);
  return found ? found.value : null;
}

function resolveColor(name: string): string | null {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  if (lower.includes('da igual') || lower.includes('indiferente')) return null;
  const found = COLORS.find(c => c.label.toLowerCase() === lower);
  return found ? found.value : null;
}

function parseNumber(val: string): number | null {
  if (!val) return null;
  const cleaned = val.replace(/[^0-9]/g, '');
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? null : n;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // Signature verification (opt-in): when TALLY_SIGNING_SECRET is set, reject
  // any payload whose `tally-signature` header (HMAC-SHA256 of the raw body,
  // base64) doesn't match. Without it, anyone who discovers this URL can inject
  // fake leads into dealer accounts. Configure the same secret in the Tally
  // webhook settings ("Signing secret") and in Vercel env.
  const signingSecret = process.env.TALLY_SIGNING_SECRET;
  if (signingSecret) {
    const receivedSignature = request.headers.get('tally-signature') || '';
    const expectedSignature = createHmac('sha256', signingSecret).update(rawBody).digest('base64');
    const received = Buffer.from(receivedSignature);
    const expected = Buffer.from(expectedSignature);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      console.error('Tally webhook: invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } else {
    console.warn('Tally webhook: TALLY_SIGNING_SECRET not set — accepting unsigned payloads');
  }

  let payload: TallyPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (payload.eventType !== 'FORM_RESPONSE') {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const fields = payload.data.fields;

  const slug = findField(fields, 'slug') || findField(fields, 'dealer');
  const clientName = findField(fields, 'nombre');
  const clientPhone = findField(fields, 'whatsapp') || findField(fields, 'teléfono') || findField(fields, 'telefono');
  const clientEmail = findField(fields, 'email') || findField(fields, 'correo');

  if (!slug || !clientName) {
    console.error('Tally webhook: missing slug or client_name', { slug, clientName });
    return NextResponse.json({ error: 'Missing required fields (slug, nombre)' }, { status: 400 });
  }

  const dealer = await getDealerProfileBySlug(slug.trim());
  if (!dealer) {
    console.error('Tally webhook: dealer not found for slug:', slug);
    return NextResponse.json({ error: 'Dealer not found' }, { status: 404 });
  }

  const makeRaw = findField(fields, 'marca');
  const modelRaw = findField(fields, 'modelo');
  const { make, make_id } = resolveMake(makeRaw);
  const { model, model_id, model_ms } = resolveModel(make_id, modelRaw);

  const fuel = resolveFuel(findField(fields, 'combustible'));
  const transmission = resolveTransmission(
    findField(fields, 'cambio') || findField(fields, 'transmisión') || findField(fields, 'transmision')
  );
  const color = resolveColor(findField(fields, 'color'));

  const maxPrice = parseNumber(findField(fields, 'presupuesto') || findField(fields, 'precio'));
  const maxKm = parseNumber(findField(fields, 'kilómetro') || findField(fields, 'km'));
  const minYear = parseNumber(findField(fields, 'año') || findField(fields, 'year'));
  const minCv = parseNumber(findField(fields, 'potencia') || findField(fields, 'cv'));

  const notes = findField(fields, 'nota') || findField(fields, 'extra') || findField(fields, 'algo más');

  const mobileUrl = buildMobileDeSearchUrl({
    makeId: make_id ?? undefined,
    modelMs: model_ms,
    maxPrice: maxPrice ?? undefined,
    maxKm: maxKm ?? undefined,
    minYear: minYear ?? undefined,
    fuel: fuel ?? undefined,
    transmission: transmission ?? undefined,
    minCv: minCv ?? undefined,
    color: color ?? undefined,
  });

  // Auto-group by phone: find or create dealer_client
  let clientId: string | null = null;
  const phone = clientPhone?.trim() || null;

  if (phone) {
    const { data: existing } = await supabase
      .from('dealer_clients')
      .select('id')
      .eq('dealer_id', dealer.id)
      .eq('phone', phone)
      .single();

    if (existing) {
      clientId = existing.id;
      await supabase
        .from('dealer_clients')
        .update({ name: clientName.trim(), email: clientEmail?.trim() || undefined, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      const { data: newClient } = await supabase
        .from('dealer_clients')
        .insert({
          dealer_id: dealer.id,
          name: clientName.trim(),
          phone,
          email: clientEmail?.trim() || null,
        })
        .select('id')
        .single();
      clientId = newClient?.id || null;
    }
  }

  // Wrap the single Tally spec into the vehicles[] array (mirrors the flat
  // columns). Tally forms carry one car; multi-vehicle comes from the web
  // questionnaire / dealer intake.
  const vehicles = (make || model || maxPrice || maxKm || minYear || fuel || mobileUrl)
    ? [{
        make: make ?? null, model: model ?? null,
        make_id: make_id ?? null, model_id: model_id ?? null, model_ms: null,
        max_price: maxPrice ?? null, max_km: maxKm ?? null, min_year: minYear ?? null,
        fuel: fuel ?? null, transmission: transmission ?? null,
        min_cv: minCv ?? null, color: color ?? null, body_type: null,
        mobile_url: mobileUrl ?? null,
      }]
    : [];

  const { data: insertedRequest, error: insertError } = await supabase
    .from('dealer_client_requests')
    .insert({
      dealer_id: dealer.id,
      client_id: clientId,
      client_name: clientName.trim(),
      client_phone: phone,
      client_email: clientEmail?.trim() || null,
      vehicles,
      make,
      make_id,
      model,
      model_id,
      max_price: maxPrice,
      max_km: maxKm,
      min_year: minYear,
      fuel,
      transmission,
      min_cv: minCv,
      color,
      notes: notes?.trim() || null,
      mobile_url: mobileUrl,
      status: 'nuevo',
    })
    .select()
    .single();

  if (insertError) {
    console.error('Tally webhook: insert error:', JSON.stringify(insertError));
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  // Notify dealer by email
  const dealerEmail = (dealer as any).notify_email || (dealer as any).email;
  if (dealerEmail && (dealer as any).notify_new_request !== false) {
    notifyDealerNewClient({
      dealerEmail,
      dealerName: dealer.business_name,
      clientName: clientName.trim(),
      clientPhone: phone,
      make,
      model,
      maxPrice,
      fuel,
      requestId: insertedRequest?.id || '',
    }).catch(err => console.error('Notification error:', err));
  }

  return NextResponse.json({ ok: true });
}
