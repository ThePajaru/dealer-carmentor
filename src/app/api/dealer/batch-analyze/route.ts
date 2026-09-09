import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDealerAuth, dealerAnalysesRemaining, AuthError } from '@/lib/dealer-auth';
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

    let body: { urls: string[]; client_request_id?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const urls = (body.urls || [])
      .map((u: string) => u.trim())
      .filter((u: string) => u.length > 0);

    if (urls.length === 0) {
      return NextResponse.json({ error: 'No URLs provided' }, { status: 400 });
    }

    if (urls.length > 25) {
      return NextResponse.json({ error: 'Máximo 25 URLs por lote' }, { status: 400 });
    }

    const remaining = dealerAnalysesRemaining(dealerProfile);
    if (remaining < urls.length) {
      return NextResponse.json({
        error: remaining === 0
          ? 'Has agotado tus análisis. Suscríbete para seguir analizando.'
          : `Solo te quedan ${remaining} análisis. Has enviado ${urls.length} URLs.`,
      }, { status: 429 });
    }

    const results: { url: string; lead_id: string | null; status: 'queued' | 'error'; error?: string }[] = [];

    for (const url of urls) {
      const { data: lead, error: leadError } = await supabase
        .from('dealer_leads')
        .insert({
          dealer_id: dealerProfile.id,
          source_url: url,
          client_request_id: body.client_request_id || null,
          source: 'manual',
        })
        .select('id')
        .single();

      if (leadError) {
        results.push({ url, lead_id: null, status: 'error', error: 'Error al crear lead' });
        continue;
      }

      results.push({ url, lead_id: lead.id, status: 'queued' });
    }

    const queuedLeads = results.filter(r => r.status === 'queued');

    // Fire off analyses after the response is sent. after() (Next 15) makes Vercel
    // keep the invocation alive until these finish — the old fire-and-forget version
    // got frozen nondeterministically once the response returned, losing the
    // lead→analysis link for whichever watchers hadn't finished (2026-07-08, Marc's
    // 4-link batch: 2 of 4 leads never linked despite all 4 analyses completing).
    // The real link now happens inside /api/analyze itself (lead_id param); this
    // watcher is a redundant fallback and drains the stream so the child sees a
    // connected client for the whole run.
    // El motor de analisis vive en la app de consumo (carmentor.es), no aqui.
    // CARMENTOR_ENGINE_URL apunta alli; NEXT_PUBLIC_BASE_URL es el dominio propio.
    const baseUrl = (process.env.CARMENTOR_ENGINE_URL || 'http://localhost:3000').replace(/\/+$/, '');
    // Generaciones elegidas en el cuestionario: se leen UNA vez para todo el lote.
    const generationHints = await fetchGenerationHints(supabase, body.client_request_id);
    for (const item of queuedLeads) {
      after(() =>
        analyzeInBackground(baseUrl, token, item.url, item.lead_id!, dealerProfile.dealers_only_comps, {
          dealerId: dealerProfile.id,
          requestId: body.client_request_id || null,
        }, generationHints).catch(err =>
          console.error(`Batch analyze error for ${item.url}:`, err)
        )
      );
    }

    // Update usage count
    await supabase
      .from('dealer_profiles')
      .update({
        analyses_used: dealerProfile.analyses_used + queuedLeads.length,
        updated_at: new Date().toISOString(),
      })
      .eq('id', dealerProfile.id);

    return NextResponse.json({
      ok: true,
      total: urls.length,
      queued: queuedLeads.length,
      results,
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

async function analyzeInBackground(
  baseUrl: string,
  token: string,
  url: string,
  leadId: string,
  dealersOnlyComps: boolean,
  ctx: { dealerId: string; requestId: string | null },
  generationHints: Array<{ make: string; model: string; generation: string }> = [],
) {
  try {
    const res = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        url, dealersOnlyComps, lead_id: leadId,
        ...(generationHints.length ? { generationHints } : {}),
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`Batch analyze: /api/analyze returned ${res.status} for lead ${leadId}: ${errText.slice(0, 300)}`);
      return;
    }

    let analysisId: string | null = null;

    // Dedupe (200 duplicate) and in-progress (202) responses are plain JSON, not
    // SSE — the old parser silently ignored them and the lead never linked.
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json().catch(() => null);
      if (data?.analysis_id) analysisId = data.analysis_id;
    } else {
      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
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
    }

    // Fallback link — /api/analyze already links via lead_id; this is idempotent.
    if (analysisId) {
      await supabase
        .from('dealer_leads')
        .update({ analysis_id: analysisId, updated_at: new Date().toISOString() })
        .eq('id', leadId);

      const { data: ca } = await supabase
        .from('car_analyses')
        .select('title')
        .eq('id', analysisId)
        .maybeSingle();
      logDealerEvent(supabase, {
        dealer_id: ctx.dealerId,
        request_id: ctx.requestId,
        type: 'analisis_completado',
        payload: { title: (ca as any)?.title ?? null },
      });
    }
  } catch (err) {
    console.error(`Background analysis failed for lead ${leadId}:`, err);
  }
}
