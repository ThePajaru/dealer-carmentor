import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDealerAuth, AuthError } from '@/lib/dealer-auth';
import { fetchGenerationHints } from '@/lib/dealer/generation-hints';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const maxDuration = 300;

/**
 * Re-run the analysis for an existing lead that never got one (lost link or
 * failed analysis). Does NOT increment analyses_used — the lead was already
 * counted when it was queued. Returns immediately; /api/analyze links the lead
 * itself (lead_id param) and the case page polls until it appears.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { dealerProfile, token } = await requireDealerAuth(request);
    const { id } = await params;

    const { data: lead, error } = await supabase
      .from('dealer_leads')
      .select('id, source_url, analysis_id, client_request_id, car_analyses(result_json)')
      .eq('id', id)
      .eq('dealer_id', dealerProfile.id)
      .maybeSingle();

    if (error) {
      console.error('Retry: error fetching lead:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al obtener lead' }, { status: 500 });
    }
    if (!lead) return NextResponse.json({ error: 'Lead no encontrado' }, { status: 404 });
    if (!lead.source_url) return NextResponse.json({ error: 'El lead no tiene URL' }, { status: 400 });

    // Only retry leads that are actually stuck: no analysis, or one that failed /
    // never completed. A lead with a completed analysis has nothing to retry.
    const linked: any = lead.car_analyses;
    const linkedResult = Array.isArray(linked) ? linked[0]?.result_json : linked?.result_json;
    const isCompleted = linkedResult
      && linkedResult.status !== 'in_progress'
      && linkedResult.status !== 'failed'
      && !linkedResult.error
      && (linkedResult.ficha_tecnica_inicial || linkedResult.investigacion_mercado || linkedResult.analisis_rentabilidad || linkedResult.recomendacion_final);
    if (lead.analysis_id && isCompleted) {
      return NextResponse.json({ error: 'El análisis ya está completado' }, { status: 409 });
    }

    // El motor de analisis vive en la app de consumo (carmentor.es), no aqui.

    // CARMENTOR_ENGINE_URL apunta alli; NEXT_PUBLIC_BASE_URL es el dominio propio.

    const baseUrl = (process.env.CARMENTOR_ENGINE_URL || 'http://localhost:3000').replace(/\/+$/, '');
    // Misma generación elegida en el cuestionario que en el análisis normal: un
    // reintento tiene que acotar los comparables igual que el primer intento.
    const generationHints = await fetchGenerationHints(supabase, lead.client_request_id);
    after(async () => {
      try {
        const res = await fetch(`${baseUrl}/api/analyze`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            url: lead.source_url,
            dealersOnlyComps: dealerProfile.dealers_only_comps,
            lead_id: lead.id,
            ...(generationHints.length ? { generationHints } : {}),
          }),
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.error(`Retry: /api/analyze returned ${res.status} for lead ${lead.id}: ${errText.slice(0, 300)}`);
          return;
        }
        // Drain so the child streams to a connected client; it links the lead itself.
        if (res.body) {
          const reader = res.body.getReader();
          while (true) {
            const { done } = await reader.read();
            if (done) break;
          }
        }
      } catch (err) {
        console.error(`Retry: background analysis failed for lead ${lead.id}:`, err);
      }
    });

    return NextResponse.json({ ok: true, lead_id: lead.id });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
