import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDealerProfileBySlug } from '@/lib/dealer-auth';
import { normalizeVehicles, flatFromVehicles } from '@/lib/dealer-vehicles';
import { notifyDealerNewClient } from '@/lib/dealer-notifications';
import { logDealerEvent } from '@/lib/dealer/events';
import {
  buildAdvisorProfile,
  profileToVehicle,
  type AdvisorAnswers,
  type AdvisorProfile,
} from '@/lib/dealer/advisor-rules';

/**
 * Puerta B de la captación — el asesor de 7 preguntas.
 *
 * ORDEN DELIBERADO: la operación se crea ANTES de llamar a Gemini.
 * El cliente ya ha dejado su teléfono; si la IA tarda, falla o el cliente cierra
 * la pestaña al ver el resultado, el dealer conserva el lead igualmente. Los 3
 * modelos son la recompensa del cliente, no el requisito del negocio.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface AdvisorModel {
  nombre: string;
  precio_desde: number;
  precio_hasta: number;
  anos: string;
  porque: string;
}

const GEMINI_TIMEOUT_MS = 12000;

async function suggestModels(
  profile: AdvisorProfile,
  apiKey: string,
): Promise<AdvisorModel[]> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-3.1-flash-lite',
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
  });

  const budget = profile.maxPrice
    ? `${profile.minPrice ?? 0} € – ${profile.maxPrice} €`
    : 'sin techo definido';

  const prompt = `Eres un asesor de compra de coches de OCASIÓN en España. Un cliente ha completado un cuestionario y un motor de reglas ya ha cerrado su perfil. Tu único trabajo es proponer 3 modelos concretos que encajen EXACTAMENTE en ese perfil.

PERFIL CERRADO (no puedes salirte de aquí):
- Carrocería: ${profile.bodyLabel} (${profile.bodyType})
- Combustible: ${profile.fuelLabel}
- Cambio: ${profile.transmissionLabel ?? 'indiferente'}
- Plazas: ${profile.seats}
- Presupuesto: ${budget}
- Año mínimo: ${profile.minYear ?? 'sin restricción'}
- Km máximo: ${profile.maxKm ?? 'sin restricción'}

REGLAS CRÍTICAS:
- Los 3 modelos DEBEN ser de la carrocería y el combustible del perfil. Si el perfil dice Diésel, no propongas un híbrido. Si dice ${profile.bodyLabel}, no propongas otra cosa.
- Precios REALES del mercado de segunda mano español para ese año y ese estado. Deben caer dentro del presupuesto (o rozarlo por arriba como mucho un 8%, y en ese caso dilo en el "porque").
- Modelos que de verdad se encuentran en el mercado europeo de ocasión, con volumen. Nada exótico ni descatalogado hace 15 años.
- NO inventes anuncios concretos, ni URLs, ni matrículas, ni kilometrajes de un coche específico.
- "porque" = UNA frase, máximo 90 caracteres, en español de España, concreta y útil (por qué ESE frente a los otros dos). Nada de marketing vacío.
- Ordena del que mejor encaja al que menos.

Devuelve SOLO este JSON:
{"modelos":[{"nombre":"Marca Modelo motorización","precio_desde":00000,"precio_hasta":00000,"anos":"2019–2021","porque":"..."}]}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  const parsed = JSON.parse(text) as { modelos?: unknown };
  if (!Array.isArray(parsed.modelos)) return [];

  return parsed.modelos
    .slice(0, 3)
    .map((m) => {
      const o = m as Record<string, unknown>;
      const nombre = String(o.nombre ?? '').trim();
      const porque = String(o.porque ?? '').trim();
      const desde = Number(o.precio_desde);
      const hasta = Number(o.precio_hasta);
      if (!nombre) return null;
      return {
        nombre,
        precio_desde: Number.isFinite(desde) ? desde : 0,
        precio_hasta: Number.isFinite(hasta) ? hasta : 0,
        anos: String(o.anos ?? '').trim(),
        porque,
      };
    })
    .filter((m): m is AdvisorModel => m !== null);
}

/** Nota legible para el dealer — lo que verá si no abre el bloque del asesor. */
function buildNotes(a: AdvisorAnswers, p: AdvisorProfile): string {
  const lines = [`Vía asesor · perfil deducido: ${p.headline}, ${p.seats} plazas.`];
  if (a.timeframe) {
    const label = { ya: 'Ya · este mes', '1-3-meses': '1–3 meses', 'sin-prisa': 'Sin prisa' }[a.timeframe];
    if (label) lines.push(`Plazo: ${label}`);
  }
  if (a.payment) {
    const label = { contado: 'Al contado', financiado: 'Financiado', 'no-lo-se': 'Aún no lo sabe' }[a.payment];
    if (label) lines.push(`Pago: ${label}`);
  }
  if (a.tradeIn === 'si') lines.push('Entregaría su coche actual (a tasar).');
  return lines.join('\n');
}

