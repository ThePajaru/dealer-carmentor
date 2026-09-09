import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';
import { getDealerPlanFromPriceId } from '@/lib/dealer-plans';
import Stripe from 'stripe';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

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
