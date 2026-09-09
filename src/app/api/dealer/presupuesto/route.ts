import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDealerAuth, AuthError } from '@/lib/dealer-auth';
import { logDealerEvent } from '@/lib/dealer/events';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const { data, count, error } = await supabase
      .from('dealer_presupuestos')
      .select('*, dealer_leads(client_name, client_phone), car_analyses(title, car_image_url)', { count: 'exact' })
      .eq('dealer_id', dealerProfile.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching presupuestos:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al obtener presupuestos' }, { status: 500 });
    }

    return NextResponse.json({ presupuestos: data || [], total: count || 0 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);

    let body: {
      lead_id?: string;
      analysis_id?: string;
      purchase_price?: number;
      transport_cost?: number;
      gestoria_cost?: number;
      itv_cost?: number;
      plates_cost?: number;
      insurance_cost?: number;
      other_costs?: Array<{ label: string; amount: number }>;
      selling_price?: number;
      notes?: string;
      presupuesto_data?: unknown;
      purchase_price_is_net?: boolean;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const transport = body.transport_cost ?? dealerProfile.default_transport;
    const gestoria = body.gestoria_cost ?? dealerProfile.default_gestoria;
    const itv = body.itv_cost ?? dealerProfile.default_itv;
    const plates = body.plates_cost ?? dealerProfile.default_plates;
    const insurance = body.insurance_cost ?? 0;
    const otherCosts = body.other_costs || [];
    const otherTotal = otherCosts.reduce((sum, c) => sum + (c.amount || 0), 0);
    const purchasePrice = body.purchase_price || 0;

    const totalCost = purchasePrice + transport + gestoria + itv + plates + insurance + otherTotal;
    const sellingPrice = body.selling_price || (totalCost * (1 + (dealerProfile.default_margin_pct / 100)));
    const margin = sellingPrice - totalCost;
    const marginPct = totalCost > 0 ? (margin / totalCost) * 100 : 0;

    const { data, error } = await supabase
      .from('dealer_presupuestos')
      .insert({
        dealer_id: dealerProfile.id,
        lead_id: body.lead_id || null,
        analysis_id: body.analysis_id || null,
        purchase_price: purchasePrice,
        transport_cost: transport,
        gestoria_cost: gestoria,
        itv_cost: itv,
        plates_cost: plates,
        insurance_cost: insurance,
        other_costs: otherCosts,
        purchase_price_is_net: body.purchase_price_is_net ?? false,
        total_cost: totalCost,
        selling_price: Math.round(sellingPrice),
        margin: Math.round(margin),
        margin_pct: Math.round(marginPct * 10) / 10,
        notes: body.notes || null,
        presupuesto_data: body.presupuesto_data ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating presupuesto:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al crear presupuesto' }, { status: 500 });
    }

    // Feed event, denormalized with the client + car so it renders without joins.
    try {
      let clientName: string | null = null;
      let requestId: string | null = null;
      let title: string | null = null;
      if (body.lead_id) {
        const { data: lead } = await supabase
          .from('dealer_leads')
          .select('client_name, client_request_id, car_analyses(title)')
          .eq('id', body.lead_id)
          .maybeSingle();
        const ca: any = (lead as any)?.car_analyses;
        clientName = (lead as any)?.client_name ?? null;
        requestId = (lead as any)?.client_request_id ?? null;
        title = (Array.isArray(ca) ? ca[0]?.title : ca?.title) ?? null;
      }
      logDealerEvent(supabase, {
        dealer_id: dealerProfile.id,
        request_id: requestId,
        type: 'presupuesto_creado',
        payload: { client_name: clientName, title, margin: Math.round(margin) },
      });
    } catch (e) {
      console.error('presupuesto event failed:', e);
    }

    return NextResponse.json({ presupuesto: data }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
