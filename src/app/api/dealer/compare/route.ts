import { NextRequest, NextResponse } from 'next/server';
import { requireDealerAuth, AuthError, dealerServiceClient } from '@/lib/dealer-auth';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);

    let body: { lead_ids: string[]; client_request_id?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (!body.lead_ids?.length || body.lead_ids.length < 2) {
      return NextResponse.json({ error: 'Se necesitan al menos 2 coches para comparar' }, { status: 400 });
    }

    if (body.lead_ids.length > 10) {
      return NextResponse.json({ error: 'Máximo 10 coches por comparación' }, { status: 400 });
    }

    const { data: leads } = await dealerServiceClient
      .from('dealer_leads')
      .select('id, source_url, is_shortlisted, car_analyses(id, title, car_image_url, result_json, source_url, country_of_origin)')
      .in('id', body.lead_ids)
      .eq('dealer_id', dealerProfile.id)
      .is('deleted_at', null);

    if (!leads?.length) {
      return NextResponse.json({ error: 'No se encontraron los coches' }, { status: 404 });
    }

    const cars = leads
      .filter((l: any) => l.car_analyses)
      .map((l: any) => {
        const a = l.car_analyses;
        const r = a.result_json || {};
        return {
          lead_id: l.id,
          title: a.title || r.titulo || 'Sin título',
          price: r.precio_publicado || r.precio || null,
          estimated_price: r.precio_venta_estimado || null,
          margin_pct: r.margen_porcentaje || null,
          year: r.año || r.matriculacion || null,
          km: r.kilometraje || null,
          fuel: r.combustible || null,
          power: r.potencia || null,
          pros: r.ventajas || [],
          cons: r.desventajas || [],
          score: r.puntuacion_global || r.score || null,
          country: a.country_of_origin || null,
          image: a.car_image_url || null,
          url: a.source_url || l.source_url,
          is_shortlisted: l.is_shortlisted,
        };
      });

    if (cars.length < 2) {
      return NextResponse.json({ error: 'Se necesitan al menos 2 coches analizados' }, { status: 400 });
    }

    // Group by make for double comparison
    const byMake: Record<string, typeof cars> = {};
    for (const car of cars) {
      const make = extractMake(car.title);
      if (!byMake[make]) byMake[make] = [];
      byMake[make].push(car);
    }

    const comparison = await generateComparison(cars, byMake);

    return NextResponse.json({
      comparison,
      cars,
      groups: Object.entries(byMake).map(([make, items]) => ({
        make,
        cars: items,
      })),
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

function extractMake(title: string): string {
  const parts = title.split(' ');
  if (parts.length >= 2 && ['mercedes', 'mercedes-benz'].includes(parts[0].toLowerCase())) return 'Mercedes-Benz';
  if (parts.length >= 2 && ['land', 'alfa'].includes(parts[0].toLowerCase())) return parts.slice(0, 2).join(' ');
  return parts[0] || 'Otro';
}

async function generateComparison(
  cars: any[],
  byMake: Record<string, any[]>,
): Promise<{
  cross_model: string;
  per_model: Record<string, string>;
  recommendation: string;
}> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return buildFallbackComparison(cars, byMake);
  }

  const carSummaries = cars.map((c, i) => {
    const parts = [
      `${i + 1}. ${c.title}`,
      c.price ? `Precio: ${c.price.toLocaleString('es-ES')}€` : null,
      c.estimated_price ? `Precio estimado venta: ${c.estimated_price.toLocaleString('es-ES')}€` : null,
      c.margin_pct ? `Margen: ${c.margin_pct}%` : null,
      c.year ? `Año: ${c.year}` : null,
      c.km ? `Km: ${c.km.toLocaleString('es-ES')}` : null,
      c.fuel ? `Combustible: ${c.fuel}` : null,
      c.power ? `Potencia: ${c.power}` : null,
      c.score ? `Puntuación: ${c.score}/10` : null,
      c.country ? `Origen: ${c.country}` : null,
      c.pros?.length ? `Pros: ${c.pros.join(', ')}` : null,
      c.cons?.length ? `Contras: ${c.cons.join(', ')}` : null,
    ].filter(Boolean).join('\n   ');
    return parts;
  }).join('\n\n');

  const prompt = `Eres un asesor experto en importación de coches de segunda mano para el mercado español.

Te doy ${cars.length} coches que un dealer ha analizado para un cliente. Genera una comparación profesional en español.

COCHES:
${carSummaries}

Responde en JSON con esta estructura exacta:
{
  "cross_model": "Comparación entre marcas/modelos diferentes (2-3 párrafos). Qué ofrece cada marca, pros y contras de cada opción como marca. Centrado en fiabilidad, coste de mantenimiento, valor de reventa, y margen del dealer.",
  "per_model": { "NombreMarca": "Ranking de los coches de esa marca (1-2 párrafos). Cuál es mejor relación calidad-precio, cuál tiene mejor margen, cuál tiene menos km o mejor equipamiento." },
  "recommendation": "Recomendación final clara (1 párrafo). Qué 2-3 coches enviarías al cliente y por qué. Incluye el nombre exacto del coche."
}

Solo JSON, sin markdown, sin bloques de código.`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      console.error('Groq comparison error:', await res.text());
      return buildFallbackComparison(cars, byMake);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return buildFallbackComparison(cars, byMake);

    return JSON.parse(content);
  } catch (err) {
    console.error('Comparison generation failed:', err);
    return buildFallbackComparison(cars, byMake);
  }
}

function buildFallbackComparison(cars: any[], byMake: Record<string, any[]>) {
  const sorted = [...cars].sort((a, b) => (b.score || 0) - (a.score || 0));
  const best = sorted[0];

  const crossModel = Object.keys(byMake).length > 1
    ? `Se comparan ${Object.keys(byMake).length} marcas: ${Object.keys(byMake).join(', ')}. Cada una ofrece características diferentes en fiabilidad, coste de mantenimiento y margen potencial.`
    : `Todos los coches son de la misma marca (${Object.keys(byMake)[0]}). La comparación se centra en equipamiento, km, año y margen.`;

  const perModel: Record<string, string> = {};
  for (const [make, items] of Object.entries(byMake)) {
    const sortedItems = [...items].sort((a, b) => (b.score || 0) - (a.score || 0));
    perModel[make] = sortedItems.map((c, i) =>
      `${i + 1}. ${c.title} — ${c.price ? c.price.toLocaleString('es-ES') + '€' : 'precio N/A'}${c.score ? ` (${c.score}/10)` : ''}`
    ).join('. ');
  }

  return {
    cross_model: crossModel,
    per_model: perModel,
    recommendation: best
      ? `Recomendación: ${best.title}${best.score ? ` con puntuación ${best.score}/10` : ''}${best.margin_pct ? ` y margen del ${best.margin_pct}%` : ''}.`
      : 'No hay suficientes datos para una recomendación clara.',
  };
}