export async function POST(request: NextRequest) {
  let body: {
    slug?: string;
    client_name?: string;
    client_phone?: string;
    answers?: AdvisorAnswers;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.slug?.trim() || !body.client_name?.trim() || !body.answers) {
    return NextResponse.json({ error: 'slug, nombre y respuestas son obligatorios' }, { status: 400 });
  }

  const dealer = await getDealerProfileBySlug(body.slug.trim());
  if (!dealer) {
    return NextResponse.json({ error: 'Dealer no encontrado' }, { status: 404 });
  }

  // 1. Reglas deterministas. Nada de IA todavía.
  const answers = body.answers;
  const profile = buildAdvisorProfile(answers);

  const vehicles = normalizeVehicles({ vehicles: [profileToVehicle(profile)] });
  const flat = flatFromVehicles(vehicles);

  // 2. Cliente (agrupado por teléfono, igual que el cuestionario).
  const phone = body.client_phone?.trim() || null;
  let clientId: string | null = null;

  if (phone) {
    const { data: existing } = await supabase
      .from('dealer_clients')
      .select('id')
      .eq('dealer_id', dealer.id)
      .eq('phone', phone)
      .maybeSingle();

    if (existing) {
      clientId = existing.id;
      await supabase
        .from('dealer_clients')
        .update({ name: body.client_name.trim(), updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      const { data: newClient } = await supabase
        .from('dealer_clients')
        .insert({ dealer_id: dealer.id, name: body.client_name.trim(), phone })
        .select('id')
        .single();
      clientId = newClient?.id || null;
    }
  }

  // 3. La operación entra AHORA — antes de que la IA opine.
  const { data: clientRequest, error: insertError } = await supabase
    .from('dealer_client_requests')
    .insert({
      dealer_id: dealer.id,
      client_id: clientId,
      client_name: body.client_name.trim(),
      client_phone: phone,
      vehicles,
      make: flat.make,
      make_id: flat.make_id,
      model: flat.model,
      model_id: flat.model_id,
      max_price: flat.max_price,
      max_km: flat.max_km,
      min_year: flat.min_year,
      fuel: flat.fuel,
      transmission: flat.transmission,
      min_cv: flat.min_cv,
      color: flat.color,
      body_type: flat.body_type,
      extras: profile.extras.length ? profile.extras : null,
      notes: buildNotes(answers, profile),
      mobile_url: flat.mobile_url,
      status: 'nuevo',
      source: 'advisor',
      advisor_answers: answers,
      advisor_profile: profile,
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('Error creating advisor request:', JSON.stringify(insertError));
    return NextResponse.json({ error: 'Error al crear la solicitud' }, { status: 500 });
  }

  logDealerEvent(supabase, {
    dealer_id: dealer.id,
    request_id: clientRequest.id,
    type: 'solicitud_nueva',
    payload: { client_name: body.client_name.trim(), source: 'asesor' },
  });

  const dealerEmail = (dealer as any).notify_email || (dealer as any).email;
  if (dealerEmail && (dealer as any).notify_new_request !== false) {
    notifyDealerNewClient({
      dealerEmail,
      dealerName: dealer.business_name,
      clientName: body.client_name.trim(),
      clientPhone: phone,
      make: null,
      model: profile.headline,
      maxPrice: profile.maxPrice,
      fuel: profile.fuelLabel,
      requestId: clientRequest.id,
    }).catch((err) => console.error('Notification error:', err));
  }

  // 4. Ahora sí, los 3 modelos. Si falla, el cliente ve su perfil igual.
  let models: AdvisorModel[] = [];
  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (apiKey) {
    try {
      models = await Promise.race([
        suggestModels(profile, apiKey),
        new Promise<AdvisorModel[]>((_, reject) =>
          setTimeout(() => reject(new Error('gemini timeout')), GEMINI_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      console.error('Advisor model suggestion failed:', err);
      models = [];
    }
  }

  if (models.length) {
    await supabase
      .from('dealer_client_requests')
      .update({ advisor_models: models })
      .eq('id', clientRequest.id);
  }

  return NextResponse.json({
    success: true,
    request_id: clientRequest.id,
    profile,
    models,
  }, { status: 201 });
}
