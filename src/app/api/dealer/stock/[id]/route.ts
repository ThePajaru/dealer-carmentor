import { NextRequest, NextResponse } from 'next/server';
import { requireDealerAuth, AuthError, dealerServiceClient } from '@/lib/dealer-auth';

// PATCH /api/dealer/stock/[id] — change a saved car's status (e.g. descartar) or
// notes. Scoped to the dealer so one dealer can't touch another's stock.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);
    const { id } = await params;
    const body = await request.json();

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.status !== undefined) {
      if (!['guardado', 'descartado'].includes(body.status)) {
        return NextResponse.json({ error: 'Estado inválido' }, { status: 400 });
      }
      patch.status = body.status;
    }
    if (body.notes !== undefined) patch.notes = String(body.notes || '').trim() || null;

    const { error } = await dealerServiceClient
      .from('dealer_stock')
      .update(patch)
      .eq('id', id)
      .eq('dealer_id', dealerProfile.id);

    if (error) {
      console.error('Error updating stock:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al actualizar' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Unexpected error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
