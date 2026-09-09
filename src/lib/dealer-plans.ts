// Single offered tier as of 2026-06-30. The legacy keys (profesional /
// profesional_plus / compraventa_dealer) are kept ONLY for backward compat so
// existing subscribers aren't locked out of their quota — they are no longer
// shown in any UI. New checkouts use `dealer` (€149, generous cap).
export const DEALER_PLAN_LIMITS = {
  dealer: 500,
  // legacy (do not offer)
  profesional: 50,
  profesional_plus: 150,
  compraventa_dealer: 750,
} as const;

export const DEALER_PLAN_NAMES = {
  dealer: 'CarMentor Dealer',
  profesional: 'Profesional',
  profesional_plus: 'Profesional Plus',
  compraventa_dealer: 'Compraventa',
} as const;

export const DEALER_PLAN_PRICES = {
  dealer: { monthly: '€149', yearly: '€1.490' },
  profesional: { monthly: '€79', yearly: '€790' },
  profesional_plus: { monthly: '€129', yearly: '€1.290' },
  compraventa_dealer: { monthly: '€199', yearly: '€1.990' },
} as const;

export const DEALER_STRIPE_PRICE_IDS = {
  dealer: {
    monthly: process.env.STRIPE_DEALER_PRICE_ID || '',
    yearly: process.env.STRIPE_DEALER_ANUAL_PRICE_ID || '',
  },
  profesional: {
    monthly: process.env.STRIPE_DEALER_PROFESIONAL_PRICE_ID || '',
    yearly: process.env.STRIPE_DEALER_PROFESIONAL_ANUAL_PRICE_ID || '',
  },
  profesional_plus: {
    monthly: process.env.STRIPE_DEALER_PRO_PLUS_PRICE_ID || '',
    yearly: process.env.STRIPE_DEALER_PRO_PLUS_ANUAL_PRICE_ID || '',
  },
  compraventa_dealer: {
    monthly: process.env.STRIPE_DEALER_COMPRAVENTA_PRICE_ID || '',
    yearly: process.env.STRIPE_DEALER_COMPRAVENTA_ANUAL_PRICE_ID || '',
  },
} as const;

export type DealerPlanType = keyof typeof DEALER_PLAN_LIMITS;

/** The single tier offered to new dealers. */
export const DEALER_CURRENT_PLAN: DealerPlanType = 'dealer';

export function getDealerPlanFromPriceId(priceId: string): { plan: DealerPlanType; billingPeriod: 'monthly' | 'yearly' } | null {
  for (const [plan, prices] of Object.entries(DEALER_STRIPE_PRICE_IDS)) {
    if (prices.monthly === priceId) return { plan: plan as DealerPlanType, billingPeriod: 'monthly' };
    if (prices.yearly === priceId) return { plan: plan as DealerPlanType, billingPeriod: 'yearly' };
  }
  return null;
}

export function getDealerPriceId(plan: DealerPlanType, billingPeriod: 'monthly' | 'yearly' = 'monthly'): string {
  return DEALER_STRIPE_PRICE_IDS[plan][billingPeriod];
}

export const DEALER_PLAN_FEATURES = {
  dealer: [
    '500 análisis de coches al mes',
    'Presupuestos PDF con tu logo',
    'Página de captación de clientes',
    'WhatsApp integrado',
    'Gestión completa de leads',
    'Soporte prioritario',
  ],
  profesional: [
    '50 análisis/mes',
    'Presupuestos con marca CarMentor',
    'Gestión de leads',
    'Página de captación pública',
  ],
  profesional_plus: [
    '150 análisis/mes',
    'Presupuestos con TU logo',
    'Enlace de WhatsApp integrado',
    'Gestión de leads avanzada',
    'PDFs profesionales branded',
  ],
  compraventa_dealer: [
    '750 análisis/mes',
    'Todo de Profesional Plus',
    'Multi-usuario (próximamente)',
    'API de integración (próximamente)',
    'Soporte prioritario',
  ],
} as const;
