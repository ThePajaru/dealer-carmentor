import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDealerAuth, AuthError } from '@/lib/dealer-auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);
    const { id } = await params;

    const { data, error } = await supabase
      .from('dealer_presupuestos')
      .select('*, dealer_leads(client_name, client_phone, client_email), car_analyses(*)')
      .eq('id', id)
      .eq('dealer_id', dealerProfile.id)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: 'Presupuesto no encontrado' }, { status: 404 });
    }
    return NextResponse.json({ presupuesto: data });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);
    const { id } = await params;

    let body: Record<string, any>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const allowedFields = [
      'purchase_price', 'transport_cost', 'gestoria_cost', 'itv_cost',
      'plates_cost', 'insurance_cost', 'other_costs', 'selling_price',
      'notes', 'status', 'presupuesto_data', 'purchase_price_is_net',
    ];

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const field of allowedFields) {
      if (body[field] !== undefined) updates[field] = body[field];
    }

    if (updates.status === 'enviado') {
      updates.sent_at = new Date().toISOString();
    }

    const costFields = ['purchase_price', 'transport_cost', 'gestoria_cost', 'itv_cost', 'plates_cost', 'insurance_cost'];
    const hasCostUpdate = costFields.some(f => updates[f] !== undefined) || updates.selling_price !== undefined;

    if (hasCostUpdate) {
      const { data: current } = await supabase
        .from('dealer_presupuestos')
        .select('*')
        .eq('id', id)
        .eq('dealer_id', dealerProfile.id)
        .single();

      if (current) {
        const merged = { ...current, ...updates };
        const otherTotal = Array.isArray(merged.other_costs)
          ? merged.other_costs.reduce((s: number, c: any) => s + (c.amount || 0), 0)
          : 0;
        const totalCost = (merged.purchase_price || 0) + (merged.transport_cost || 0) +
          (merged.gestoria_cost || 0) + (merged.itv_cost || 0) +
          (merged.plates_cost || 0) + (merged.insurance_cost || 0) + otherTotal;
        updates.total_cost = totalCost;
        updates.margin = (merged.selling_price || 0) - totalCost;
        updates.margin_pct = totalCost > 0 ? (updates.margin / totalCost) * 100 : 0;
      }
    }

    const { data, error } = await supabase
      .from('dealer_presupuestos')
      .update(updates)
      .eq('id', id)
      .eq('dealer_id', dealerProfile.id)
      .select()
      .single();

    if (error) {
      console.error('Error updating presupuesto:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al actualizar' }, { status: 500 });
    }

    return NextResponse.json({ presupuesto: data });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
