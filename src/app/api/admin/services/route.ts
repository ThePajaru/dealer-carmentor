import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { AuthError, dealerServiceClient } from '@/lib/dealer-auth';
import { signResult } from '@/lib/dealer/service-files';
import { isServiceKey } from '@/lib/dealer/services';

// Cola de trabajo del colaborador: todos los encargos de trámites, de todos los
// dealers. Solo lee — cada cambio va por PATCH a /api/admin/services/[id].

const STATUSES = ['pendiente_pago', 'pagado', 'en_tramite', 'completado', 'cancelado'];

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const kind = url.searchParams.get('kind');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 200);

    let query = dealerServiceClient
      .from('dealer_service_orders')
      .select(`
        *,
        dealer_profiles ( business_name, email, phone ),
        dealer_client_requests ( client_name, client_phone, stage )
      `)
      .order('paid_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    // Por defecto se esconde lo que aún no se ha pagado: un checkout abandonado
    // no es trabajo para nadie.
    if (status && STATUSES.includes(status)) query = query.eq('status', status);
    else query = query.neq('status', 'pendiente_pago').neq('status', 'cancelado');

    if (kind && isServiceKey(kind)) query = query.eq('kind', kind);

    const { data, error } = await query;
    if (error) {
      console.error('Admin services list failed:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al obtener los encargos' }, { status: 500 });
    }

    // Las rutas del bucket privado se firman aquí; nunca viajan crudas.
    const orders = await Promise.all(
      (data || []).map(async o => ({ ...o, result: await signResult(o.result) })),
    );

    // Contadores para las pestañas — una consulta corta, no la lista entera.
    const { data: counts } = await dealerServiceClient
      .from('dealer_service_orders')
      .select('status')
      .neq('status', 'pendiente_pago');

    const byStatus = (counts || []).reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({ orders, counts: byStatus });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
