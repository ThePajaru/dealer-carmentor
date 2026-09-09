import { NextRequest, NextResponse } from 'next/server';
import { requireDealerAuth, AuthError, dealerServiceClient } from '@/lib/dealer-auth';
import { renderPresupuestoPdf } from '@/lib/presupuesto-pdf';
import { logDealerEvent } from '@/lib/dealer/events';
import { publicOrigin } from '@/lib/public-url';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Mark a presupuesto as sent + freeze an immutable PDF snapshot of exactly what
// the client received, into the public `presupuestos` bucket. Drafts stay
// on-demand (regenerated); only the sent version is archived.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { dealerProfile } = await requireDealerAuth(_request);

    const { data: presu, error } = await dealerServiceClient
      .from('dealer_presupuestos')
      .select('*, dealer_leads!inner(dealer_id, client_name, client_request_id)')
      .eq('id', id)
      .single();

    if (error || !presu || (presu as any).dealer_leads?.dealer_id !== dealerProfile.id) {
      return NextResponse.json({ error: 'Presupuesto no encontrado' }, { status: 404 });
    }
    if (!(presu as any).presupuesto_data) {
      return NextResponse.json({ error: 'Este presupuesto no tiene contenido para generar el PDF' }, { status: 400 });
    }

    let pdf: Buffer;
    try {
      pdf = await renderPresupuestoPdf((presu as any).presupuesto_data);
    } catch (err) {
      console.error('send: Doppio error:', err);
      return NextResponse.json({ error: 'No se pudo generar el PDF' }, { status: 502 });
    }

    const path = `${dealerProfile.id}/${id}.pdf`;
    const { error: upErr } = await dealerServiceClient.storage
      .from('presupuestos')
      .upload(path, pdf, { contentType: 'application/pdf', upsert: true });
    if (upErr) {
      console.error('send: storage error:', JSON.stringify(upErr));
      return NextResponse.json({ error: 'No se pudo archivar el PDF' }, { status: 500 });
    }

    const { data: pub } = dealerServiceClient.storage.from('presupuestos').getPublicUrl(path);
    const sentUrl = pub.publicUrl;

    await dealerServiceClient
      .from('dealer_presupuestos')
      .update({ status: 'enviado', sent_at: new Date().toISOString(), sent_pdf_path: sentUrl })
      .eq('id', id);

    logDealerEvent(dealerServiceClient, {
      dealer_id: dealerProfile.id,
      request_id: (presu as any).dealer_leads?.client_request_id ?? null,
      type: 'presupuesto_enviado',
      payload: {
        client_name: (presu as any).dealer_leads?.client_name ?? null,
        margin: (presu as any).margin ?? null,
      },
    });

    // The public link is what the dealer actually sends over WhatsApp; the
    // archived PDF stays as the frozen copy of what the client received.
    return NextResponse.json({
      status: 'enviado',
      sent_pdf_url: sentUrl,
      public_url: `${publicOrigin()}/pr/${id}`,
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('presupuesto send error:', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
