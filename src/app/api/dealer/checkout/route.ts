import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { stripe } from '@/lib/stripe';
import { getDealerPriceId, type DealerPlanType } from '@/lib/dealer-plans';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  const { plan, billingPeriod = 'monthly' } = await request.json();

  const validPlans: DealerPlanType[] = ['dealer', 'profesional', 'profesional_plus', 'compraventa_dealer'];
  if (!plan || !validPlans.includes(plan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }

  if (!['monthly', 'yearly'].includes(billingPeriod)) {
    return NextResponse.json({ error: 'Invalid billing period' }, { status: 400 });
  }

  const priceId = getDealerPriceId(plan, billingPeriod);
  if (!priceId) {
    return NextResponse.json({ error: 'Price not configured' }, { status: 500 });
  }

  const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

  const serviceClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: existing } = await serviceClient
    .from('dealer_profiles')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  let customerId = existing?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { user_id: user.id, type: 'dealer' },
    });
    customerId = customer.id;

    if (existing) {
      await serviceClient
        .from('dealer_profiles')
        .update({ stripe_customer_id: customerId })
        .eq('user_id', user.id);
    }
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    success_url: `${baseUrl}/dealer/operaciones?checkout=success`,
    cancel_url: `${baseUrl}/dealer?checkout=cancel`,
    metadata: {
      user_id: user.id,
      plan,
      billing_period: billingPeriod,
      type: 'dealer',
    },
    subscription_data: {
      metadata: {
        user_id: user.id,
        plan,
        type: 'dealer',
      },
    },
  });

  return NextResponse.json({ url: session.url });
}
