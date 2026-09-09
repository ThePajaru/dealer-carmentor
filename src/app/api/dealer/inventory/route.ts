import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDealerAuth, AuthError } from '@/lib/dealer-auth';

// El concesionario virtual: coches que el dealer trabaja para SU stock
// (dealer_client_requests.is_stock = true). Reutiliza el mismo grafo que
// Operaciones (leads → car_analyses → presupuestos) para el coche representativo
// y la economía, pero el ciclo de vida se sigue por `stock_status`.
//
// Vive en /api/dealer/inventory (no /api/dealer/stock: esa ruta es el watchlist
// del Analizar, otro concepto — dealer_stock).
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const STATUS_ORDER: Record<string, number> = { buscando: 0, comprado: 1, en_venta: 2, vendido: 3 };

export async function GET(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);
    const dealerId = dealerProfile.id;

    const { data: reqs, error } = await supabase
      .from('dealer_client_requests')
      .select(`id, client_name, stock_status, make, model, max_price, max_km, min_year, fuel, transmission, mobile_url, vehicles, created_at, updated_at, actual_purchase, listing_price, sold_price, sold_at, runner_expenses,
               dealer_leads ( id, is_shortlisted, created_at, deleted_at, car_analyses ( title, car_image_url ) )`)
      .eq('dealer_id', dealerId)
      .eq('is_stock', true)
      .is('deleted_at', null);

    if (error) {
      console.error('inventory reqs error:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al cargar el stock' }, { status: 500 });
    }

    const items = (reqs || []).map((j: any) => {
      const myLeads = (Array.isArray(j.dealer_leads) ? j.dealer_leads : []).filter((l: any) => !l.deleted_at);
      const sorted = [...myLeads].sort((a, b) => {
        if (!!a.is_shortlisted !== !!b.is_shortlisted) return a.is_shortlisted ? -1 : 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      const caRaw: any = sorted[0]?.car_analyses;
      const ca = Array.isArray(caRaw) ? caRaw[0] : caRaw;
      const car = ca ? { title: ca.title, image: ca.car_image_url } : null;

      const expenses = Array.isArray(j.runner_expenses)
        ? j.runner_expenses.reduce((s: number, e: any) => s + (Number(e?.amount) || 0), 0) : 0;
      const cost = j.actual_purchase != null ? j.actual_purchase + expenses : null;
      // Precio de referencia: lo vendido, si no el precio de venta publicado.
      const salePrice = j.sold_price ?? j.listing_price ?? null;
      const margin = (cost != null && salePrice != null) ? salePrice - cost : null;
      const marginIsReal = j.sold_price != null && cost != null;

      return {
        id: j.id,
        title: car?.title || j.client_name,
        image: car?.image ?? null,
        stock_status: j.stock_status || 'buscando',
        leads_count: myLeads.length,
        mobile_url: j.mobile_url ?? null,
        actual_purchase: j.actual_purchase ?? null,
        listing_price: j.listing_price ?? null,
        sold_price: j.sold_price ?? null,
        sold_at: j.sold_at ?? null,
        cost,
        sale_price: salePrice,
        margin,
        margin_is_real: marginIsReal,
        created_at: j.created_at,
        updated_at: j.updated_at,
      };
    });

    // Orden: por fase del ciclo, y dentro de cada fase lo más reciente primero.
    items.sort((a, b) => {
      const d = (STATUS_ORDER[a.stock_status] ?? 0) - (STATUS_ORDER[b.stock_status] ?? 0);
      if (d !== 0) return d;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

    const activos = items.filter((i) => i.stock_status !== 'vendido');
    const vendidos = items.filter((i) => i.stock_status === 'vendido');
    const kpis = {
      en_stock: items.filter((i) => i.stock_status === 'comprado' || i.stock_status === 'en_venta').length,
      buscando: items.filter((i) => i.stock_status === 'buscando').length,
      vendidos: vendidos.length,
      // Capital inmovilizado: lo pagado por lo que aún no se ha vendido.
      capital: activos.reduce((s, i) => s + (i.actual_purchase || 0), 0),
      // Margen ya realizado (coches vendidos).
      margen_realizado: vendidos.reduce((s, i) => s + (i.margin || 0), 0),
      // Margen potencial en lo publicado.
      margen_potencial: items
        .filter((i) => i.stock_status === 'en_venta')
        .reduce((s, i) => s + (i.margin || 0), 0),
    };

    return NextResponse.json({ items, kpis });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
