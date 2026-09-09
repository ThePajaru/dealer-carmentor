import { NextRequest, NextResponse } from 'next/server';
import { requireDealerAuth, AuthError, dealerServiceClient } from '@/lib/dealer-auth';

// The Analizar workbench watchlist: speculative analyses the dealer saved with no
// customer attached. Cars enter Operaciones only when promoted (see [id]/promote).

// GET /api/dealer/stock — list saved (guardado) cars, newest first, with the
// analysis fields the workbench needs to render each card.
export async function GET(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);

    const { data, error } = await dealerServiceClient
      .from('dealer_stock')
      .select('id, source_url, status, notes, created_at, analysis_id, car_analyses(title, car_image_url, result_json)')
      .eq('dealer_id', dealerProfile.id)
      .eq('status', 'guardado')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error listing stock:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al cargar el stock' }, { status: 500 });
    }
    return NextResponse.json({ stock: data || [] });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Unexpected error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

// POST /api/dealer/stock — save a workbench analysis to the watchlist.
// Idempotent on (dealer, analysis): re-saving the same analysis reactivates the
// existing row instead of duplicating it.
export async function POST(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);
    const body = await request.json();

    const analysisId = String(body.analysis_id || '').trim() || null;
    const sourceUrl = String(body.source_url || '').trim();
    if (!sourceUrl) {
      return NextResponse.json({ error: 'source_url es obligatoria' }, { status: 400 });
    }

    if (analysisId) {
      const { data: existing } = await dealerServiceClient
        .from('dealer_stock')
        .select('id')
        .eq('dealer_id', dealerProfile.id)
        .eq('analysis_id', analysisId)
        .maybeSingle();
      if (existing) {
        await dealerServiceClient
          .from('dealer_stock')
          .update({ status: 'guardado', source_url: sourceUrl, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        return NextResponse.json({ id: existing.id }, { status: 200 });
      }
    }

    const { data, error } = await dealerServiceClient
      .from('dealer_stock')
      .insert({
        dealer_id: dealerProfile.id,
        analysis_id: analysisId,
        source_url: sourceUrl,
        notes: String(body.notes || '').trim() || null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error saving stock:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al guardar' }, { status: 500 });
    }
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Unexpected error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
