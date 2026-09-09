import { NextRequest, NextResponse } from 'next/server';
import { requireDealerAuth, AuthError, dealerServiceClient } from '@/lib/dealer-auth';

// POST /api/dealer/stock/[id]/promote — turn a saved (speculative) car into a real
// operación for a customer. Creates/reuses the client, opens a client_request
// already at stage 'seleccion' (a car is analyzed), attaches the analysis as a
// lead, and marks the stock row promovido. Returns the new request id so the UI
// can jump straight to the case page.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);
    const { id } = await params;
    const body = await request.json();

    const clientName = String(body.client_name || '').trim();
    if (!clientName) {
      return NextResponse.json({ error: 'El nombre del cliente es obligatorio' }, { status: 400 });
    }
    const phone = String(body.client_phone || '').trim() || null;
    const email = String(body.client_email || '').trim() || null;

    // Load the stock row (and its analysis) — scoped to this dealer.
    const { data: stock, error: stockErr } = await dealerServiceClient
      .from('dealer_stock')
      .select('id, source_url, analysis_id, status')
      .eq('id', id)
      .eq('dealer_id', dealerProfile.id)
      .maybeSingle();

    if (stockErr || !stock) {
      return NextResponse.json({ error: 'Stock no encontrado' }, { status: 404 });
    }
    if (stock.status === 'promovido') {
      return NextResponse.json({ error: 'Ya promovido' }, { status: 409 });
    }

    // Find or create the person (dedupe by phone within the dealer) — mirrors clients route.
    let clientId: string | null = null;
    if (phone) {
      const { data: existing } = await dealerServiceClient
        .from('dealer_clients')
        .select('id')
        .eq('dealer_id', dealerProfile.id)
        .eq('phone', phone)
        .maybeSingle();
      if (existing) {
        clientId = existing.id;
        await dealerServiceClient
          .from('dealer_clients')
          .update({ name: clientName, email: email || undefined, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        const { data: newClient } = await dealerServiceClient
          .from('dealer_clients')
          .insert({ dealer_id: dealerProfile.id, name: clientName, phone, email })
          .select('id')
          .single();
        clientId = newClient?.id || null;
      }
    }

    // Open the operación already at 'seleccion' — a car is analyzed and waiting.
    const { data: req, error: reqErr } = await dealerServiceClient
      .from('dealer_client_requests')
      .insert({
        dealer_id: dealerProfile.id,
        client_id: clientId,
        client_name: clientName,
        client_phone: phone,
        client_email: email,
        status: 'nuevo',
        stage: 'seleccion',
      })
      .select('id')
      .single();

    if (reqErr || !req) {
      console.error('Error creating request on promote:', JSON.stringify(reqErr));
      return NextResponse.json({ error: 'Error al crear la operación' }, { status: 500 });
    }

    // Attach the analyzed car as a lead under the new request.
    const { error: leadErr } = await dealerServiceClient
      .from('dealer_leads')
      .insert({
        dealer_id: dealerProfile.id,
        source_url: stock.source_url,
        analysis_id: stock.analysis_id,
        client_request_id: req.id,
        is_shortlisted: true,
        source: 'manual',
      });
    if (leadErr) {
      console.error('Error attaching lead on promote:', JSON.stringify(leadErr));
      // The operación exists; surface it anyway rather than orphaning the user.
    }

    await dealerServiceClient
      .from('dealer_stock')
      .update({ status: 'promovido', promoted_request_id: req.id, updated_at: new Date().toISOString() })
      .eq('id', stock.id);

    return NextResponse.json({ request_id: req.id }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Unexpected error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
