import { NextRequest, NextResponse } from 'next/server';
import { requireDealerAuth, AuthError, dealerServiceClient } from '@/lib/dealer-auth';
import { buildAnalysisView } from '@/lib/analysis-view';

// GET /api/dealer/analyses — every completed analysis the dealer has ever run,
// newest first. Workbench analyses live only in car_analyses (they only get a
// dealer_stock row once explicitly saved), so the source of truth for "all my
// analyses" is car_analyses scoped to the dealer's auth user.
//
// Returns a LIGHT summary per row (not the full result_json) — the row links to
// /dealer/analisis/[id] which fetches the full analysis on demand. Also carries
// the saved/stock state so the workbench can render the Guardado toggle.
export async function GET(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);

    const { data: rows, error } = await dealerServiceClient
      .from('car_analyses')
      .select('id, title, car_image_url, source_url, result_json, created_at')
      .eq('user_id', dealerProfile.user_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(300);

    if (error) {
      console.error('Error listing dealer analyses:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al cargar los análisis' }, { status: 500 });
    }

    // Map analysis_id → dealer_stock state so the UI can show Guardado / en operación.
    const { data: stock } = await dealerServiceClient
      .from('dealer_stock')
      .select('id, analysis_id, status')
      .eq('dealer_id', dealerProfile.id)
      .not('analysis_id', 'is', null);
    const stockByAnalysis = new Map<string, { id: string; status: string }>();
    for (const s of stock || []) {
      if (s.analysis_id) stockByAnalysis.set(s.analysis_id, { id: s.id, status: s.status });
    }

    const analyses = (rows || []).flatMap((r: any) => {
      const rj = r.result_json;
      const status = rj?.status;
      if (!rj || status === 'in_progress' || status === 'failed' || rj.error) return [];
      const v = buildAnalysisView(rj, r.title);
      // Skip rows with no usable result (placeholder/garbage).
      if (!v.veredicto && v.score_global == null && v.precio_medio == null) return [];

      const st = stockByAnalysis.get(r.id);
      return [{
        id: r.id,
        title: r.title || v.titulo || null,
        car_image_url: r.car_image_url || null,
        source_url: r.source_url || null,
        created_at: r.created_at,
        saved: st?.status === 'guardado',
        stock_id: st?.id ?? null,
        stock_status: st?.status ?? null,
        summary: {
          score_global: v.score_global,
          margen_porcentaje: v.margen_porcentaje,
          margen_bruto: v.margen_bruto,
          veredicto: v.veredicto,
          low_confidence: v.low_confidence,
          is_national: v.is_national,
          precio_compra_total: v.precio_compra_total,
          precio_medio: v.precio_medio,
          kilometraje: v.kilometraje,
          año: v.año,
          // Carried so list rows can show the sin-IVA (net) margin, consistent
          // with the full report, when the dealer buys sin IVA.
          iva_import: v.iva_import,
        },
      }];
    });

    return NextResponse.json({ analyses });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Unexpected error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
