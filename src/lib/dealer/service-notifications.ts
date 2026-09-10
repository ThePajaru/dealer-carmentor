// Aviso INTERNO cuando un dealer paga un trámite: el gestor tiene que presentar
// el 576 y el IVTM, o el ingeniero tiene que firmar la ficha reducida. Sin este
// correo el encargo se quedaría esperando en una tabla que nadie mira.
//
// Se manda a DEALER_LEADS_EMAIL (el buzón de operaciones), nunca al cliente
// final. Fire-and-forget: un fallo de Brevo no puede tumbar el webhook de
// Stripe — Stripe reintentaría el evento y el pago ya está registrado.

import { sendEmailDirect } from '@/lib/dealer-notifications';
import { publicOrigin } from '@/lib/public-url';
import { serviceDef, type ServiceKey } from './services';

interface ServiceOrderPaid {
  kind: ServiceKey;
  orderId: string;
  requestId: string;
  dealerId: string;
  clientName: string | null;
  payload: Record<string, unknown>;
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 12px 6px 0;color:#a1a1aa;font-size:13px;white-space:nowrap;">${label}</td>
    <td style="padding:6px 0;color:#fafafa;font-size:13px;">${value}</td>
  </tr>`;
}

function esc(v: unknown): string {
  return String(v ?? '—')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Las filas propias de cada servicio: lo que quien lo ejecuta necesita saber. */
function detailRows(kind: ServiceKey, payload: Record<string, unknown>): string {
  if (kind === 'impuestos') {
    const p = payload as {
      region?: string; municipio?: string; provincia?: string;
      cvf?: number; valoracion?: number; co2?: number;
      primera_matriculacion?: string; iedmt_estimado?: number;
    };
    return [
      row('Comunidad (576)', esc(p.region)),
      row('Municipio (IVTM)', `${esc(p.municipio)}${p.provincia ? ` (${esc(p.provincia)})` : ''}`),
      row('Potencia fiscal', p.cvf != null ? `${esc(p.cvf)} CVF` : '—'),
      row('Valoración', p.valoracion != null ? `${esc(p.valoracion)} €` : '—'),
      row('CO2', p.co2 != null ? `${esc(p.co2)} g/km` : 'sin acreditar'),
      row('1ª matriculación', esc(p.primera_matriculacion)),
      row('576 estimado', p.iedmt_estimado != null ? `${esc(Math.round(p.iedmt_estimado))} €` : '—'),
    ].join('');
  }

  const p = payload as { photos?: { label?: string; url?: string }[]; faltan?: string[] };
  const photos = Array.isArray(p.photos) ? p.photos : [];
  const links = photos
    .filter(ph => ph?.url)
    .map(ph => `<a href="${esc(ph.url)}" style="color:#ea580c;">${esc(ph.label)}</a>`)
    .join(' · ');
  return [
    row('Fotos del expediente', photos.length ? `${photos.length} fotos` : 'ninguna'),
    row('Faltan', Array.isArray(p.faltan) && p.faltan.length ? esc(p.faltan.join(', ')) : 'nada'),
    links ? row('Enlaces', links) : '',
  ].join('');
}

export async function notifyServiceOrderPaid(order: ServiceOrderPaid): Promise<void> {
  const to = process.env.DEALER_LEADS_EMAIL;
  if (!to) {
    console.error('DEALER_LEADS_EMAIL not set — trámite pagado sin avisar a nadie:', order.orderId);
    return;
  }

  const def = serviceDef(order.kind);
  const label = def?.label ?? order.kind;
  const caseUrl = `${publicOrigin()}/dealer/clientes/${order.requestId}`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${label}</title></head>
<body style="margin:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#18181b;border:1px solid #3f3f46;border-radius:8px;">
<tr><td style="padding:28px;">
  <p style="margin:0 0 4px;color:#ea580c;font-size:11px;letter-spacing:.1em;text-transform:uppercase;">Trámite pagado</p>
  <h1 style="margin:0 0 16px;color:#fafafa;font-size:20px;">${label}</h1>
  <table role="presentation" cellpadding="0" cellspacing="0">
    ${row('Cliente', esc(order.clientName))}
    ${row('Encargo', esc(order.orderId))}
    ${detailRows(order.kind, order.payload)}
  </table>
  <p style="margin:20px 0 0;">
    <a href="${caseUrl}" style="display:inline-block;background:#ea580c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:600;">Abrir la operación</a>
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  try {
    await sendEmailDirect({
      to,
      subject: `Trámite pagado · ${label}${order.clientName ? ` · ${order.clientName}` : ''}`,
      html,
      senderName: 'CarMentor Dealer',
    });
  } catch (e) {
    console.error('Service order notification failed:', e);
  }
}

/**
 * Aviso al DEALER de que su trámite está hecho. El panel no es una pantalla que
 * se mire cada día y un trámite terminado suele desbloquear la entrega, así que
 * el correo es el que cierra el círculo. Fire-and-forget, como el interno.
 */
export async function notifyDealerServiceCompleted(opts: {
  kind: ServiceKey;
  requestId: string;
  to: string | null;
  dealerName: string | null;
  clientName: string | null;
  nota: string | null;
  fileCount: number;
}): Promise<void> {
  if (!opts.to) {
    console.error('Trámite completado sin email del dealer:', opts.requestId);
    return;
  }

  const def = serviceDef(opts.kind);
  const label = def?.label ?? opts.kind;
  const caseUrl = `${publicOrigin()}/dealer/clientes/${opts.requestId}`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${label}</title></head>
<body style="margin:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#18181b;border:1px solid #3f3f46;border-radius:8px;">
<tr><td style="padding:28px;">
  <p style="margin:0 0 4px;color:#ea580c;font-size:11px;letter-spacing:.1em;text-transform:uppercase;">Trámite completado</p>
  <h1 style="margin:0 0 12px;color:#fafafa;font-size:20px;">${label}</h1>
  <p style="margin:0 0 16px;color:#a1a1aa;font-size:14px;line-height:1.6;">
    ${opts.clientName ? `Operación de <span style="color:#fafafa;">${esc(opts.clientName)}</span>. ` : ''}
    ${opts.fileCount > 0
      ? `Tienes ${opts.fileCount} documento${opts.fileCount === 1 ? '' : 's'} en la operación.`
      : 'Ya está resuelto.'}
  </p>
  ${opts.nota ? `<p style="margin:0 0 16px;padding:12px;background:#0a0a0a;border-radius:6px;color:#d4d4d8;font-size:13px;line-height:1.6;">${esc(opts.nota)}</p>` : ''}
  <p style="margin:0;">
    <a href="${caseUrl}" style="display:inline-block;background:#ea580c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:600;">Ver la operación</a>
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  try {
    await sendEmailDirect({
      to: opts.to,
      subject: `${label} · completado${opts.clientName ? ` · ${opts.clientName}` : ''}`,
      html,
      senderName: 'CarMentor Dealer',
    });
  } catch (e) {
    console.error('Dealer completion notification failed:', e);
  }
}
