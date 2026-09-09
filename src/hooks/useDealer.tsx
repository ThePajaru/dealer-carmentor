"use client";
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './useAuth';

export interface DealerProfile {
  id: string;
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
  plan: string;
  plan_status: string;
  analyses_used: number;
  current_period_start: string | null;
  current_period_end: string | null;
}

interface DealerState {
  dealerProfile: DealerProfile | null;
  loading: boolean;
  isDealer: boolean;
  refetch: () => Promise<void>;
}

/**
 * Core fetch logic. `active` lets the fallback instance stay inert when a
 * DealerProvider is present (so we never double-fetch).
 */
function useDealerState(active: boolean): DealerState {
  const { user, session, loading: authLoading } = useAuth();
  const [dealerProfile, setDealerProfile] = useState<DealerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    if (!session?.access_token) {
      setDealerProfile(null);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/dealer/profile', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDealerProfile(data.profile);
      } else {
        setDealerProfile(null);
      }
    } catch {
      setDealerProfile(null);
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    if (!active) return;
    // Wait for auth to settle before deciding — prevents a premature
    // "no profile" verdict (which would flash the onboarding redirect).
    if (authLoading) {
      setLoading(true);
      return;
    }
    if (!user?.id) {
      setDealerProfile(null);
      setLoading(false);
      return;
    }
    fetchProfile();
  }, [active, authLoading, user?.id, fetchProfile]);

  return { dealerProfile, loading, isDealer: !!dealerProfile, refetch: fetchProfile };
}

const DealerContext = createContext<DealerState | null>(null);

/** Fetches the dealer profile once and shares it across the whole dealer app. */
export function DealerProvider({ children }: { children: React.ReactNode }) {
  const state = useDealerState(true);
  return <DealerContext.Provider value={state}>{children}</DealerContext.Provider>;
}

/**
 * Returns the shared dealer profile. Inside a DealerProvider this reads the
 * shared context (no refetch on navigation). Outside one (e.g. /dealer/onboarding)
 * it falls back to a standalone fetch.
 */
export function useDealer(): DealerState {
  const ctx = useContext(DealerContext);
  const fallback = useDealerState(ctx === null);
  return ctx ?? fallback;
}
