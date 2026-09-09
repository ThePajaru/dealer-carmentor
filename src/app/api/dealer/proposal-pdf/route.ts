import { NextRequest, NextResponse } from 'next/server';
import { requireDealerAuth, AuthError, dealerServiceClient } from '@/lib/dealer-auth';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);

    let body: {
      client_request_id: string;
      lead_ids: string[];
      comparison_text?: string;
      recommendation?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // Fetch client info
    const { data: clientReq } = await dealerServiceClient
      .from('dealer_client_requests')
      .select('*')
      .eq('id', body.client_request_id)
      .eq('dealer_id', dealerProfile.id)
      .single();

    if (!clientReq) {
      return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
    }

    // Fetch selected leads with analyses
    const { data: leads } = await dealerServiceClient
      .from('dealer_leads')
      .select('id, source_url, is_shortlisted, car_analyses(id, title, car_image_url, result_json, source_url)')
      .in('id', body.lead_ids)
      .eq('dealer_id', dealerProfile.id);

    // Fetch presupuestos for these leads
    const leadIds = (leads || []).map((l: any) => l.id);
    let presupuestos: any[] = [];
    if (leadIds.length > 0) {
      const { data } = await dealerServiceClient
        .from('dealer_presupuestos')
        .select('*')
        .in('lead_id', leadIds);
      presupuestos = data || [];
    }

    // Build car data for PDF
    const cars = (leads || [])
      .filter((l: any) => l.car_analyses)
      .map((l: any) => {
        const a = l.car_analyses;
        const r = a.result_json || {};
        const presu = presupuestos.find((p: any) => p.lead_id === l.id);
        return {
          title: a.title || r.titulo || 'Sin título',
          image: a.car_image_url || null,
          price: r.precio_publicado || r.precio || null,
          year: r.año || r.matriculacion || null,
          km: r.kilometraje || null,
          fuel: r.combustible || null,
          power: r.potencia || null,
          score: r.puntuacion_global || r.score || null,
          pros: (r.ventajas || []).slice(0, 3),
          cons: (r.desventajas || []).slice(0, 3),
          presupuesto: presu ? {
            purchase_price: presu.purchase_price,
            transport_cost: presu.transport_cost,
            gestoria_cost: presu.gestoria_cost,
            itv_cost: presu.itv_cost,
            plates_cost: presu.plates_cost,
            other_costs: presu.other_costs,
            total_cost: presu.total_cost,
            selling_price: presu.selling_price,
          } : null,
        };
      });

    // Generate HTML for the proposal
    const html = renderProposalHtml({
      dealerName: dealerProfile.business_name,
      dealerPhone: dealerProfile.phone || dealerProfile.whatsapp || '',
      dealerLogo: dealerProfile.logo_url,
      clientName: clientReq.client_name,
      cars,
      comparisonText: body.comparison_text,
      recommendation: body.recommendation,
    });

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="propuesta-${clientReq.client_name.replace(/\s+/g, '-').toLowerCase()}.html"`,
      },
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '-';
  return n.toLocaleString('es-ES');
}

function renderProposalHtml(opts: {
  dealerName: string;
  dealerPhone: string;
  dealerLogo: string | null;
  clientName: string;
  cars: any[];
  comparisonText?: string;
  recommendation?: string;
}): string {
  const carCards = opts.cars.map((car, i) => {
    const prosHtml = car.pros.map((p: string) => `<li style="color:#22c55e;margin:2px 0;"><span style="color:#d4d4d8;">${p}</span></li>`).join('');
    const consHtml = car.cons.map((c: string) => `<li style="color:#ef4444;margin:2px 0;"><span style="color:#d4d4d8;">${c}</span></li>`).join('');

    let presuHtml = '';
    if (car.presupuesto) {
      const p = car.presupuesto;
      const costs = [
        { label: 'Precio de compra', value: p.purchase_price },
        { label: 'Transporte', value: p.transport_cost },
        { label: 'Gestoría', value: p.gestoria_cost },
        { label: 'ITV', value: p.itv_cost },
        { label: 'Matriculación', value: p.plates_cost },
      ].filter(c => c.value);

      const otherCosts = (p.other_costs || [])
        .map((oc: any) => `<tr><td style="padding:4px 0;color:#a1a1aa;font-size:13px;">${oc.label || 'Otro'}</td><td style="text-align:right;padding:4px 0;color:#e4e4e7;font-size:13px;">${fmt(oc.amount)}€</td></tr>`)
        .join('');

      presuHtml = `
        <div style="margin-top:16px;background:#18181b;border:1px solid #3f3f46;border-radius:8px;padding:16px;">
          <p style="margin:0 0 12px;color:#ea580c;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Presupuesto</p>
          <table style="width:100%;border-collapse:collapse;">
            ${costs.map(c => `<tr><td style="padding:4px 0;color:#a1a1aa;font-size:13px;">${c.label}</td><td style="text-align:right;padding:4px 0;color:#e4e4e7;font-size:13px;">${fmt(c.value)}€</td></tr>`).join('')}
            ${otherCosts}
            <tr><td colspan="2" style="border-top:1px solid #3f3f46;padding:8px 0 4px;"></td></tr>
            <tr><td style="padding:4px 0;color:#fff;font-weight:700;font-size:14px;">Total llave en mano</td><td style="text-align:right;padding:4px 0;color:#ea580c;font-weight:700;font-size:16px;">${fmt(p.selling_price)}€</td></tr>
          </table>
        </div>
      `;
    }

    return `
      <div style="background:#0f0f0f;border:1px solid #27272a;border-radius:12px;padding:24px;margin-bottom:20px;page-break-inside:avoid;">
        <div style="display:flex;align-items:flex-start;gap:16px;margin-bottom:16px;">
          ${car.image ? `<img src="${car.image}" style="width:140px;height:95px;object-fit:cover;border-radius:8px;border:1px solid #27272a;" />` : ''}
          <div>
            <h3 style="margin:0 0 8px;color:#fff;font-size:18px;font-weight:700;">${car.title}</h3>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${car.year ? `<span style="background:#27272a;border:1px solid #3f3f46;border-radius:6px;padding:3px 8px;font-size:12px;color:#d4d4d8;">${car.year}</span>` : ''}
              ${car.km ? `<span style="background:#27272a;border:1px solid #3f3f46;border-radius:6px;padding:3px 8px;font-size:12px;color:#d4d4d8;">${fmt(car.km)} km</span>` : ''}
              ${car.fuel ? `<span style="background:#27272a;border:1px solid #3f3f46;border-radius:6px;padding:3px 8px;font-size:12px;color:#d4d4d8;">${car.fuel}</span>` : ''}
              ${car.power ? `<span style="background:#27272a;border:1px solid #3f3f46;border-radius:6px;padding:3px 8px;font-size:12px;color:#d4d4d8;">${car.power}</span>` : ''}
              ${car.score ? `<span style="background:#ea580c20;border:1px solid #ea580c40;border-radius:6px;padding:3px 8px;font-size:12px;color:#fb923c;font-weight:700;">${car.score}/10</span>` : ''}
            </div>
          </div>
        </div>
        ${(prosHtml || consHtml) ? `
        <div style="display:flex;gap:16px;margin-bottom:8px;">
          ${prosHtml ? `<div style="flex:1;"><p style="margin:0 0 6px;color:#22c55e;font-size:11px;font-weight:700;text-transform:uppercase;">Ventajas</p><ul style="margin:0;padding-left:16px;font-size:13px;line-height:1.8;">${prosHtml}</ul></div>` : ''}
          ${consHtml ? `<div style="flex:1;"><p style="margin:0 0 6px;color:#ef4444;font-size:11px;font-weight:700;text-transform:uppercase;">A tener en cuenta</p><ul style="margin:0;padding-left:16px;font-size:13px;line-height:1.8;">${consHtml}</ul></div>` : ''}
        </div>
        ` : ''}
        ${presuHtml}
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Propuesta — ${opts.clientName}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  * { box-sizing: border-box; }
  body { margin:0; padding:0; background:#0a0a0a; font-family:'Inter',system-ui,sans-serif; color:#d4d4d8; }
  @media print {
    body { background: #0a0a0a !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div style="max-width:680px;margin:0 auto;padding:32px 20px;">
  <!-- Header -->
  <div style="text-align:center;margin-bottom:32px;padding-bottom:24px;border-bottom:1px solid #27272a;">
    <div style="background:#ea580c;width:48px;height:4px;border-radius:4px;margin:0 auto 16px;"></div>
    <h1 style="margin:0 0 4px;color:#fff;font-size:24px;font-weight:800;letter-spacing:-0.5px;">${opts.dealerName.toUpperCase()}</h1>
    <p style="margin:0;color:#71717a;font-size:13px;">Propuesta personalizada para ${opts.clientName}</p>
    <p style="margin:8px 0 0;color:#71717a;font-size:12px;">${new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
  </div>

  <!-- Intro -->
  <div style="margin-bottom:28px;">
    <p style="margin:0;color:#a1a1aa;font-size:14px;line-height:1.7;">
      Hola <strong style="color:#fff;">${opts.clientName}</strong>, hemos analizado ${opts.cars.length} opciones que encajan con lo que buscas.
      A continuación te presentamos cada una con todos los datos y costes desglosados.
    </p>
  </div>

  <!-- Cars -->
  ${carCards}

  <!-- Comparison -->
  ${opts.comparisonText ? `
  <div style="background:#18181b;border:1px solid #3f3f46;border-radius:12px;padding:24px;margin-bottom:20px;">
    <h2 style="margin:0 0 12px;color:#ea580c;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Comparativa</h2>
    <p style="margin:0;color:#d4d4d8;font-size:14px;line-height:1.7;">${opts.comparisonText.replace(/\n/g, '<br>')}</p>
  </div>
  ` : ''}

  <!-- Recommendation -->
  ${opts.recommendation ? `
  <div style="background:linear-gradient(135deg,#ea580c15,#ea580c08);border:1px solid #ea580c30;border-radius:12px;padding:24px;margin-bottom:20px;">
    <h2 style="margin:0 0 12px;color:#fb923c;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Nuestra recomendación</h2>
    <p style="margin:0;color:#e4e4e7;font-size:14px;line-height:1.7;">${opts.recommendation.replace(/\n/g, '<br>')}</p>
  </div>
  ` : ''}

  <!-- Footer -->
  <div style="text-align:center;padding-top:24px;border-top:1px solid #27272a;">
    <p style="margin:0 0 8px;color:#71717a;font-size:13px;">¿Te interesa alguna opción?</p>
    ${opts.dealerPhone ? `<a href="https://wa.me/${opts.dealerPhone.replace(/[^0-9+]/g, '')}" style="display:inline-block;background:#22c55e;color:#fff;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;">Responder por WhatsApp</a>` : ''}
    ${opts.dealerPhone ? `<p style="margin:12px 0 0;color:#52525b;font-size:12px;">${opts.dealerPhone}</p>` : ''}
  </div>
</div>
</body></html>`;
}
