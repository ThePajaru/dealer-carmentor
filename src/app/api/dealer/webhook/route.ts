import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';
import { getDealerPlanFromPriceId } from '@/lib/dealer-plans';
import { serviceDef, type ServiceKey } from '@/lib/dealer/services';
import { logDealerEvent } from '@/lib/dealer/events';
import { notifyServiceOrderPaid } from '@/lib/dealer/service-notifications';
import Stripe from 'stripe';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);


/**
 * Un trámite pagado. Pasa a 'pagado', se avisa a quien lo ejecuta (gestor o
 * ingeniero) y la operación entra en la fase Trámites si venía de tránsito.
 * Idempotente: Stripe reintenta el mismo evento y un segundo paso no puede
 * volver a mover la etapa ni mandar otro aviso.
 */
async function handleServicePaid(session: Stripe.Checkout.Session): Promise<void> {
  const orderId = session.metadata?.order_id;
  if (!orderId) return;

  const { data: order } = await supabase
    .from('dealer_service_orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) {
    console.error(`Service order ${orderId} not found for paid session ${session.id}`);
    return;
  }
  if (order.status !== 'pendiente_pago') return; // ya procesado

  const paymentIntent = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : (session.payment_intent as Stripe.PaymentIntent | null)?.id ?? null;

  const { error } = await supabase
    .from('dealer_service_orders')
    .update({
      status: 'pagado',
      amount_cents: session.amount_total ?? null,
      currency: session.currency || 'eur',
      stripe_payment_intent: paymentIntent,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .eq('status', 'pendiente_pago');
  if (error) {
    console.error('Service order payment update failed:', JSON.stringify(error));
    return;
  }

  const { data: job } = await supabase
    .from('dealer_client_requests')
    .select('id, stage, client_name')
    .eq('id', order.request_id)
    .maybeSingle();

  // El coche puede seguir rodando: 'transito' es la única etapa que avanza a
  // 'tramites'. Nunca se retrocede una operación ya entregada o perdida.
  if (job?.stage === 'transito') {
    await supabase
      .from('dealer_client_requests')
      .update({ stage: 'tramites', updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('stage', 'transito');
  }

  logDealerEvent(supabase, {
    dealer_id: order.dealer_id,
    request_id: order.request_id,
    type: 'servicio_pagado',
    payload: {
      client_name: job?.client_name ?? null,
      title: serviceDef(order.kind as ServiceKey)?.label ?? order.kind,
    },
  });

  await notifyServiceOrderPaid({
    kind: order.kind as ServiceKey,
    orderId: order.id,
    requestId: order.request_id,
    dealerId: order.dealer_id,
    clientName: job?.client_name ?? null,
    payload: order.payload || {},
  });
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_DEALER_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('STRIPE_DEALER_WEBHOOK_SECRET not set');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;

      // Pago único de un trámite (gestor: 576 + IVTM · ingeniero: ficha
      // reducida). Va antes de la rama de suscripción: es otro `type` y otro
      // `mode`, y no toca dealer_profiles.
      if (session.metadata?.type === 'dealer_service') {
        await handleServicePaid(session);
        break;
      }

      if (session.metadata?.type !== 'dealer') break;

      const userId = session.metadata.user_id;
      const plan = session.metadata.plan;
      if (!userId || !plan) break;

      const subscriptionId = typeof session.subscription === 'string'
        ? session.subscription
        : (session.subscription as any)?.id;

      if (subscriptionId) {
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        await supabase
          .from('dealer_profiles')
          .update({
            plan,
            plan_status: 'active',
            stripe_subscription_id: subscriptionId,
            stripe_customer_id: typeof session.customer === 'string' ? session.customer : null,
            current_period_start: new Date((sub as any).current_period_start * 1000).toISOString(),
            current_period_end: new Date((sub as any).current_period_end * 1000).toISOString(),
            analyses_used: 0,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId);
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      if (sub.metadata?.type !== 'dealer') break;

      const userId = sub.metadata.user_id;
      if (!userId) break;

      const priceId = sub.items.data[0]?.price?.id;
      const planInfo = priceId ? getDealerPlanFromPriceId(priceId) : null;

      await supabase
        .from('dealer_profiles')
        .update({
          plan: planInfo?.plan || 'profesional',
          plan_status: sub.status === 'active' || sub.status === 'trialing' ? 'active' : sub.status,
          current_period_start: new Date((sub as any).current_period_start * 1000).toISOString(),
          current_period_end: new Date((sub as any).current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      if (sub.metadata?.type !== 'dealer') break;

      const userId = sub.metadata.user_id;
      if (!userId) break;

      await supabase
        .from('dealer_profiles')
        .update({
          plan_status: 'canceled',
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
      break;
    }
  }

  return NextResponse.json({ received: true });
}
