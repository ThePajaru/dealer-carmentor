import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireDealerAuth, AuthError } from '@/lib/dealer-auth';

// Motorization reliability advisory: given a make/model (+ year range, optional
// fuel) with no specific engine chosen, recommend which motorization is most
// reliable and which to avoid. Dealer-facing, cached.
//
// Grounded like the consumer app (src/lib/common-issues.ts): Gemini + Google
// Search + a required source URL per engine, instead of an ungrounded LLM tirando
// de memoria (Groq, que alucinaba correa/cadena y se inventaba motores en
// modelos de nicho — 2026-07-27). Además se le pasan los motores REALES del
// dataset EEA (model_engine_powers) como verdad de base, así no puede comentar
// motorizaciones que no existieron.

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const maxDuration = 30;

const FUEL_ENUM = ['PETROL', 'DIESEL', 'HYBRID', 'HYBRID_PLUGIN', 'ELECTRICITY'] as const;
const RELIABILITY_ENUM = ['alta', 'media', 'baja'] as const;

interface Engine {
  name: string;
  fuel: string | null;
  power_cv: number | null;
  reliability: 'alta' | 'media' | 'baja';
  note: string;
  avoid: boolean;
  source_url?: string | null;
}

// EEA fuel code → questionnaire fuel enum, para casar el dataset real con el
// combustible pedido y para etiquetar el listado que se le pasa a Gemini.
const EEA_FUEL_LABEL: Record<string, string> = {
  G: 'PETROL', D: 'DIESEL', Elc: 'ELECTRICITY', GyE: 'HYBRID', DyE: 'HYBRID',
};
interface Motorizations {
  recommended: string | null;
  summary: string;
  engines: Engine[];
  confidence: 'orientativo' | 'no_disponible';
}

const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');

