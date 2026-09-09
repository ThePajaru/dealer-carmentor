import { renderPresupuestoHtml, type PresupuestoData } from './presupuesto-template';

// Render a presupuesto to PDF bytes via Doppio (same engine the consumer app
// uses). Shared by the on-demand download route and the store-on-send flow, so
// the streamed PDF and the archived one are byte-identical.
export async function renderPresupuestoPdf(data: PresupuestoData): Promise<Buffer> {
  const apiKey = process.env.DROPPIO_API_KEY;
  if (!apiKey) throw new Error('PDF service not configured');

  const base64Html = Buffer.from(renderPresupuestoHtml(data)).toString('base64');

  const doppio = await fetch('https://api.doppio.sh/v1/render/pdf/direct', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      page: {
        pdf: { format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } },
        setContent: { html: base64Html, options: { waitUntil: 'networkidle0' } },
      },
    }),
    signal: AbortSignal.timeout(50000),
  });

  if (!doppio.ok) {
    const details = await doppio.text();
    throw new Error(`Doppio ${doppio.status}: ${details}`);
  }
  return Buffer.from(await doppio.arrayBuffer());
}
