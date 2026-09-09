import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-08-27.basil',
  typescript: true,
});

// Price IDs for subscription plans
export const STRIPE_PRICE_IDS = {
  pro: {
    monthly: process.env.STRIPE_PRO_PRICE_ID!,
    yearly: process.env.STRIPE_PRO_ANUAL_PRICE_ID!,
  },
  max: {
    monthly: process.env.STRIPE_MAX_PRICE_ID!,
    yearly: process.env.STRIPE_MAX_ANUAL_PRICE_ID!,
  },
  compraventa: {
    monthly: process.env.STRIPE_COMPRAVENTA_PRICE_ID!,
    yearly: process.env.STRIPE_COMPRAVENTA_ANUAL_PRICE_ID!,
  },
} as const;

// Plan limits
// ⚠️ Pro lowered 25 → 20 (2026-06 repricing). The authoritative limit for
// *subscribed* users lives in the Postgres `get_user_usage` / `can_user_analyze`
// RPCs — update those too (see DEPLOY checklist) or quota will drift from display.
export const PLAN_LIMITS = {
  pro: 20,
  max: 150,
  compraventa: 750,
} as const;

// Plan names for display
export const PLAN_NAMES = {
  pro: 'Pro',
  max: 'Max',
  compraventa: 'Ilimitado',
} as const;

// Plan prices for display
// ⚠️ Display only. What the customer is CHARGED is the Stripe price behind the
// price IDs above. After lowering Pro to €9.95 you MUST point STRIPE_PRO_PRICE_ID /
// STRIPE_PRO_ANUAL_PRICE_ID at new €9.95 Stripe prices, or you display €9.95 and
// charge €14.95. See DEPLOY_pricing-2026-06.md.
export const PLAN_PRICES = {
  pro: '€9.95',
  max: '€39.95',
  compraventa: '€119.95',
} as const;

// One-off "pago por análisis" — the on-ramp for one-and-done buyers who will
// never subscribe. Requires a one-time (mode=payment) Stripe price.
export const ONEOFF_PRICE_ID = process.env.STRIPE_ONEOFF_PRICE_ID || '';
export const ONEOFF_CREDITS = 1;            // analyses granted per purchase
export const ONEOFF_PRICE_DISPLAY = '€3.49';
export const ONEOFF_CREDIT_EXPIRY_DAYS = 30;

export function getOneOffPriceId(): string {
  return ONEOFF_PRICE_ID;
}

export type PlanType = keyof typeof STRIPE_PRICE_IDS;

// Helper function to get plan from price ID
export function getPlanFromPriceId(priceId: string): { plan: PlanType; billingPeriod: 'monthly' | 'yearly' } | null {
  for (const [plan, prices] of Object.entries(STRIPE_PRICE_IDS)) {
    if (prices.monthly === priceId) {
      return { plan: plan as PlanType, billingPeriod: 'monthly' };
    }
    if (prices.yearly === priceId) {
      return { plan: plan as PlanType, billingPeriod: 'yearly' };
    }
  }
  return null;
}

// Helper function to get price ID from plan and billing period
export function getPriceIdFromPlan(plan: PlanType, billingPeriod: 'monthly' | 'yearly' = 'monthly'): string {
  return STRIPE_PRICE_IDS[plan][billingPeriod];
}
