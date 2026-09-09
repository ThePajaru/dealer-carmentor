import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Public: real engine powers (CV) available for a make+model, from the EEA
// registration dataset (via the model_engine_powers SQL function). Powers the
// dynamic "¿Qué motor?" step in the client questionnaire — both overall and
// broken down per fuel (so after picking a fuel we show that fuel's engines).
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface PowersResult {
  powers: number[];
  byFuel: Record<string, number[]>;
  /**
   * true = no había matriculaciones en los años pedidos y se ha ampliado a todos
   * los años del modelo. El dataset europeo de CO2 arranca en 2010 y la carga
   * actual tiene huecos, así que un coche de 2006 no tiene datos propios; enseñar
   * los motores conocidos del modelo es infinitamente mejor que un hueco vacío,
   * pero el formulario tiene que decirlo en vez de fingir precisión.
   */
  widened?: boolean;
}

// Reference data barely changes → cache per make|model|year while the lambda is warm.
const g = globalThis as unknown as { __modelPowersCache?: Map<string, PowersResult> };
const cache: Map<string, PowersResult> = g.__modelPowersCache || (g.__modelPowersCache = new Map());

// EEA fuel_type code → the questionnaire's fuel enum(s). GyE/DyE (petrol/diesel +
// electric) map to both HYBRID and HYBRID_PLUGIN since the dataset can't tell them
// apart. `M` (a tiny bucket) is ignored.
const FUEL_MAP: Record<string, string[]> = {
  G: ['PETROL'],
  D: ['DIESEL'],
  Elc: ['ELECTRICITY'],
  GyE: ['HYBRID', 'HYBRID_PLUGIN'],
  DyE: ['HYBRID', 'HYBRID_PLUGIN'],
};

// Turn a cv→count map into the most-common powers, low→high (drops rare noise).
function topPowers(byCv: Map<number, number>, limit = 16): number[] {
  return [...byCv.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([cv]) => cv)
    .sort((a, b) => a - b);
}

const EMPTY: PowersResult = { powers: [], byFuel: {} };

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const make = (url.searchParams.get('make') || '').trim();
  const model = (url.searchParams.get('model') || '').trim();
  if (!make || !model) return NextResponse.json(EMPTY);

  // La franja de años que pide el cliente acota la generación: sin esto, a quien
  // busca un Golf de 2016 le enseñábamos los motores del Golf VIII. Se abre un año
  // por cada lado porque las matriculaciones van por detrás del lanzamiento del
  // modelo y por delante del final de producción.
  const intParam = (name: string): number | null => {
    const v = parseInt(url.searchParams.get(name) || '', 10);
    return Number.isFinite(v) ? v : null;
  };
  const from = intParam('yearFrom');
  const to = intParam('yearTo');
  const yearFrom = from != null ? from - 1 : null;
  const yearTo = to != null ? to + 1 : null;

  const key = `${make.toLowerCase()}|${model.toLowerCase()}|${yearFrom ?? '*'}|${yearTo ?? '*'}`;
  const cached = cache.get(key);
  if (cached) return NextResponse.json(cached);

  const query = (a: number | null, b: number | null) =>
    supabase.rpc('model_engine_powers', {
      p_make: make, p_model: model, p_year_from: a, p_year_to: b,
    });

  const first = await query(yearFrom, yearTo);
  if (first.error) {
    console.error('model-powers error:', JSON.stringify(first.error));
    return NextResponse.json(EMPTY);
  }
  let data = first.data;

  // Sin datos en esa franja (coches anteriores a 2010, o años que aún no se han
  // importado): se amplía a todos los años del modelo en vez de dejar el paso en
  // blanco. Los motores de un modelo no cambian cada año; enseñar los de los años
  // vecinos acierta casi siempre y siempre bate a no enseñar nada.
  let widened = false;
  if ((data || []).length === 0 && (yearFrom != null || yearTo != null)) {
    const retry = await query(null, null);
    if (!retry.error && (retry.data || []).length > 0) {
      data = retry.data;
      widened = true;
    }
  }

  const all = new Map<number, number>();
  const perFuel: Record<string, Map<number, number>> = {};
  for (const row of (data || []) as { cv: number; fuel: string; n: number }[]) {
    if (row.cv == null) continue;
    const n = Number(row.n);
    all.set(row.cv, (all.get(row.cv) || 0) + n);
    for (const f of FUEL_MAP[row.fuel] || []) {
      (perFuel[f] ||= new Map()).set(row.cv, (perFuel[f].get(row.cv) || 0) + n);
    }
  }

  const byFuel: Record<string, number[]> = {};
  for (const [f, m] of Object.entries(perFuel)) byFuel[f] = topPowers(m);

  const result: PowersResult = { powers: topPowers(all), byFuel, widened };
  cache.set(key, result);
  return NextResponse.json(result);
}
