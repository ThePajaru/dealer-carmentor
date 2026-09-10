import { NextRequest, NextResponse } from 'next/server';
import { requireDealerAuth, AuthError, dealerServiceClient } from '@/lib/dealer-auth';
import { stripe } from '@/lib/stripe';
import { logDealerEvent } from '@/lib/dealer/events';
import {
  SERVICES, serviceDef, servicePriceId, isServiceKey, type ServiceKey,
} from '@/lib/dealer/services';
import { signResult } from '@/lib/dealer/service-files';

// Encargos de los servicios con persona detrás (gestor: 576 + IVTM · ingeniero:
// ficha reducida). El precio NUNCA se escribe aquí: se lee del price de Stripe
// y se cachea en memoria, así el importe que ve el dealer es el que va a pagar.

interface CachedPrice { amountCents: number | null; currency: string; at: number }
const priceCache = new Map<string, CachedPrice>();
const PRICE_TTL_MS = 10 * 60 * 1000;

async function priceOf(key: ServiceKey): Promise<CachedPrice | null> {
  const priceId = servicePriceId(key);
  if (!priceId) return null;

  const hit = priceCache.get(priceId);
  if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit;

  try {
    const price = await stripe.prices.retrieve(priceId);
    const fresh: CachedPrice = {
      amountCents: price.unit_amount ?? null,
      currency: price.currency || 'eur',
      at: Date.now(),
    };
    priceCache.set(priceId, fresh);
    return fresh;
  } catch (e) {
    console.error(`Stripe price lookup failed for ${key}:`, e);
    return null;
  }
}

async function catalog() {
  return Promise.all(SERVICES.map(async s => {
    const price = await priceOf(s.key);
    return {
      key: s.key,
      label: s.label,
      who: s.who,
      desc: s.desc,
      deliverable: s.deliverable,
      // configured=false → el price no está en las variables de entorno todavía:
      // la UI enseña el servicio pero sin botón de pago (y no un 500 al pulsar).
      configured: !!servicePriceId(s.key),
      amount_cents: price?.amountCents ?? null,
      currency: price?.currency ?? 'eur',
    };
  }));
}

export async function GET(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);
    const requestId = new URL(request.url).searchParams.get('request_id');

    // Sin request_id se devuelve la cartera entera: es lo que necesitan los
    // niveles Impuestos y Ficha de la consola de operaciones.
    let orders: unknown[] = [];
    {
      let q = dealerServiceClient
        .from('dealer_service_orders')
        .select('*, dealer_client_requests ( client_name, stage )')
        .eq('dealer_id', dealerProfile.id)
        .neq('status', 'cancelado')
        .order('created_at', { ascending: false });
      if (requestId) q = q.eq('request_id', requestId);
      const { data, error } = await q;
      if (error) {
        console.error('Error fetching service orders:', JSON.stringify(error));
        return NextResponse.json({ error: 'Error al obtener los encargos' }, { status: 500 });
      }
      // Los documentos viven en un bucket privado: la base guarda rutas y aquí
      // se cambian por URLs firmadas de una hora.
      orders = await Promise.all(
        (data || []).map(async o => ({ ...o, result: await signResult(o.result) })),
      );
    }

    return NextResponse.json({ catalog: await catalog(), orders });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

// POST — encarga un servicio: guarda la fila (o reutiliza la que quedó a medias)
// y devuelve la URL del checkout one-off de Stripe.
export async function POST(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);

    let body: { request_id?: string; kind?: string; payload?: Record<string, unknown> };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { request_id: requestId, kind } = body;
    if (!requestId || !isServiceKey(kind)) {
      return NextResponse.json({ error: 'Encargo inválido' }, { status: 400 });
    }

    // La operación tiene que ser de este dealer — nunca se confía en el body.
    const { data: job } = await dealerServiceClient
      .from('dealer_client_requests')
      .select('id, stage, client_name')
      .eq('id', requestId)
      .eq('dealer_id', dealerProfile.id)
      .maybeSingle();
    if (!job) return NextResponse.json({ error: 'Operación no encontrada' }, { status: 404 });

    const priceId = servicePriceId(kind);
    if (!priceId) {
      return NextResponse.json({ error: 'Servicio no disponible todavía' }, { status: 503 });
    }

    const payload = (body.payload && typeof body.payload === 'object') ? body.payload : {};
    const now = new Date().toISOString();

    // Encargo vivo del mismo tipo: si ya está pagado no se cobra dos veces.
    const { data: existing } = await dealerServiceClient
      .from('dealer_service_orders')
      .select('*')
      .eq('request_id', requestId)
      .eq('kind', kind)
      .neq('status', 'cancelado')
      .maybeSingle();

    if (existing && existing.status !== 'pendiente_pago') {
      return NextResponse.json({ error: 'Este servicio ya está encargado', order: existing }, { status: 409 });
    }

    let order = existing;
    if (order) {
      const { data, error } = await dealerServiceClient
        .from('dealer_service_orders')
        .update({ payload, updated_at: now })
        .eq('id', order.id)
        .select()
        .single();
      if (error) {
        console.error('Service order update failed:', JSON.stringify(error));
        return NextResponse.json({ error: 'No se pudo guardar el encargo' }, { status: 500 });
      }
      order = data;
    } else {
      const { data, error } = await dealerServiceClient
        .from('dealer_service_orders')
        .insert({
          dealer_id: dealerProfile.id,
          request_id: requestId,
          kind,
          status: 'pendiente_pago',
          payload,
        })
        .select()
        .single();
      if (error) {
        console.error('Service order insert failed:', JSON.stringify(error));
        return NextResponse.json({ error: 'No se pudo guardar el encargo' }, { status: 500 });
      }
      order = data;
    }

    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
    const caseUrl = `${baseUrl}/dealer/clientes/${requestId}`;

    let customerId = dealerProfile.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: dealerProfile.email || undefined,
        metadata: { user_id: dealerProfile.user_id, type: 'dealer' },
      });
      customerId = customer.id;
      await dealerServiceClient
        .from('dealer_profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', dealerProfile.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'payment',
      success_url: `${caseUrl}?servicio=${kind}&pago=ok`,
      cancel_url: `${caseUrl}?servicio=${kind}&pago=cancel`,
      metadata: {
        type: 'dealer_service',
        order_id: order.id,
        kind,
        request_id: requestId,
        dealer_id: dealerProfile.id,
      },
      payment_intent_data: {
        metadata: { type: 'dealer_service', order_id: order.id, kind },
      },
    });

    await dealerServiceClient
      .from('dealer_service_orders')
      .update({ stripe_session_id: session.id, updated_at: new Date().toISOString() })
      .eq('id', order.id);

    logDealerEvent(dealerServiceClient, {
      dealer_id: dealerProfile.id,
      request_id: requestId,
      type: 'servicio_encargado',
      payload: { client_name: job.client_name, title: serviceDef(kind)?.label ?? kind },
    });

    return NextResponse.json({ order, url: session.url });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
