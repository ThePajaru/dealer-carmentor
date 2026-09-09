'use client';

import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { useDealer } from '@/hooks/useDealer';
import { DEALER_PLAN_LIMITS, type DealerPlanType } from '@/lib/dealer-plans';
import ModelSearch, { type SearchVehicle } from './ModelSearch';
import type { Listing } from '@/lib/dealer/sourcing';

// The búsqueda workspace: search every requested model IN-APP, tick the ads you
// like across any engine or model, and analyze the whole selection in one click.
// The selection lives here (not per model) so it follows the dealer across the
// page; the floating bar is the single "Analizar" action.

/** Cap per batch: the backend takes 25, but each ad spends one analysis of the
 *  dealer's plan — 5 keeps you comparing candidates without burning the cupo. */
const MAX_SELECTION = 5;

export default function BuscarSearch({
  vehicles, token, requestId, onAnalyzed, analyzedUrls,
}: {
  vehicles: SearchVehicle[];
  token: string;
  requestId: string;
  onAnalyzed: () => void | Promise<void>;
  /** source_urls already analyzed for this operation — those ads show "Ya analizado". */
  analyzedUrls: Set<string>;
}) {
  const { dealerProfile } = useDealer();
  const planKey = (dealerProfile?.plan || 'dealer') as DealerPlanType;
  const limit = DEALER_PLAN_LIMITS[planKey] || 500;
  const used = dealerProfile?.analyses_used ?? 0;
  const remaining = Math.max(limit - used, 0);

  const [selected, setSelected] = useState<Listing[]>([]);
  const [justQueued, setJustQueued] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSelected = (url: string) => selected.some(s => s.url === url);
  const full = selected.length >= MAX_SELECTION;
  const toggle = (l: Listing) => {
    setError(null);
    setSelected(prev => {
      if (prev.some(p => p.url === l.url)) return prev.filter(p => p.url !== l.url);
      if (prev.length >= MAX_SELECTION) return prev;
      return [...prev, l];
    });
  };

  // Ads already analyzed (from the DB) plus the ones just queued this session.
  const analyzed = new Set<string>([...analyzedUrls, ...justQueued]);

  const analyzeSelected = async () => {
    if (!selected.length || sending) return;
    const urls = selected.map(s => s.url);
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/dealer/batch-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ urls, client_request_id: requestId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || 'No se pudo lanzar el análisis.');
      }
      setJustQueued(prev => new Set([...prev, ...urls]));
      setSelected([]);
      await onAnalyzed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (vehicles.length === 0) return null;

  return (
    <div>
      {vehicles.map((v, i) => (
        <ModelSearch
          key={`${v.make}-${v.model}-${i}`}
          vehicle={v}
          token={token}
          isSelected={isSelected}
          toggle={toggle}
          full={full}
          analyzedUrls={analyzed}
        />
      ))}

      {/* Floating selection bar — follows the dealer across models. */}
      {selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center p-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-d-border-strong bg-d-surface-3 pl-4 pr-2.5 py-2.5 shadow-2xl">
            <div className="min-w-0">
              <p className="text-d-text text-[13px] font-semibold">
                <span className="d-num">{selected.length}</span> de <span className="d-num">{MAX_SELECTION}</span> seleccionados
              </p>
              <p className={`text-[11px] ${error ? 'text-d-red' : 'text-d-dim'}`}>
                {error || <>Gasta <span className="d-num">{selected.length}</span> análisis · te quedan <span className="d-num">{remaining}</span></>}
              </p>
            </div>
            <button
              onClick={() => setSelected([])}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-d-dim hover:text-d-text border border-d-border transition-colors"
            >
              Vaciar
            </button>
            <button
              onClick={analyzeSelected}
              disabled={sending}
              className="d-btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold"
            >
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Analizar {selected.length}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
