import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { renderPresupuestoHtml, esc, type PresupuestoData } from '@/lib/presupuesto-template';
import { logDealerEvent } from '@/lib/dealer/events';
import { publicOrigin } from '@/lib/public-url';

// Public (no-auth) presupuesto link — this is what the dealer sends over
// WhatsApp. Same renderer as the PDF, so the client sees exactly the document
// that was archived on send; the id is an unguessable UUID and only presupuestos
// the dealer actually sent are readable. Served as raw HTML (not a React page)
// on purpose: the template is a complete document and must not fork.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const VISIBLE = ['enviado', 'aceptado'];

function notFound(): Response {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" /><title>Presupuesto no disponible</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f2ee;color:#161a20;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center;line-height:1.6}
p{color:#5c6570;font-size:15px;max-width:34ch}</style></head>
<body><div><h1 style="font-size:20px;margin:0 0 8px">Presupuesto no disponible</h1>
<p>Este enlace ha caducado o el presupuesto ya no está compartido. Pídele uno nuevo a tu concesionario.</p></div></body></html>`;
  return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The dealer previewing their own link must not count as "el cliente lo abrió".
  const isPreview = request.nextUrl.searchParams.get('preview') === '1';

  if (!/^[0-9a-f-]{36}$/i.test(id)) return notFound();

  const { data: presu } = await supabase
    .from('dealer_presupuestos')
    .select('id, dealer_id, status, presupuesto_data, viewed_at, view_count, dealer_leads(client_name, client_request_id)')
    .eq('id', id)
    .maybeSingle();

  const data = (presu as any)?.presupuesto_data as PresupuestoData | null;
  if (!presu || !data || !VISIBLE.includes((presu as any).status)) return notFound();

  // First open is the signal the dealer cares about ("lo ha visto"); later
  // opens only bump the counter.
  if (!isPreview) {
    const firstView = !(presu as any).viewed_at;
    void supabase
      .from('dealer_presupuestos')
      .update({
        view_count: ((presu as any).view_count || 0) + 1,
        ...(firstView ? { viewed_at: new Date().toISOString() } : {}),
      })
      .eq('id', id)
      .then(({ error }: any) => {
        if (error) console.error('presupuesto view tracking failed:', JSON.stringify(error));
      });

    if (firstView) {
      const lead = (presu as any).dealer_leads;
      logDealerEvent(supabase, {
        dealer_id: (presu as any).dealer_id,
        request_id: lead?.client_request_id ?? null,
        type: 'presupuesto_visto',
        payload: { client_name: lead?.client_name ?? null, title: data.title ?? null },
      });
    }
  }

  const url = `${publicOrigin()}/pr/${id}`;
  const desc = data.showPrice !== false && data.price
    ? `Presupuesto de ${data.dealer.name} · ${Math.round(data.price).toLocaleString('es-ES')} € llave en mano`
    : `Presupuesto de ${data.dealer.name}`;

  // Link preview card in WhatsApp: the car photo does the selling before the
  // client even taps.
  const headExtra = `<meta name="robots" content="noindex" />
<link rel="canonical" href="${esc(url)}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${esc(url)}" />
<meta property="og:title" content="${esc(data.title || 'Presupuesto')}" />
<meta property="og:description" content="${esc(desc)}" />
${data.heroImage ? `<meta property="og:image" content="${esc(data.heroImage)}" />` : ''}
<meta name="twitter:card" content="summary_large_image" />
<meta name="theme-color" content="${esc(data.brandColor)}" />`;

  return new Response(renderPresupuestoHtml(data, {
    headExtra,
    accept: { presupuestoId: id, accepted: (presu as any).status === 'aceptado' },
  }), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
