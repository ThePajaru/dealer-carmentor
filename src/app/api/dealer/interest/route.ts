import { NextRequest, NextResponse } from 'next/server';
import { sendEmailDirect } from '@/lib/dealer-notifications';

// Public lead-capture endpoint for the dealer landing page (/dealer).
// A visiting compraventa fills the "solicitar acceso" form; we email the lead
// to the sales inbox. No auth, no DB row — just a notification.
//
// Destination: set DEALER_LEADS_EMAIL in the environment to override. Default
// is xpages55@gmail.com (Pau's inbox for now).
const LEADS_EMAIL = process.env.DEALER_LEADS_EMAIL || 'xpages55@gmail.com';

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  // Honeypot: bots fill hidden fields; humans don't.
  if (typeof body.company_website === 'string' && body.company_website.trim() !== '') {
    return NextResponse.json({ ok: true }); // silently drop
  }

  const nombre = String(body.nombre ?? '').trim();
  const empresa = String(body.empresa ?? '').trim();
  const telefono = String(body.telefono ?? '').trim();
  const email = String(body.email ?? '').trim();
  const ciudad = String(body.ciudad ?? '').trim();
  const volumen = String(body.volumen ?? '').trim();
  const mensaje = String(body.mensaje ?? '').trim();

  // Need a name and at least one way to reach them.
  if (!nombre || (!telefono && !email)) {
    return NextResponse.json(
      { error: 'Indica tu nombre y un teléfono o email de contacto.' },
      { status: 400 },
    );
  }

  const rows: Array<[string, string]> = [
    ['Nombre', nombre],
    ['Compraventa', empresa || '—'],
    ['Teléfono / WhatsApp', telefono || '—'],
    ['Email', email || '—'],
    ['Ciudad', ciudad || '—'],
    ['Coches importados/mes', volumen || '—'],
    ['Mensaje', mensaje || '—'],
  ];

  // Always log server-side so a lead is never lost even if email fails / dest unset.
  console.log('[dealer-interest] nuevo lead:', JSON.stringify(Object.fromEntries(rows)));

  const html = `
    <div style="font-family:Arial,sans-serif;color:#042152;max-width:560px">
      <h2 style="font-family:Arial,sans-serif;color:#042152;margin:0 0 4px">Nuevo interés · CarMentor Dealer</h2>
      <p style="color:#526B9F;margin:0 0 16px;font-size:14px">Un dealer ha rellenado el formulario en /dealer.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        ${rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:8px 10px;border:1px solid #e2e8f0;background:#F7F9FF;font-weight:700;white-space:nowrap;vertical-align:top">${esc(
                k,
              )}</td><td style="padding:8px 10px;border:1px solid #e2e8f0">${esc(v)}</td></tr>`,
          )
          .join('')}
      </table>
    </div>`;

  try {
    await sendEmailDirect({
      to: LEADS_EMAIL,
      subject: `Nuevo interés Dealer: ${empresa || nombre}`,
      html,
      senderName: 'CarMentor Dealer',
    });
  } catch (err) {
    // Don't fail the user's submission — the lead is already logged above.
    console.error('[dealer-interest] fallo al enviar email:', err instanceof Error ? err.message : err);
  }

  return NextResponse.json({ ok: true });
}
