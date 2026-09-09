import { NextRequest, NextResponse } from 'next/server';
import { requireDealerAuth, AuthError, dealerServiceClient } from '@/lib/dealer-auth';

// DELETE /api/dealer/analyses/[id] — soft-delete one of the dealer's own analyses
// so it drops out of the workbench list. Scoped to the dealer's auth user so one
// dealer can never delete another's analysis. Quota still counts deleted analyses
// (see CLAUDE.md), this is purely about tidying the list.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);
    const { id } = await params;

    const { error } = await dealerServiceClient
      .from('car_analyses')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', dealerProfile.user_id);

    if (error) {
      console.error('Error deleting analysis:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al eliminar' }, { status: 500 });
    }

    // Also drop any watchlist row so it doesn't linger as a dangling saved card.
    await dealerServiceClient
      .from('dealer_stock')
      .update({ status: 'descartado', updated_at: new Date().toISOString() })
      .eq('dealer_id', dealerProfile.id)
      .eq('analysis_id', id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Unexpected error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
