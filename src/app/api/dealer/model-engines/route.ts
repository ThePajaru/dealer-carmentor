import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  extractDesignations, commercialPrefix,
  type DesignationRow, type Designation,
} from '@/lib/dealer/engine-designations';

// Público: designaciones de motor (320d, 1.6 TDI) con sus CV reales, para el paso
// «¿Qué motor?» del formulario de captación. La gente pide «un 320d», no «150 CV».
//
// Consulta el dataset EEA en vivo (eu_vehicle_emissions) filtrando por marca +
// prefijo de nombre comercial + rango de años (el de la generación elegida), y
// agrupa en designaciones con src/lib/dealer/engine-designations. Cacheado en
// memoria mientras la lambda esté caliente (los datos apenas cambian).
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const g = globalThis as unknown as { __modelEnginesCache?: Map<string, Designation[]> };
const cache: Map<string, Designation[]> = g.__modelEnginesCache || (g.__modelEnginesCache = new Map());

const makeToken = (make: string) => (make.split(/[^a-zA-Z0-9]/)[0] || '').toUpperCase();

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const make = (url.searchParams.get('make') || '').trim();
  const model = (url.searchParams.get('model') || '').trim();
  if (!make || !model) return NextResponse.json({ engines: [] });

  const yearFrom = parseInt(url.searchParams.get('yearFrom') || '', 10);
  const yearTo = parseInt(url.searchParams.get('yearTo') || '', 10);
  const yf = Number.isFinite(yearFrom) ? yearFrom : null;
  const yt = Number.isFinite(yearTo) ? yearTo : null;
  const fuel = url.searchParams.get('fuel') || null;

  const makeNorm = make.toLowerCase().trim();
  const key = `${makeNorm}|${model.toLowerCase()}|${yf ?? '*'}|${yt ?? '*'}|${fuel ?? ''}`;
  const cached = cache.get(key);
  if (cached) return NextResponse.json({ engines: cached, cached: true });

  try {
    let q = supabase
      .from('eu_vehicle_emissions')
      .select('commercial_name, displacement_cc, power_kw, fuel_type')
      .ilike('make', `${makeToken(make)}%`)
      .ilike('commercial_name', `${commercialPrefix(makeNorm, model)}%`)
      .not('power_kw', 'is', null)
      .limit(9000);
    if (yf != null) q = q.gte('registration_year', yf);
    if (yt != null) q = q.lte('registration_year', yt);

    const { data, error } = await q;
    if (error) {
      console.error('model-engines error:', JSON.stringify(error));
      return NextResponse.json({ engines: [] });
    }

    let engines = extractDesignations(makeNorm, (data || []) as DesignationRow[]);
    // Si el cliente ya fijó combustible, se queda solo con ese.
    if (fuel) engines = engines.filter((e) => e.fuel === fuel);

    cache.set(key, engines);
    return NextResponse.json({ engines, cached: false });
  } catch (e) {
    console.error('model-engines error:', e);
    return NextResponse.json({ engines: [] });
  }
}
