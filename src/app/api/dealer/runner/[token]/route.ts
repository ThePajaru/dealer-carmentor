import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendCustomerPing } from '@/lib/dealer-customer-ping';

// Public (no-auth) runner packet: the car + listing + inspection checklist for
// the runner who flies to Germany. Keyed by an unguessable token in the job's
// runner_packet. No dealer economics — the runner only needs what to inspect.
// The token also authorizes writes: photo uploads + submitting the field report.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const INSPECTIONS_BUCKET = 'dealer-inspections';

/* eslint-disable @typescript-eslint/no-explicit-any */

async function jobForToken(token: string) {
  const { data: job } = await supabase
    .from('dealer_client_requests')
    .select('id, dealer_id, runner_packet')
    .eq('runner_packet->>token', token)
    .maybeSingle();
  return job as any;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const { data: job } = await supabase
    .from('dealer_client_requests')
    .select('id, dealer_id, runner_packet, runner_report, runner_expenses')
    .eq('runner_packet->>token', token)
    .maybeSingle();

  const packetRef: any = (job as any)?.runner_packet;
  if (!job || !packetRef?.lead_id) {
    return NextResponse.json({ error: 'Ficha no encontrada' }, { status: 404 });
  }

  const { data: lead } = await supabase
    .from('dealer_leads')
    .select('analysis_id, car_analyses(title, car_image_url, result_json, source_url, country_of_origin)')
    .eq('id', packetRef.lead_id)
    .maybeSingle();

  if (!lead) return NextResponse.json({ error: 'Ficha no encontrada' }, { status: 404 });

  const ca: any = Array.isArray((lead as any).car_analyses) ? (lead as any).car_analyses[0] : (lead as any).car_analyses;
  const rj: any = ca?.result_json || {};
  const ficha = rj.ficha_tecnica_inicial || {};
  const images: string[] = Array.isArray(rj.car_images)
    ? rj.car_images.filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
    : [];

  const [{ data: cl }, { data: dealer }] = await Promise.all([
    supabase
      .from('car_inspection_checklists')
      .select('checklist_data')
      .eq('analysis_id', (lead as any).analysis_id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('dealer_profiles').select('business_name').eq('id', (job as any).dealer_id).maybeSingle(),
  ]);

  return NextResponse.json({
    packet: {
      dealer: (dealer as any)?.business_name || null,
      car: {
        title: ca?.title || ficha.marca_modelo || 'Vehículo',
        hero: images[0] || ca?.car_image_url || null,
        images,
        specs: {
          año: ficha.año || null,
          km: ficha.kilometraje || null,
          combustible: ficha.combustible || null,
          potencia: ficha.potencia || null,
          cambio: ficha.transmision || null,
          carroceria: ficha.carroceria || null,
        },
      },
      listing_url: ca?.source_url || null,
      country: ca?.country_of_origin || null,
      checklist: (cl as any)?.checklist_data || null,
      report: (job as any).runner_report || null,
      expenses: Array.isArray((job as any).runner_expenses) ? (job as any).runner_expenses : [],
    },
  });
}

// POST — token-authorized writes from the runner's phone.
//   { action:'upload', dataUrl }      → uploads one photo, returns { url }
//   { action:'submit', report }       → saves the field report + pings the customer
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const job = await jobForToken(token);
  if (!job) return NextResponse.json({ error: 'Ficha no encontrada' }, { status: 404 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }); }

  if (body.action === 'upload') {
    const dataUrl: string = body.dataUrl || '';
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
    if (!m) return NextResponse.json({ error: 'Imagen inválida' }, { status: 400 });
    const contentType = m[1];
    const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    const buffer = Buffer.from(m[2], 'base64');
    if (buffer.length > 12 * 1024 * 1024) return NextResponse.json({ error: 'Imagen demasiado grande' }, { status: 413 });

    const path = `${token}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(INSPECTIONS_BUCKET)
      .upload(path, buffer, { contentType, upsert: false });
    if (upErr) {
      console.error('Inspection photo upload failed:', JSON.stringify(upErr));
      return NextResponse.json({ error: 'No se pudo subir la foto' }, { status: 500 });
    }
    const { data: pub } = supabase.storage.from(INSPECTIONS_BUCKET).getPublicUrl(path);
    return NextResponse.json({ url: pub.publicUrl });
  }

  if (body.action === 'submit') {
    const r = body.report || {};
    const report = {
      submitted_at: new Date().toISOString(),
      verdict: ['comprar', 'no_comprar'].includes(r.verdict) ? r.verdict : null,
      final_price: r.final_price != null && !Number.isNaN(Number(r.final_price)) ? Number(r.final_price) : null,
      real_km: r.real_km != null && !Number.isNaN(Number(r.real_km)) ? Number(r.real_km) : null,
      notes: typeof r.notes === 'string' ? r.notes.slice(0, 4000) : '',
      items: Array.isArray(r.items) ? r.items.slice(0, 200).map((it: any) => ({
        id: String(it.id ?? ''),
        title: String(it.title ?? '').slice(0, 300),
        phase: String(it.phase ?? '').slice(0, 200),
        status: ['ok', 'issue', 'na'].includes(it.status) ? it.status : 'na',
        note: typeof it.note === 'string' ? it.note.slice(0, 1000) : '',
        photo_url: typeof it.photo_url === 'string' ? it.photo_url : null,
      })) : [],
      dealbreakers: Array.isArray(r.dealbreakers) ? r.dealbreakers.slice(0, 50).map((d: any) => ({
        text: String(d.text ?? '').slice(0, 500),
        status: ['ok', 'present'].includes(d.status) ? d.status : 'ok',
      })) : [],
      photos: Array.isArray(r.photos) ? r.photos.slice(0, 40)
        .filter((p: any) => typeof p?.url === 'string')
        .map((p: any) => ({ label: String(p.label ?? '').slice(0, 120), url: p.url })) : [],
      observations: Array.isArray(r.observations) ? r.observations.slice(0, 40)
        .filter((o: any) => typeof o?.text === 'string' && o.text.trim())
        .map((o: any) => ({
          step: String(o.step ?? '').slice(0, 60),
          title: String(o.title ?? '').slice(0, 200),
          text: o.text.trim().slice(0, 2000),
        })) : [],
    };

    const { error } = await supabase
      .from('dealer_client_requests')
      .update({ runner_report: report, updated_at: new Date().toISOString() })
      .eq('id', job.id);
    if (error) {
      console.error('Runner report save failed:', JSON.stringify(error));
      return NextResponse.json({ error: 'No se pudo guardar la inspección' }, { status: 500 });
    }

    // Ping the customer: "we inspected your car in person" (idempotent).
    await sendCustomerPing(supabase, job.id, 'inspeccion');

    return NextResponse.json({ ok: true });
  }

  // Runner-logged trip expenses (flight, fuel, hotel, tolls…) with an optional
  // receipt photo. Written straight to runner_expenses so the dealer sees them
  // pre-filled in the operation detail, where they roll up into the real cost.
  if (body.action === 'expenses') {
    const raw = Array.isArray(body.expenses) ? body.expenses : [];
    const expenses = raw
      .slice(0, 100)
      .map((e: any) => ({
        concept: String(e?.concept ?? '').trim().slice(0, 200),
        amount: Number(e?.amount) || 0,
        ticket_url: typeof e?.ticket_url === 'string' ? e.ticket_url : null,
      }))
      // Concept AND ticket photo are mandatory — a gasto missing either is
      // dropped, never persisted.
      .filter((e: any) => e.concept && e.ticket_url);

    const { error } = await supabase
      .from('dealer_client_requests')
      .update({ runner_expenses: expenses, updated_at: new Date().toISOString() })
      .eq('id', job.id);
    if (error) {
      console.error('Runner expenses save failed:', JSON.stringify(error));
      return NextResponse.json({ error: 'No se pudieron guardar los gastos' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Acción no soportada' }, { status: 400 });
}