export async function POST(request: NextRequest) {
  try {
    await requireDealerAuth(request);

    let body: { make?: string; model?: string; year_from?: number; year_to?: number; fuel?: string; engines?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const make = String(body.make || '').trim();
    const model = String(body.model || '').trim();
    if (!make || !model) {
      return NextResponse.json({ error: 'make y model son obligatorios' }, { status: 400 });
    }

    const yearFrom = Number.isFinite(body.year_from) ? Number(body.year_from) : null;
    const yearTo = Number.isFinite(body.year_to) ? Number(body.year_to) : null;
    const fuel = body.fuel && FUEL_ENUM.includes(body.fuel as typeof FUEL_ENUM[number]) ? body.fuel : null;

    // Engines the client explicitly asked for — Gemini MUST rate each one, even if
    // it's not among the most reliable, so the dealer always sees a verdict.
    const requested = Array.isArray(body.engines)
      ? [...new Set(body.engines.map((e) => String(e ?? '').trim()).filter(Boolean).slice(0, 4))]
      : [];

    const yearBucket = `${yearFrom ?? 'any'}-${yearTo ?? 'now'}`;
    const reqKey = requested.length ? `|req:${requested.map(norm).sort().join(',')}` : '';
    const cacheKey = `${norm(make)}|${norm(model)}|${yearBucket}|${fuel ?? ''}${reqKey}`;

    // 1) Cache hit (Groq or curated) → return instantly.
    const { data: cached } = await supabase
      .from('motorization_cache')
      .select('data')
      .eq('cache_key', cacheKey)
      .maybeSingle();

    if (cached?.data) {
      return NextResponse.json({ ...(cached.data as Motorizations), cached: true });
    }

    // 2) Generate with Gemini + Google Search, fundamentado en los motores reales.
    const result = await generateMotorizations(make, model, yearFrom, yearTo, fuel, requested);

    // Only cache real answers, never the empty fallback (so a transient
    // generation failure doesn't get frozen into the cache).
    if (result.confidence === 'orientativo' && result.engines.length > 0) {
      await supabase.from('motorization_cache').insert({
        cache_key: cacheKey,
        make, model, year_bucket: yearBucket, fuel,
        data: result, source: 'gemini',
      });
    }

    return NextResponse.json({ ...result, cached: false });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('motorizations error:', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

const EMPTY: Motorizations = { recommended: null, summary: '', engines: [], confidence: 'no_disponible' };

// Los motores que de verdad se matricularon (dataset EEA vía model_engine_powers),
// como verdad de base para que Gemini no comente motorizaciones inexistentes.
async function fetchRealEngines(
  make: string, model: string, yearFrom: number | null, yearTo: number | null, fuel: string | null,
): Promise<{ text: string; widened: boolean }> {
  let widened = false;
  try {
    const query = (a: number | null, b: number | null) =>
      supabase.rpc('model_engine_powers', {
        p_make: make, p_model: model, p_year_from: a, p_year_to: b,
      });

    let { data } = await query(yearFrom, yearTo);
    // Sin motores en esa franja se devolvía cadena vacía, y sin bloque de
    // MOTORES REALES el prompt se queda sin verdad de base justo donde más falta
    // hace: los coches viejos, que es donde el modelo más se inventa. Pasa
    // siempre con 2010 (la EEA publica ese año con `Ep (KW)` a NULL en las
    // 285.764 filas, medido 2026-08-15) y a menudo con 2011-2012 (60 %/75 % de
    // cobertura en origen). [model-powers](../model-powers/route.ts) ya ensancha
    // a todos los años en ese caso; aquí no se hacía.
    if ((data || []).length === 0 && (yearFrom != null || yearTo != null)) {
      const retry = await query(null, null);
      if (!retry.error && (retry.data || []).length > 0) {
        data = retry.data;
        widened = true;
      }
    }
    const rows = (data || []) as { cv: number; fuel: string; n: number }[];
    // Agrupa CV por combustible; si el cliente fijó combustible, filtra a ese.
    const byFuel: Record<string, Set<number>> = {};
    for (const r of rows) {
      if (r.cv == null) continue;
      const f = EEA_FUEL_LABEL[r.fuel];
      if (!f) continue;
      if (fuel && f !== fuel) continue;
      (byFuel[f] ||= new Set()).add(r.cv);
    }
    const parts = Object.entries(byFuel)
      .map(([f, cvs]) => `${f}: ${[...cvs].sort((a, b) => a - b).join(', ')} CV`);
    return { text: parts.join(' · '), widened };
  } catch {
    return { text: '', widened: false };
  }
}

async function generateMotorizations(
  make: string, model: string, yearFrom: number | null, yearTo: number | null, fuel: string | null,
  requested: string[] = [],
): Promise<Motorizations> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return EMPTY;

  const yearStr = yearFrom ? `del rango ${yearFrom}${yearTo ? `–${yearTo}` : ' en adelante'}` : '';
  const fuelStr = fuel ? ` Limítate a motores de combustible ${fuel}.` : '';
  const realEngines = await fetchRealEngines(make, model, yearFrom, yearTo, fuel);
  // Si la lista viene de ensanchar a todos los años, decirlo: son los motores del
  // modelo entero, no los de esta franja, así que sirven para no inventar pero no
  // para afirmar que un motor concreto se vendió en estos años.
  const realBlock = realEngines.text
    ? `\nMOTORES REALES (matriculaciones europeas EEA ${realEngines.widened
        ? 'de TODOS los años de este modelo — el dataset no cubre los años pedidos, así que úsalos solo para no inventar motorizaciones, NO para afirmar en qué año se ofreció cada una'
        : 'para este modelo y años'} — esta es la verdad de base, NO comentes motores que no estén aquí salvo que la búsqueda confirme que existió):\n${realEngines.text}\n`
    : '';

  // El cliente ya ha pedido motores concretos: han de salir SÍ o SÍ con su
  // veredicto (bueno o malo), aunque no sean los más fiables del modelo.
  const requestedBlock = requested.length
    ? `\nMOTORES QUE EL CLIENTE HA PEDIDO EXPRESAMENTE: ${requested.join(', ')}.\nDEBES incluir CADA UNO de estos motores en "engines" con su fiabilidad REAL y su "source_url", aunque no sean los más recomendables. Si uno es poco fiable, inclúyelo igual con "avoid": true y explica el fallo típico en "note". No los omitas por no ser los mejores — el cliente necesita saber si acierta o se equivoca con lo que ha pedido.\nEn el campo "name" de esos motores, EMPIEZA por la designación EXACTA que pidió el cliente, tal cual (p. ej. "323i"), y añade el código de motor y los CV entre paréntesis si los sabes ("323i (M52TU, 170 CV)"). NO lo sustituyas por el código interno a secas (M54B25, N42B20…): el cliente pidió "323i" y no reconoce el código, así que su designación debe encabezar el nombre.\n`
    : '';

  const prompt = `Eres un perito experto en fiabilidad de coches de segunda mano para el mercado español (importación desde Alemania).

Para el ${make} ${model} ${yearStr}, busca en Google qué motorizaciones concretas existieron y cuál es más fiable para comprar de segunda mano.${fuelStr}
${realBlock}${requestedBlock}
OBJETIVO: devolver SOLO fallos REALES documentados en fuentes fiables (foros del modelo, club oficial, ForoCoches, MotorPasion, recalls NHTSA, boletines técnicos TSB). Cada motor DEBE llevar una "source_url" REAL (URL completa que exista) que respalde su nota. Si no encuentras fuente para un motor, no lo incluyas.

REGLAS:
- Usa la búsqueda de Google obligatoriamente; no te fíes solo de tu memoria.
- NO INVENTES MOTORES ni combustibles. Incluye solo motorizaciones que de verdad se ofrecieron. Muchos deportivos y descapotables (Mazda MX-5, Toyota GT86) son SOLO gasolina; los modelos recientes a menudo ya no llevan diésel. Ante la duda, no lo incluyas.
- DISTRIBUCIÓN (correa vs cadena): no la afirmes salvo que la fuente lo diga. Muchos TDI y TSI modernos son de CORREA. Referencia cierta: EA189 (1.6/2.0 TDI 2009–2015) = correa; EA288 (2.0 TDI 2015+) = correa; EA211 (1.0/1.4/1.5 TSI 2012+) = correa; EA111 (1.2/1.4 TSI ~2010–2012) = cadena; EA888 gen2 = cadena; BMW N47 diésel = cadena trasera.

Responde SOLO JSON con esta estructura exacta:
{
  "recommended": "nombre exacto del motor más fiable (ej: '2.0 TDI (EA288)') o null si no hay datos",
  "summary": "una frase corta (máx 20 palabras) con la recomendación clave",
  "engines": [
    {
      "name": "nombre del motor (ej: '1.4 TSI (EA211)')",
      "fuel": "PETROL | DIESEL | HYBRID | HYBRID_PLUGIN | ELECTRICITY",
      "power_cv": número de CV o null,
      "reliability": "alta | media | baja",
      "note": "el motivo concreto en 1 frase corta (el fallo típico o por qué es fiable)",
      "avoid": true si es un motor a evitar por fiabilidad, false si no,
      "source_url": "URL completa de la fuente que respalda la nota"
    }
  ]
}

Máximo 6 motores, ordenados del más recomendable al menos (pero incluyendo SIEMPRE los que pidió el cliente). Solo JSON, sin markdown.`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const gModel = genAI.getGenerativeModel({
      model: 'gemini-3.1-flash-lite',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: [{ googleSearch: {} } as any],
      generationConfig: { temperature: 0.1 },
    });
    const res = await gModel.generateContent(prompt);
    const text = (res.response.text() || '').replace(/```json|```/g, '').trim();
    if (!text) return EMPTY;
    // Gemini a veces envuelve el JSON en prosa pese a pedirlo limpio.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const json = start >= 0 && end > start ? text.slice(start, end + 1) : text;
    return sanitize(JSON.parse(json));
  } catch (err) {
    console.error('Motorization generation failed:', err);
    return EMPTY;
  }
}

// Coerce the LLM output to our shape — never trust it raw.
function sanitize(raw: unknown): Motorizations {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rawEngines = Array.isArray(r.engines) ? r.engines : [];
  const engines: Engine[] = rawEngines.slice(0, 6).map((e) => {
    const o = (e ?? {}) as Record<string, unknown>;
    const fuel = typeof o.fuel === 'string' && FUEL_ENUM.includes(o.fuel as typeof FUEL_ENUM[number]) ? o.fuel : null;
    const reliability = typeof o.reliability === 'string' && RELIABILITY_ENUM.includes(o.reliability as typeof RELIABILITY_ENUM[number])
      ? (o.reliability as Engine['reliability']) : 'media';
    const power = Number(o.power_cv);
    const src = String(o.source_url || '').trim();
    return {
      name: String(o.name || '').trim().slice(0, 60),
      fuel,
      power_cv: Number.isFinite(power) && power > 0 ? Math.round(power) : null,
      reliability,
      note: String(o.note || '').trim().slice(0, 200),
      avoid: o.avoid === true,
      source_url: /^https?:\/\//.test(src) ? src.slice(0, 300) : null,
    };
  }).filter((e) => e.name);

  if (engines.length === 0) return EMPTY;

  const recommended = typeof r.recommended === 'string' && r.recommended.trim()
    ? r.recommended.trim().slice(0, 60)
    : (engines.find((e) => !e.avoid)?.name ?? null);

  return {
    recommended,
    summary: String(r.summary || '').trim().slice(0, 160),
    engines,
    confidence: 'orientativo',
  };
}
