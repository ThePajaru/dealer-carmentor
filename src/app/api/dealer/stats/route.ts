import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDealerAuth, AuthError } from '@/lib/dealer-auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [
      { count: totalLeads },
      { count: leadsNuevo },
      { count: leadsVendido },
      { count: analysesThisMonth },
      { count: presupuestosCount },
    ] = await Promise.all([
      supabase.from('dealer_leads').select('*', { count: 'exact', head: true }).eq('dealer_id', dealerProfile.id).is('deleted_at', null),
      supabase.from('dealer_leads').select('*', { count: 'exact', head: true }).eq('dealer_id', dealerProfile.id).is('deleted_at', null).eq('status', 'nuevo'),
      supabase.from('dealer_leads').select('*', { count: 'exact', head: true }).eq('dealer_id', dealerProfile.id).is('deleted_at', null).eq('status', 'vendido'),
      supabase.from('dealer_leads').select('*', { count: 'exact', head: true }).eq('dealer_id', dealerProfile.id).is('deleted_at', null).not('analysis_id', 'is', null).gte('created_at', startOfMonth),
      supabase.from('dealer_presupuestos').select('*', { count: 'exact', head: true }).eq('dealer_id', dealerProfile.id),
    ]);

    return NextResponse.json({
      total_leads: totalLeads || 0,
      leads_nuevo: leadsNuevo || 0,
      leads_vendido: leadsVendido || 0,
      analyses_this_month: analysesThisMonth || 0,
      presupuestos_count: presupuestosCount || 0,
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
