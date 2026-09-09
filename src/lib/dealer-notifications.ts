// Direct Brevo send — avoids importing email.ts which has missing design deps
export async function sendEmailDirect(options: { to: string; subject: string; html: string; senderName?: string }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY is not set');

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: options.senderName || 'CarMentor', email: 'noreply@carmentor.es' },
      replyTo: { name: 'CarMentor', email: 'info@carmentor.es' },
      to: [{ email: options.to }],
      subject: options.subject,
      htmlContent: options.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo API error ${res.status}: ${body}`);
  }
  return res.json();
}

const ORANGE = '#ea580c';
const BG = '#0a0a0a';
const CARD_BG = '#18181b';
const ZINC_400 = '#a1a1aa';
const ZINC_700 = '#3f3f46';

function dealerEmailShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<!-- Orange accent -->
<tr><td style="background:${ORANGE};height:3px;border-radius:8px 8px 0 0;"></td></tr>
<!-- Content -->
<tr><td style="background:${CARD_BG};padding:32px 28px;border-radius:0 0 8px 8px;border:1px solid ${ZINC_700};border-top:none;">
${body}
</td></tr>
<!-- Footer -->
<tr><td style="padding:16px 0;text-align:center;">
<p style="margin:0;color:${ZINC_400};font-size:11px;">Este email fue enviado automáticamente por tu sistema de gestión.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

export function renderNewClientEmail(opts: {
  dealerName: string;
  clientName: string;
  clientPhone?: string | null;
  make?: string | null;
  model?: string | null;
  maxPrice?: number | null;
  fuel?: string | null;
  dashboardUrl: string;
}): string {
  const carDesc = [opts.make, opts.model].filter(Boolean).join(' ') || 'sin especificar';
  const priceStr = opts.maxPrice ? `${(opts.maxPrice / 1000).toFixed(0)}k€` : 'sin límite';

  const fuelLabels: Record<string, string> = {
    PETROL: 'Gasolina', DIESEL: 'Diésel', ELECTRICITY: 'Eléctrico',
    HYBRID: 'Híbrido', HYBRID_PLUGIN: 'Híbrido enchufable', PLUGINHYBRID: 'Híbrido enchufable',
  };
  const fuelStr = opts.fuel ? (fuelLabels[opts.fuel] || opts.fuel) : null;

  const chips = [
    `<span style="display:inline-block;background:#27272a;border:1px solid ${ZINC_700};border-radius:6px;padding:4px 10px;margin:3px 2px;font-size:13px;color:#e4e4e7;">${carDesc}</span>`,
    `<span style="display:inline-block;background:#27272a;border:1px solid ${ZINC_700};border-radius:6px;padding:4px 10px;margin:3px 2px;font-size:13px;color:#e4e4e7;">&lt;${priceStr}</span>`,
    fuelStr ? `<span style="display:inline-block;background:#27272a;border:1px solid ${ZINC_700};border-radius:6px;padding:4px 10px;margin:3px 2px;font-size:13px;color:#e4e4e7;">${fuelStr}</span>` : '',
  ].filter(Boolean).join('');

  return dealerEmailShell(`Nuevo cliente: ${opts.clientName}`, `
    <p style="margin:0 0 4px;color:${ORANGE};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Nuevo cliente</p>
    <h1 style="margin:0 0 16px;color:#fff;font-size:22px;font-weight:700;">${opts.clientName}</h1>
    ${opts.clientPhone ? `<p style="margin:0 0 12px;color:${ZINC_400};font-size:14px;">Tel: <a href="tel:${opts.clientPhone}" style="color:${ORANGE};text-decoration:none;">${opts.clientPhone}</a></p>` : ''}
    <p style="margin:0 0 8px;color:${ZINC_400};font-size:13px;">Busca:</p>
    <div style="margin:0 0 20px;">${chips}</div>
    <a href="${opts.dashboardUrl}" style="display:inline-block;background:${ORANGE};color:#fff;font-size:14px;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;">Ver solicitud</a>
  `);
}

export async function notifyDealerNewClient(opts: {
  dealerEmail: string;
  dealerName: string;
  clientName: string;
  clientPhone?: string | null;
  make?: string | null;
  model?: string | null;
  maxPrice?: number | null;
  fuel?: string | null;
  requestId: string;
}) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://carmentor.es';
  const dashboardUrl = `${baseUrl}/dealer/clientes/${opts.requestId}`;

  const html = renderNewClientEmail({
    dealerName: opts.dealerName,
    clientName: opts.clientName,
    clientPhone: opts.clientPhone,
    make: opts.make,
    model: opts.model,
    maxPrice: opts.maxPrice,
    fuel: opts.fuel,
    dashboardUrl,
  });

  const carDesc = [opts.make, opts.model].filter(Boolean).join(' ');
  const subject = carDesc
    ? `Nuevo cliente: ${opts.clientName} busca un ${carDesc}`
    : `Nuevo cliente: ${opts.clientName}`;

  try {
    await sendEmailDirect({
      to: opts.dealerEmail,
      subject,
      html,
    });
  } catch (error) {
    console.error('Failed to send dealer notification:', error);
  }
}

export function renderPresupuestoAcceptedEmail(opts: {
  clientName: string;
  carTitle: string;
  price?: number | null;
  dashboardUrl: string;
}): string {
  const priceStr = opts.price != null
    ? `${Math.round(opts.price).toLocaleString('es-ES')} €`
    : null;
  return dealerEmailShell(`${opts.clientName} aceptó el presupuesto`, `
    <p style="margin:0 0 4px;color:#22c55e;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Presupuesto aceptado</p>
    <h1 style="margin:0 0 16px;color:#fff;font-size:22px;font-weight:700;">${opts.clientName} ha dicho que sí</h1>
    <p style="margin:0 0 8px;color:${ZINC_400};font-size:14px;line-height:1.6;">
      Ha aceptado el presupuesto de <strong style="color:#fff;">${opts.carTitle}</strong>${priceStr ? ` por <strong style="color:#fff;">${priceStr}</strong>` : ''} desde el enlace que le enviaste.
    </p>
    <p style="margin:0 0 20px;color:${ZINC_400};font-size:14px;line-height:1.6;">La operación ha pasado a <strong style="color:#fff;">Runner</strong>: prepara la ficha de inspección para tu chico.</p>
    <a href="${opts.dashboardUrl}" style="display:inline-block;background:${ORANGE};color:#fff;font-size:14px;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;">Ver la operación</a>
  `);
}

export async function notifyDealerPresupuestoAccepted(opts: {
  dealerEmail: string;
  clientName: string;
  carTitle: string;
  price?: number | null;
  requestId: string;
}) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://carmentor.es';
  const dashboardUrl = `${baseUrl}/dealer/clientes/${opts.requestId}`;
  const html = renderPresupuestoAcceptedEmail({
    clientName: opts.clientName,
    carTitle: opts.carTitle,
    price: opts.price,
    dashboardUrl,
  });
  try {
    await sendEmailDirect({
      to: opts.dealerEmail,
      subject: `${opts.clientName} aceptó el presupuesto de ${opts.carTitle}`,
      html,
    });
  } catch (error) {
    console.error('Failed to send presupuesto-accepted notification:', error);
  }
}

// ── Customer-facing pings ────────────────────────────────────────────────────
// A lighter, dealer-branded shell (the dealer's business is the sender, not
// "CarMentor"). Never exposes prices, margins or negotiation — buyer lens only.

type CustomerMilestone = 'inspeccion' | 'comprado' | 'en_transporte' | 'en_espana' | 'entregado';

const CUSTOMER_BG = '#f4f4f5';
const CUSTOMER_CARD = '#ffffff';
const TEXT_DARK = '#18181b';
const TEXT_MUTED = '#71717a';
const BORDER_LIGHT = '#e4e4e7';

const MILESTONE_COPY: Record<CustomerMilestone, { tag: string; heading: (car: string) => string; body: string; cta: string }> = {
  inspeccion: {
    tag: 'Inspección completada',
    heading: () => 'Hemos inspeccionado tu coche en persona',
    body: 'Nuestro equipo ha viajado hasta Alemania y ha revisado el coche punto por punto antes de comprarlo. Ya puedes ver el informe con las fotos reales de tu vehículo.',
    cta: 'Ver la inspección',
  },
  comprado: {
    tag: 'Comprado',
    heading: () => 'Tu coche ya es tuyo',
    body: 'Hemos cerrado la compra en Alemania. A partir de ahora empieza el viaje de vuelta a España. Te iremos avisando en cada paso.',
    cta: 'Seguir mi coche',
  },
  en_transporte: {
    tag: 'En transporte',
    heading: () => 'Tu coche está de camino',
    body: 'El vehículo ya ha salido de Alemania y está en ruta hacia España. Puedes seguir el estado del envío en cualquier momento.',
    cta: 'Ver seguimiento',
  },
  en_espana: {
    tag: 'En España',
    heading: () => 'Tu coche ya está en España',
    body: 'El vehículo ha llegado a España. Estamos ultimando los trámites y la preparación para la entrega. Te avisaremos en cuanto esté listo.',
    cta: 'Ver seguimiento',
  },
  entregado: {
    tag: 'Entregado',
    heading: () => '¡Tu coche está listo!',
    body: 'Todo el proceso ha terminado. Gracias por confiar en nosotros para traer tu coche desde Alemania. ¡A disfrutarlo!',
    cta: 'Ver resumen',
  },
};

function customerEmailShell(opts: {
  dealerName: string;
  dealerLogo?: string | null;
  title: string;
  body: string;
}): string {
  const logo = opts.dealerLogo
    ? `<img src="${opts.dealerLogo}" alt="${opts.dealerName}" width="40" height="40" style="border-radius:8px;object-fit:cover;vertical-align:middle;" />`
    : `<span style="display:inline-block;width:40px;height:40px;border-radius:8px;background:${ORANGE};color:#fff;font-weight:700;font-size:18px;line-height:40px;text-align:center;">${(opts.dealerName || 'C').charAt(0).toUpperCase()}</span>`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title}</title></head>
<body style="margin:0;padding:0;background:${CUSTOMER_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CUSTOMER_BG};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
<tr><td style="padding:0 4px 16px;">${logo}<span style="color:${TEXT_DARK};font-weight:700;font-size:15px;margin-left:10px;vertical-align:middle;">${opts.dealerName}</span></td></tr>
<tr><td style="background:${CUSTOMER_CARD};padding:28px 28px 32px;border-radius:12px;border:1px solid ${BORDER_LIGHT};">
${opts.body}
</td></tr>
<tr><td style="padding:16px 4px;text-align:center;">
<p style="margin:0;color:${TEXT_MUTED};font-size:11px;">Seguimiento de tu compra · ${opts.dealerName}</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

export function renderCustomerMilestoneEmail(opts: {
  dealerName: string;
  dealerLogo?: string | null;
  clientName?: string | null;
  carTitle: string;
  carImage?: string | null;
  milestone: CustomerMilestone;
  trackingUrl: string;
}): string {
  const copy = MILESTONE_COPY[opts.milestone];
  const firstName = opts.clientName ? opts.clientName.split(' ')[0] : null;
  const carBlock = opts.carImage
    ? `<img src="${opts.carImage}" alt="${opts.carTitle}" width="100%" style="width:100%;max-width:464px;border-radius:10px;display:block;margin:0 0 20px;" />`
    : '';
  const body = `
    <p style="margin:0 0 6px;color:${ORANGE};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">${copy.tag}</p>
    <h1 style="margin:0 0 6px;color:${TEXT_DARK};font-size:22px;font-weight:700;line-height:1.25;">${copy.heading(opts.carTitle)}</h1>
    <p style="margin:0 0 18px;color:${TEXT_MUTED};font-size:14px;">${opts.carTitle}</p>
    ${carBlock}
    <p style="margin:0 0 22px;color:#3f3f46;font-size:15px;line-height:1.6;">${firstName ? `Hola ${firstName}, ${copy.body.charAt(0).toLowerCase()}${copy.body.slice(1)}` : copy.body}</p>
    <a href="${opts.trackingUrl}" style="display:inline-block;background:${ORANGE};color:#fff;font-size:14px;font-weight:700;padding:13px 26px;border-radius:8px;text-decoration:none;">${copy.cta}</a>
  `;
  return customerEmailShell({ dealerName: opts.dealerName, dealerLogo: opts.dealerLogo, title: copy.heading(opts.carTitle), body });
}

const MILESTONE_SUBJECT: Record<CustomerMilestone, string> = {
  inspeccion: 'Hemos inspeccionado tu coche en Alemania',
  comprado: 'Tu coche ya está comprado',
  en_transporte: 'Tu coche está de camino a España',
  en_espana: 'Tu coche ya está en España',
  entregado: 'Tu coche está listo',
};

export async function notifyCustomerMilestone(opts: {
  to: string;
  dealerName: string;
  dealerLogo?: string | null;
  clientName?: string | null;
  carTitle: string;
  carImage?: string | null;
  milestone: CustomerMilestone;
  trackingUrl: string;
}) {
  const html = renderCustomerMilestoneEmail(opts);
  try {
    await sendEmailDirect({ to: opts.to, subject: MILESTONE_SUBJECT[opts.milestone], html, senderName: opts.dealerName });
    return true;
  } catch (error) {
    console.error('Failed to send customer milestone email:', error);
    return false;
  }
}

export function renderReSearchEmail(opts: {
  dealerName: string;
  clientName: string;
  make?: string | null;
  model?: string | null;
  mobileUrl?: string | null;
  daysSinceLastActivity: number;
  dashboardUrl: string;
}): string {
  const carDesc = [opts.make, opts.model].filter(Boolean).join(' ') || 'un coche';

  return dealerEmailShell(`Recordatorio: ${opts.clientName}`, `
    <p style="margin:0 0 4px;color:#f59e0b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Recordatorio</p>
    <h1 style="margin:0 0 16px;color:#fff;font-size:20px;font-weight:700;">${opts.clientName} sigue esperando</h1>
    <p style="margin:0 0 16px;color:${ZINC_400};font-size:14px;line-height:1.6;">
      Han pasado <strong style="color:#fff;">${opts.daysSinceLastActivity} días</strong> desde la última actividad con este cliente.
      ${opts.clientName} busca <strong style="color:#fff;">${carDesc}</strong>. Puede que haya opciones nuevas en mobile.de.
    </p>
    ${opts.mobileUrl ? `<a href="${opts.mobileUrl}" style="display:inline-block;background:${ORANGE};color:#fff;font-size:14px;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;margin-right:8px;">Buscar en mobile.de</a>` : ''}
    <a href="${opts.dashboardUrl}" style="display:inline-block;background:#27272a;border:1px solid ${ZINC_700};color:#fff;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none;">Ver cliente</a>
  `);
}
