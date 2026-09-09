import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logDealerEvent } from '@/lib/dealer/events';
import { notifyDealerPresupuestoAccepted } from '@/lib/dealer-notifications';

// Public (no-auth) client self-accept for a presupuesto. Called from the
// "Aceptar presupuesto" button on the public /pr/[id] page. Mirrors the dealer's
// manual acceptPresupuesto: marks the quote 'aceptado', registers the agreed
// price on the operation, advances the pipeline to 'runner', logs the activity
// feed events and emails the dealer. Idempotent: a second tap is a no-op 200.
//
// Service role on purpose — the client is not authenticated. The id is an
// unguessable UUID and only presupuestos already 'enviado' can be accepted, so
// there is no wider exposure than the public /pr link already grants.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Pipeline order (see 20260630_dealer_pipeline_stage.sql). Accepting only ever
// moves an operation FORWARD to 'runner' — never back from tránsito/entregado.
const ALREADY_PAST_RUNNER = new Set(['runner', 'transito', 'entregado']);

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Presupuesto no encontrado' }, { status: 404 });
  }

  const { data: presu } = await supabase
    .from('dealer_presupuestos')
    .select('id, dealer_id, status, selling_price, margin, presupuesto_data, dealer_leads(client_name, client_request_id)')
    .eq('id', id)
    .maybeSingle();

  // Only a presupuesto the dealer actually sent can be accepted by the client.
  if (!presu || !['enviado', 'aceptado'].includes((presu as any).status)) {
    return NextResponse.json({ error: 'Presupuesto no disponible' }, { status: 404 });
  }

  // Already accepted → idempotent success (a double-tap or re-open must not error).
  if ((presu as any).status === 'aceptado') {
    return NextResponse.json({ status: 'aceptado' });
  }

  const now = new Date().toISOString();
  const lead = (presu as any).dealer_leads;
  const requestId: string | null = lead?.client_request_id ?? null;
  const clientName: string = lead?.client_name || 'El cliente';
  const carTitle: string = (presu as any).presupuesto_data?.title || 'el coche';
  const price: number | null = (presu as any).selling_price ?? null;

  const { error: upErr } = await supabase
    .from('dealer_presupuestos')
    .update({ status: 'aceptado', accepted_at: now, updated_at: now })
    .eq('id', id);
  if (upErr) {
    console.error('presupuesto accept: update failed:', JSON.stringify(upErr));
    return NextResponse.json({ error: 'No se pudo aceptar' }, { status: 500 });
  }

  // Register the agreed price on the operation and advance to Runner (unless the
  // operation is already at/after Runner — never move it backward).
  let prevStage: string | null = null;
  if (requestId) {
    const { data: reqRow } = await supabase
      .from('dealer_client_requests')
      .select('stage')
      .eq('id', requestId)
      .eq('dealer_id', (presu as any).dealer_id)
      .maybeSingle();
    prevStage = (reqRow as any)?.stage ?? null;
    const advance = !ALREADY_PAST_RUNNER.has(prevStage || '');
    await supabase
      .from('dealer_client_requests')
      .update({
        agreed_price: price,
        agreed_at: now,
        ...(advance ? { stage: 'runner' } : {}),
        updated_at: now,
      })
      .eq('id', requestId)
      .eq('dealer_id', (presu as any).dealer_id);
  }

  // Activity feed: the acceptance itself + the stage move (if it moved).
  logDealerEvent(supabase, {
    dealer_id: (presu as any).dealer_id,
    request_id: requestId,
    type: 'presupuesto_aceptado',
    payload: { client_name: clientName, title: carTitle, margin: (presu as any).margin ?? null },
  });
  if (requestId && prevStage && !ALREADY_PAST_RUNNER.has(prevStage)) {
    logDealerEvent(supabase, {
      dealer_id: (presu as any).dealer_id,
      request_id: requestId,
      type: 'etapa_cambiada',
      payload: { client_name: clientName, from: prevStage, to: 'runner' },
    });
  }

  // Email the dealer so they act even if the panel is closed. Fire-and-forget —
  // a mail failure must never fail the client's acceptance.
  const { data: dealer } = await supabase
    .from('dealer_profiles')
    .select('email')
    .eq('id', (presu as any).dealer_id)
    .maybeSingle();
  if ((dealer as any)?.email && requestId) {
    void notifyDealerPresupuestoAccepted({
      dealerEmail: (dealer as any).email,
      clientName,
      carTitle,
      price,
      requestId,
    });
  }

  return NextResponse.json({ status: 'aceptado' });
}
