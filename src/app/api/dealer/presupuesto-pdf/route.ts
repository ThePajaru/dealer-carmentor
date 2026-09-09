import { NextRequest, NextResponse } from 'next/server';
import { requireDealerAuth, AuthError } from '@/lib/dealer-auth';
import { type PresupuestoData } from '@/lib/presupuesto-template';
import { renderPresupuestoPdf } from '@/lib/presupuesto-pdf';

// Renders a presupuesto to PDF via Doppio (same engine the consumer app uses).
// Receives the exact PresupuestoData the editor is previewing, so the PDF is
// byte-identical to the on-screen preview.
export async function POST(request: NextRequest) {
  try {
    await requireDealerAuth(request);

    let body: { data?: PresupuestoData; filename?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    if (!body?.data) {
      return NextResponse.json({ error: 'Missing presupuesto data' }, { status: 400 });
    }

    let pdf: Buffer;
    try {
      pdf = await renderPresupuestoPdf(body.data);
    } catch (err) {
      console.error('Doppio error:', err);
      return NextResponse.json({ error: 'PDF generation failed' }, { status: 502 });
    }
    const filename = (body.filename || 'presupuesto').replace(/[^a-z0-9_-]/gi, '_');

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}.pdf"`,
        'Content-Length': pdf.byteLength.toString(),
      },
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('presupuesto-pdf error:', e);
    return NextResponse.json({ error: 'Error generando PDF' }, { status: 500 });
  }
}
