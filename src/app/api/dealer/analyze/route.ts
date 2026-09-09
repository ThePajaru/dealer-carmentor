import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDealerAuth, canDealerAnalyze, AuthError } from '@/lib/dealer-auth';
import { logDealerEvent } from '@/lib/dealer/events';
import { fetchGenerationHints } from '@/lib/dealer/generation-hints';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { dealerProfile, token } = await requireDealerAuth(request);

    if (!canDealerAnalyze(dealerProfile)) {
      return NextResponse.json({
        error: dealerProfile.plan_status === 'active'
          ? 'Has alcanzado el límite de análisis de tu plan este mes.'
          : 'Has agotado tus análisis de prueba. Suscríbete para seguir analizando.',
      }, { status: 429 });
    }

    let body: { url: string; client_name?: string; client_phone?: string; client_request_id?: string; stock?: boolean };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (!body.url?.trim()) {
      return NextResponse.json({ error: 'URL es obligatoria' }, { status: 400 });
    }

    // Stock mode (Analizar workbench): a speculative analysis with no customer.
    // Skip the dealer_leads row — a lead means "candidate for a client request".
    // The result is ephemeral until the dealer saves it to dealer_stock or
    // promotes it to an operación. We still stream and still count the quota.
    let lead: { id: string } | null = null;
    if (!body.stock) {
      const { data, error: leadError } = await supabase
        .from('dealer_leads')
        .insert({
          dealer_id: dealerProfile.id,
          source_url: body.url.trim(),
          client_name: body.client_name || null,
          client_phone: body.client_phone || null,
          // Attach to the operación so the analyzed car shows under the client.
          // (Batch-analyze already does this; the single path silently dropped it.)
          client_request_id: body.client_request_id || null,
          source: 'manual',
        })
        .select()
        .single();

      if (leadError) {
        console.error('Error creating lead:', JSON.stringify(leadError));
        return NextResponse.json({ error: 'Error al crear lead' }, { status: 500 });
      }
      lead = data;
    }

    const generationHints = await fetchGenerationHints(supabase, body.client_request_id);

    // El motor de analisis vive en la app de consumo (carmentor.es), no aqui.

    // CARMENTOR_ENGINE_URL apunta alli; NEXT_PUBLIC_BASE_URL es el dominio propio.

    const baseUrl = (process.env.CARMENTOR_ENGINE_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const analyzeRes = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      // lead_id: /api/analyze persists the lead link itself at completion, so the
      // link survives even if the browser disconnects and this proxy stream dies.
      body: JSON.stringify({
        url: body.url.trim(),
        dealersOnlyComps: dealerProfile.dealers_only_comps,
        lead_id: lead?.id,
        ...(generationHints.length ? { generationHints } : {}),
      }),
    });

    if (!analyzeRes.ok) {
      const err = await analyzeRes.text();
      console.error('Analysis failed:', err);
      return NextResponse.json({ error: 'Error en el análisis' }, { status: 502 });
    }

    // Dedupe (200 duplicate) / in-progress (202) short-circuits answer with JSON,
    // not SSE. Synthesize the `complete` event the client expects — otherwise the
    // JSON body gets piped through under an SSE content-type and never parses.
    const childType = analyzeRes.headers.get('content-type') || '';
    if (childType.includes('application/json')) {
      const data = await analyzeRes.json().catch(() => null);
      const analysisId: string | null = data?.analysis_id || null;
      if (analysisId && lead) {
        // Fallback — /api/analyze already links via lead_id.
        await supabase
          .from('dealer_leads')
          .update({ analysis_id: analysisId, updated_at: new Date().toISOString() })
          .eq('id', lead.id);
      }
      const sseHeaders: Record<string, string> = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      };
      if (lead) sseHeaders['X-Lead-Id'] = lead.id;
      return new Response(
        `data: ${JSON.stringify({ type: 'complete', analysis_id: analysisId, message: data?.message || 'Análisis existente encontrado' })}\n\n`,
        { headers: sseHeaders },
      );
    }

    const reader = analyzeRes.body?.getReader();
    if (!reader) {
      return NextResponse.json({ error: 'No stream from analysis' }, { status: 502 });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const decoder = new TextDecoder();
        let buffer = '';
        let analysisId: string | null = null;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            controller.enqueue(value);

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const parsed = JSON.parse(line.slice(6));
                  if (parsed.type === 'complete' && parsed.analysis_id) {
                    analysisId = parsed.analysis_id;
                  }
                } catch {}
              }
            }
          }

          if (analysisId) {
            if (lead) {
              await supabase
                .from('dealer_leads')
                .update({ analysis_id: analysisId, updated_at: new Date().toISOString() })
                .eq('id', lead.id);
            }

            await supabase
              .from('dealer_profiles')
              .update({
                analyses_used: dealerProfile.analyses_used + 1,
                updated_at: new Date().toISOString(),
              })
              .eq('id', dealerProfile.id);

            const { data: ca } = await supabase
              .from('car_analyses')
              .select('title')
              .eq('id', analysisId)
              .maybeSingle();
            logDealerEvent(supabase, {
              dealer_id: dealerProfile.id,
              request_id: body.client_request_id || null,
              type: 'analisis_completado',
              payload: { client_name: body.client_name || null, title: (ca as any)?.title ?? null },
            });
          }
        } finally {
          controller.close();
        }
      },
    });

    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    };
    if (lead) headers['X-Lead-Id'] = lead.id;

    return new Response(stream, { headers });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
