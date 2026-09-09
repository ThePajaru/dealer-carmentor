import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { DEALER_PLAN_LIMITS, type DealerPlanType } from './dealer-plans';

const serviceClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Reused across requests for the network fallback (see requireDealerAuth).
const anonClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Fast path: verify a Supabase HS256 access token locally with the shared JWT
 * secret, avoiding a ~200ms round-trip to the Supabase auth server on every
 * dealer API call. Returns the user id (`sub`), or null to tell the caller to
 * fall back to the network verification (`auth.getUser`).
 *
 * Returning null on ANY doubt (secret unset, wrong alg, bad signature, expired,
 * malformed) is deliberate: the fallback then re-checks over the network, so a
 * conservative local check can never accept a token the auth server would
 * reject — worst case it's just as slow as before. To enable the fast path, set
 * SUPABASE_JWT_SECRET (Supabase dashboard → Settings → API → JWT Secret).
 */
function verifyAccessTokenLocally(token: string): string | null {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64urlToBuffer(headerB64).toString('utf8'));
    payload = JSON.parse(b64urlToBuffer(payloadB64).toString('utf8'));
  } catch {
    return null;
  }

  // Pin the algorithm — never trust the token's own header to pick it (alg-confusion).
  if (header.alg !== 'HS256') return null;

  const expected = crypto.createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest();
  let provided: Buffer;
  try {
    provided = b64urlToBuffer(signatureB64);
  } catch {
    return null;
  }
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null;

  // Reject expired tokens (5s clock skew) so they take the fallback and 401 there.
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now - 5) return null;
  if (payload.aud !== 'authenticated') return null;

  return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
}

export interface DealerProfile {
  id: string;
  user_id: string;
  business_name: string;
  slug: string;
  logo_url: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  default_transport: number;
  default_gestoria: number;
  default_itv: number;
  default_plates: number;
  default_margin_pct: number;
  deduct_import_vat: boolean;
  dealers_only_comps: boolean;
  plan: DealerPlanType;
  plan_status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  analyses_used: number;
  current_period_start: string | null;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}

function getUserFromToken(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.replace('Bearer ', '');
}

export async function getDealerProfile(userId: string): Promise<DealerProfile | null> {
  const { data, error } = await serviceClient
    .from('dealer_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching dealer profile:', JSON.stringify(error));
    return null;
  }
  return data as DealerProfile | null;
}

export async function getDealerProfileBySlug(slug: string): Promise<DealerProfile | null> {
  const { data, error } = await serviceClient
    .from('dealer_profiles')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    console.error('Error fetching dealer by slug:', JSON.stringify(error));
    return null;
  }
  return data as DealerProfile | null;
}

export async function requireDealerAuth(request: NextRequest): Promise<{ userId: string; dealerProfile: DealerProfile; token: string }> {
  const token = getUserFromToken(request);
  if (!token) throw new AuthError('Missing authorization token', 401);

  // Fast path: verify the JWT locally (no auth-server round-trip). Falls back to
  // the network check when the secret is unset or the token can't be trusted
  // locally — so this is always at least as correct as getUser().
  let userId = verifyAccessTokenLocally(token);
  if (!userId) {
    const { data, error } = await anonClient.auth.getUser(token);
    if (error || !data?.user) throw new AuthError('Invalid token', 401);
    userId = data.user.id;
  }

  const dealerProfile = await getDealerProfile(userId);
  if (!dealerProfile) throw new AuthError('No dealer profile found', 403);

  return { userId, dealerProfile, token };
}

export async function getDealerUsage(dealerId: string): Promise<number> {
  const { count, error } = await serviceClient
    .from('dealer_leads')
    .select('*', { count: 'exact', head: true })
    .eq('dealer_id', dealerId)
    .not('analysis_id', 'is', null);

  if (error) {
    console.error('Error getting dealer usage:', JSON.stringify(error));
    return 0;
  }
  return count || 0;
}

// Hard paywall: a dealer must have an active subscription to analyze. New dealers
// are created with plan_status='inactive' (DB default) and must subscribe first —
// the UI surfaces a visible paywall/checkout CTA (not a silent 429). To offer a
// product trial instead, raise this above 0: 'inactive'/'trial' dealers would then
// get this many free analyses, and the Stripe webhook already resets analyses_used
// to 0 on subscribe so a trial wouldn't eat the paid quota.
export const DEALER_TRIAL_ANALYSES = 0;

/** Effective analysis quota for a dealer (plan- and status-aware). */
export function dealerAnalysisLimit(dealerProfile: DealerProfile): number {
  if (dealerProfile.plan_status === 'active') {
    return DEALER_PLAN_LIMITS[dealerProfile.plan as DealerPlanType] || 0;
  }
  // Not yet subscribed (or canceled / past_due / unpaid) → trial quota (0 = paywall).
  if (dealerProfile.plan_status === 'inactive' || dealerProfile.plan_status === 'trial') {
    return DEALER_TRIAL_ANALYSES;
  }
  return 0;
}

/** Analyses the dealer can still run this period (never negative). */
export function dealerAnalysesRemaining(dealerProfile: DealerProfile): number {
  return Math.max(0, dealerAnalysisLimit(dealerProfile) - (dealerProfile.analyses_used || 0));
}

export function canDealerAnalyze(dealerProfile: DealerProfile): boolean {
  return dealerAnalysesRemaining(dealerProfile) > 0;
}

/** True when the dealer has no active subscription and must subscribe to analyze. */
export function dealerNeedsSubscription(dealerProfile: DealerProfile): boolean {
  return dealerProfile.plan_status !== 'active' && !canDealerAnalyze(dealerProfile);
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'AuthError';
  }
}

export { serviceClient as dealerServiceClient };
