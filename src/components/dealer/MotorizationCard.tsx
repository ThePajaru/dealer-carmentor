'use client';

import { useEffect, useState } from 'react';
import { Wrench, Loader2, ExternalLink, CheckCircle2, AlertTriangle, Search, SlidersHorizontal, Sparkles, Car, RotateCcw, Copy, Check } from 'lucide-react';
import { resolveMobileSearch } from '@/lib/mobile-de-search';

// Dealer-only motorization advisory (auto-loads). Given a vehicle profile with a
// model, recommends the most reliable engines — and per engine, sources the 5
// best live mobile.de listings as photo cards (price, km, year, mobile.de price
// rating, IVA deducible) with one-tap "Analizar". The dealer can set extra
// filters (solo IVA deducible, solo profesionales, precio/km/año/cambio) before
// sourcing. Orientativo — see docs/DEALER.md §8 for the trust posture.

interface Engine {
  name: string;
  fuel: string | null;
  power_cv: number | null;
  reliability: 'alta' | 'media' | 'baja';
  note: string;
  avoid: boolean;
}
interface Motorizations {
  recommended: string | null;
  summary: string;
  engines: Engine[];
  confidence: string;
}

interface Listing {
  title: string;
  url: string;
  price: number;
  km: number | null;
  year: number | null;
  power_cv: number | null;
  image: string | null;
  rating: string | null;
  vat_deductible: boolean;
  seller_type: 'DEALER' | 'PRIVATE' | null;
  reason?: string | null;
}

interface SourcingState {
  loading: boolean;
  error: string | null;
  listings: Listing[] | null;
  matched: number;
  search_url: string | null;
}

const FUEL_LABEL: Record<string, string> = {
  PETROL: 'Gasolina', DIESEL: 'Diésel', HYBRID: 'Híbrido', HYBRID_PLUGIN: 'Híbrido enchufable', ELECTRICITY: 'Eléctrico',
};

const RATING_BADGE: Record<string, { label: string; cls: string }> = {
  VERY_GOOD_PRICE: { label: 'Muy buen precio', cls: 'bg-d-green/15 text-d-green' },
  GOOD_PRICE: { label: 'Buen precio', cls: 'bg-d-green/10 text-d-green/90' },
  REASONABLE_PRICE: { label: 'Precio razonable', cls: 'bg-d-surface-3 text-d-muted' },
  FAIR_PRICE: { label: 'Precio justo', cls: 'bg-d-surface-3 text-d-muted' },
};

// The motorization the customer explicitly asked for: the closest advisory engine
// within ±20 CV, or a synthetic one at that exact power when the reliability
// advisory doesn't list it. Null when no power was requested. This is what should
// headline the card — not the AI's reliability pick, which ignores the client.
function clientChosenEngine(engines: Engine[], minCv: number | null | undefined, fuel: string | null): Engine | null {
  if (minCv == null) return null;
  const near = engines
    .filter(e => e.power_cv != null && Math.abs((e.power_cv as number) - minCv) <= 20)
    .sort((a, b) => Math.abs((a.power_cv as number) - minCv) - Math.abs((b.power_cv as number) - minCv))[0];
  if (near) return near;
  return { name: `${minCv} CV`, fuel, power_cv: minCv, reliability: 'media', note: 'La motorización que pidió el cliente', avoid: false };
}

export default function MotorizationCard({ make, model, minYear, minCv, fuel, mobileUrl, token, maxPrice, maxKm, transmission, requestId, onAnalyzed }: {
  make: string; model: string; minYear: number | null; minCv?: number | null; fuel: string | null; mobileUrl?: string | null; token: string;
  maxPrice?: number | null; maxKm?: number | null; transmission?: string | null;
  requestId?: string | null;
  onAnalyzed?: () => void;
}) {
  const [data, setData] = useState<Motorizations | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Extra filters the dealer sets before sourcing (prefilled from the client's request).
  const [showFilters, setShowFilters] = useState(false);
  const [fVat, setFVat] = useState(false);
  const [fDealers, setFDealers] = useState(false);
  const [fMaxPrice, setFMaxPrice] = useState(maxPrice != null ? String(maxPrice) : '');
  const [fMaxKm, setFMaxKm] = useState(maxKm != null ? String(maxKm) : '');
  const [fMinYear, setFMinYear] = useState(minYear != null ? String(minYear) : '');
  const [fTrans, setFTrans] = useState(transmission || '');
  const [fVariant, setFVariant] = useState(''); // trim/version keyword, e.g. "GTI"

  const [sourcing, setSourcing] = useState<Record<string, SourcingState>>({});
  // Per-engine "show every listing we already paid for" toggle.
  const [expandedEngines, setExpandedEngines] = useState<Record<string, boolean>>({});
  const [analyzing, setAnalyzing] = useState<Record<string, 'queueing' | 'queued' | 'error'>>({});
  const [copied, setCopied] = useState<string | null>(null);

  // The exact mobile.de search for one engine, built client-side with the
  // CURRENT ajustes — available before any sourcing has run, and copyable.
  const engineSearchUrl = (engine: Engine): string | null => {
    const { makeId, modelMs } = resolveMobileSearch(make, model);
    if (!makeId) return null;
    const params = new URLSearchParams();
    const baseMs = modelMs || `${makeId};;;`;
    // Trim/version (e.g. "GTI") → ms quad's 4th slot (modelDescription).
    params.set('ms', fVariant.trim() ? `${baseMs}${fVariant.trim()}` : baseMs);
    params.set('vc', 'Car');
    params.set('con', 'USED');
    params.set('dam', 'false');
    if (fMinYear) params.set('fr', `${fMinYear}:`);
    if (fMaxKm) params.set('ml', `:${fMaxKm}`);
    if (fMaxPrice) params.set('p', `:${fMaxPrice}`);
    if (fTrans) params.set('tr', fTrans);
    if (engine.fuel) params.set('ft', engine.fuel);
    if (engine.power_cv) {
      const kwMin = Math.round((engine.power_cv - 10) * 0.7355);
      const kwMax = Math.round((engine.power_cv + 10) * 0.7355);
      params.set('pw', `${kwMin}:${kwMax}`);
    }
    params.set('sb', 'p');
    params.set('od', 'up');
    return `https://www.mobile.de/es/veh%C3%ADculos/buscar.html?${params.toString()}`;
  };

  const copyUrl = async (engineName: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(engineName);
      setTimeout(() => setCopied(c => (c === engineName ? null : c)), 2000);
    } catch { /* clipboard denied — the link is still visible to long-press */ }
  };

  // Visible, copyable search URL — used per engine and for the general search.
  const copyableUrlRow = (key: string, url: string) => (
    <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-d-border bg-d-surface-2/40 pl-2.5 pr-1 py-1">
      <a href={url} target="_blank" rel="noopener" className="flex-1 min-w-0 truncate text-[10px] text-d-dim hover:text-d-accent d-num" title={url}>
        {url.replace(/^https:\/\//, '').replace('www.mobile.de/es/veh%C3%ADculos/buscar.html', 'mobile.de/…/buscar')}
      </a>
      <button onClick={() => copyUrl(key, url)} className={`p-1.5 rounded-md shrink-0 ${copied === key ? 'text-d-green' : 'text-d-dim hover:text-d-text hover:bg-d-surface-3'}`} title="Copiar URL de búsqueda">
        {copied === key ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );

  const urlRow = (engine: Engine) => {
    const url = engineSearchUrl(engine) || sourcing[engine.name]?.search_url;
    if (!url) return null;
    return copyableUrlRow(engine.name, url);
  };

  useEffect(() => {
    if (!token) { setLoading(false); setFailed(true); return; }
    let cancelled = false;
    setLoading(true); setFailed(false);
    fetch('/api/dealer/motorizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ make, model, year_from: minYear, fuel }),
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('req failed'))))
      .then((d: Motorizations) => {
        if (cancelled) return;
        if (d.confidence === 'orientativo' && d.engines?.length) setData(d);
        else setFailed(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [make, model, minYear, fuel, token]);

  // NOTE: we deliberately do NOT prefetch the engine listings on mount. Each
  // engine-listings call is a paid Apify scrape (~60 results), and warming 4 of
  // them automatically every time this card renders was burning Apify credit
  // whether or not the dealer used the results. The scrape now runs only on the
  // explicit "Ver los mejores anuncios" tap.

  // Silently disappear when there's no useful advice (no data / Groq down / no key).
  if (failed) return null;

  if (loading) {
    return (
      <div className="rounded-xl border border-d-border bg-d-surface/40 p-4">
        <div className="flex items-center gap-2 text-d-dim text-xs">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando la motorización más fiable de {make} {model}…
        </div>
      </div>
    );
  }
  if (!data) return null;

  // The client's requested motorization headlines the card (falls back to the AI's
  // reliability pick only when they didn't ask for a specific power).
  const chosenEngine = clientChosenEngine(data.engines, minCv, fuel);
  const recEngine = chosenEngine || data.engines.find(e => e.name === data.recommended) || data.engines.find(e => !e.avoid) || null;
  const others = data.engines.filter(e => e !== recEngine);

  // Engine power bands overlap (a 118i can match both B38 and B48 searches), so
  // the same ad can come back for two engines — each engine keeps only the ads not
  // already listed above it. We keep ALL of them (the scrape already charged us
  // per listing); the render shows the top few and lets the dealer expand the rest.
  const displayedByEngine: Record<string, Listing[]> = {};
  {
    const seenUrls = new Set<string>();
    for (const e of [recEngine, ...others].filter((x): x is Engine => !!x)) {
      const ls = sourcing[e.name]?.listings;
      if (!ls) continue;
      const shown = ls.filter(l => !seenUrls.has(l.url));
      shown.forEach(l => seenUrls.add(l.url));
      displayedByEngine[e.name] = shown;
    }
  }
  const PREVIEW_COUNT = 4;

  const sourceEngine = async (engine: Engine) => {
    const key = engine.name;
    setSourcing(prev => ({ ...prev, [key]: { loading: true, error: null, listings: null, matched: 0, search_url: prev[key]?.search_url || null } }));
    try {
      const res = await fetch('/api/dealer/engine-listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          make, model,
          engine: { name: engine.name, fuel: engine.fuel, power_cv: engine.power_cv },
          filters: {
            max_price: fMaxPrice ? Number(fMaxPrice) : null,
            max_km: fMaxKm ? Number(fMaxKm) : null,
            min_year: fMinYear ? Number(fMinYear) : null,
            transmission: fTrans || null,
            vat_deductible: fVat,
            only_dealers: fDealers,
            variant: fVariant.trim() || null,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || 'La búsqueda falló. Reinténtalo.');
      }
      const d = await res.json();
      setSourcing(prev => ({ ...prev, [key]: { loading: false, error: null, listings: d.listings || [], matched: d.matched || 0, search_url: d.search_url || null } }));
    } catch (e) {
      setSourcing(prev => ({ ...prev, [key]: { loading: false, error: (e as Error).message, listings: null, matched: 0, search_url: prev[key]?.search_url || null } }));
    }
  };

  const analyze = async (url: string) => {
    setAnalyzing(prev => ({ ...prev, [url]: 'queueing' }));
    try {
      const res = await fetch('/api/dealer/batch-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ urls: [url], client_request_id: requestId || undefined }),
      });
      if (!res.ok) throw new Error();
      setAnalyzing(prev => ({ ...prev, [url]: 'queued' }));
      onAnalyzed?.();
    } catch {
      setAnalyzing(prev => ({ ...prev, [url]: 'error' }));
    }
  };

  const renderListings = (engine: Engine) => {
    const st = sourcing[engine.name];
    if (!st) return null;
    if (st.loading) {
      return (
        <div className="mt-2 rounded-lg border border-d-border bg-d-surface-2/50 px-3 py-4 flex items-center gap-2 text-d-dim text-xs">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Rastreando mobile.de y eligiendo los 4 mejores…
        </div>
      );
    }
    if (st.error) {
      return (
        <div className="mt-2">
          <p className="text-d-red text-xs">{st.error}</p>
          {researchButton(engine)}
        </div>
      );
    }
    if (!st.listings) return null;
    if (st.listings.length === 0) {
      return (
        <div className="mt-2">
          <p className="text-d-dim text-xs">
            Sin resultados con estos filtros — prueba a relajar precio/km{fVariant.trim() ? `, revisar la versión «${fVariant.trim()}»` : ''} o quitar «solo IVA deducible».
          </p>
          {researchButton(engine)}
        </div>
      );
    }
    const shown = displayedByEngine[engine.name] || [];
    if (shown.length === 0) {
      return (
        <div className="mt-2">
          <p className="text-d-dim text-xs">Los mejores anuncios de este motor coinciden con los ya mostrados arriba.</p>
          {researchButton(engine)}
        </div>
      );
    }
    const isExpanded = !!expandedEngines[engine.name];
    const visible = isExpanded ? shown : shown.slice(0, PREVIEW_COUNT);
    const hidden = shown.length - visible.length;
    return (
      <>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {visible.map((l, i) => {
          const badge = l.rating ? RATING_BADGE[l.rating] : null;
          const an = analyzing[l.url];
          return (
            <div key={i} className="rounded-lg border border-d-border overflow-hidden bg-d-surface-2/40">
              {l.image ? (
                <img src={l.image} alt="" loading="lazy" className="w-full h-28 object-cover" />
              ) : (
                <div className="w-full h-28 bg-d-surface-2 grid place-items-center"><Car className="w-6 h-6 text-d-dim" /></div>
              )}
              <div className="p-2.5">
                <p className="text-d-text text-xs font-medium leading-snug line-clamp-2">{l.title}</p>
                <div className="flex items-baseline gap-2 mt-1.5 flex-wrap">
                  <span className="text-d-text text-sm font-bold d-num">€{l.price.toLocaleString('es-ES')}</span>
                  {badge && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>}
                </div>
                <p className="text-d-dim text-[11px] mt-0.5 d-num">
                  {[l.km != null ? `${l.km.toLocaleString('es-ES')} km` : null, l.year, l.power_cv ? `${l.power_cv} CV` : null].filter(Boolean).join(' · ')}
                </p>
                {l.reason && <p className="text-d-accent/90 text-[11px] mt-1 italic leading-snug">✦ {l.reason}</p>}
                <div className="flex gap-1 mt-1 flex-wrap">
                  {l.vat_deductible && <span className="text-[10px] px-1.5 py-0.5 rounded bg-d-accent/10 text-d-accent">IVA deducible</span>}
                  {l.seller_type === 'DEALER' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-d-surface-3 text-d-muted">Profesional</span>}
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  <button
                    onClick={() => analyze(l.url)}
                    disabled={an === 'queueing' || an === 'queued'}
                    className={`flex-1 py-1.5 rounded-md text-[11px] font-semibold inline-flex items-center justify-center gap-1 ${an === 'queued' ? 'bg-d-green/15 text-d-green' : 'd-btn-primary'}`}
                  >
                    {an === 'queueing' ? <Loader2 className="w-3 h-3 animate-spin" /> : an === 'queued' ? <><CheckCircle2 className="w-3 h-3" /> En análisis</> : <><Sparkles className="w-3 h-3" /> Analizar</>}
                  </button>
                  <a href={l.url} target="_blank" rel="noopener" className="p-1.5 rounded-md text-d-dim hover:text-d-accent hover:bg-d-surface-3" title="Ver anuncio">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
                {an === 'error' && <p className="text-d-red text-[10px] mt-1">No se pudo lanzar — reinténtalo.</p>}
              </div>
            </div>
          );
        })}
      </div>
      {/* The scrape already billed us for every listing it returned, so the rest
          are free to show — just one tap away instead of thrown away. */}
      {(hidden > 0 || isExpanded) && (
        <button
          onClick={() => setExpandedEngines(p => ({ ...p, [engine.name]: !isExpanded }))}
          className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-d-dim hover:text-d-text border border-d-border hover:bg-d-surface-2"
        >
          {isExpanded
            ? <>Ver solo los {PREVIEW_COUNT} mejores</>
            : <>Ver los {hidden} anuncios restantes de este motor</>}
        </button>
      )}
      {researchButton(engine)}
      </>
    );
  };

  // Re-run with the current ajustes (e.g. after toggling «solo IVA deducible»)
  // + the exact mobile.de search this engine's lot came from, to browse it whole.
  // The scrape is cached server-side per search URL, so re-filtering is instant.
  const researchButton = (engine: Engine) => {
    const searchUrl = engineSearchUrl(engine) || sourcing[engine.name]?.search_url;
    return (
      <div className="mt-2">
        <div className="flex gap-1.5">
          <button
            onClick={() => sourceEngine(engine)}
            className="flex-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-d-dim hover:text-d-text border border-d-border hover:bg-d-surface-2 justify-center"
          >
            <RotateCcw className="w-3 h-3" /> Volver a buscar con los ajustes actuales
          </button>
          {searchUrl && (
            <a
              href={searchUrl}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-d-dim hover:text-d-accent border border-d-border hover:bg-d-surface-2 justify-center shrink-0"
              title="Abrir esta búsqueda completa en mobile.de"
            >
              <ExternalLink className="w-3 h-3" /> mobile.de
            </a>
          )}
        </div>
        {urlRow(engine)}
      </div>
    );
  };

  const sourceButton = (engine: Engine, primary: boolean) => {
    const st = sourcing[engine.name];
    if (st?.loading || st?.listings) return null;
    return (
      <div className="mt-2">
        <button
          onClick={() => sourceEngine(engine)}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold w-full justify-center ${primary ? 'd-btn-primary' : 'd-btn-ghost border border-d-border'}`}
        >
          <Search className="w-3.5 h-3.5" /> Ver los 4 mejores anuncios{engine.power_cv ? ` (${engine.power_cv} CV)` : ''}
        </button>
        {urlRow(engine)}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-d-border bg-d-surface/40 p-4">
      <div className="flex items-center justify-between mb-2.5">
        <h4 className="text-d-text text-sm font-semibold flex items-center gap-2">
          <Wrench className="w-4 h-4 text-d-accent" /> Motorización · {make} {model}
        </h4>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowFilters(s => !s)} className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md ${showFilters ? 'bg-d-accent/10 text-d-accent' : 'text-d-dim hover:text-d-text'}`}>
            <SlidersHorizontal className="w-3 h-3" /> Ajustes
          </button>
          <span className="text-d-dim text-[10px] uppercase tracking-wide border border-d-border rounded-full px-2 py-0.5">orientativo</span>
        </div>
      </div>

      {/* Extra filters applied to every engine sourcing below */}
      {showFilters && (
        <div className="rounded-lg border border-d-border bg-d-surface-2/50 p-3 mb-3 space-y-2.5">
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <label className="inline-flex items-center gap-1.5 text-xs text-d-text-2 cursor-pointer">
              <input type="checkbox" checked={fVat} onChange={e => setFVat(e.target.checked)} className="accent-[#AABEF5]" /> Solo IVA deducible
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-d-text-2 cursor-pointer">
              <input type="checkbox" checked={fDealers} onChange={e => setFDealers(e.target.checked)} className="accent-[#AABEF5]" /> Solo profesionales
            </label>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <label className="block">
              <span className="block text-[10px] text-d-dim mb-0.5">Precio máx (€)</span>
              <input type="number" inputMode="numeric" value={fMaxPrice} onChange={e => setFMaxPrice(e.target.value)} className="d-input d-num w-full px-2 py-1.5 text-xs" />
            </label>
            <label className="block">
              <span className="block text-[10px] text-d-dim mb-0.5">Km máx</span>
              <input type="number" inputMode="numeric" value={fMaxKm} onChange={e => setFMaxKm(e.target.value)} className="d-input d-num w-full px-2 py-1.5 text-xs" />
            </label>
            <label className="block">
              <span className="block text-[10px] text-d-dim mb-0.5">Año mín</span>
              <input type="number" inputMode="numeric" value={fMinYear} onChange={e => setFMinYear(e.target.value)} className="d-input d-num w-full px-2 py-1.5 text-xs" />
            </label>
            <label className="block">
              <span className="block text-[10px] text-d-dim mb-0.5">Cambio</span>
              <select value={fTrans} onChange={e => setFTrans(e.target.value)} className="d-input w-full px-2 py-1.5 text-xs">
                <option value="">Cualquiera</option>
                <option value="AUTOMATIC_GEAR">Automático</option>
                <option value="MANUAL_GEAR">Manual</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="block text-[10px] text-d-dim mb-0.5">Versión / acabado</span>
            <input value={fVariant} onChange={e => setFVariant(e.target.value)} placeholder="p. ej. GTI, R-Line, AMG…" className="d-input w-full px-2 py-1.5 text-xs" />
            <span className="block text-d-dim text-[10px] mt-0.5">Filtra por la versión concreta (busca la palabra en el anuncio). Déjalo vacío para todas.</span>
          </label>
          <p className="text-d-dim text-[10px]">Se aplican al pulsar «Ver los 4 mejores anuncios» de cualquier motor.</p>
        </div>
      )}

      {data.summary && <p className="text-d-text-2 text-sm mb-3">{data.summary}</p>}

      {/* General search for this model — the client's own filters, ALL engines.
          Lives here (not at the top of the phase) so each model carries its own.
          Same prominent button the phase header used to have. */}
      {mobileUrl && (
        <div className="mb-3">
          <a href={mobileUrl} target="_blank" rel="noopener" className="d-btn-primary flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold">
            <Search className="w-4 h-4" /> Búsqueda general · {make} {model}
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          {copyableUrlRow('__general', mobileUrl)}
        </div>
      )}

      {recEngine && (
        <div className="rounded-lg border border-d-green/25 bg-d-green/5 px-3 py-2.5 mb-2">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-d-green shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              {chosenEngine && (
                <span className="inline-block text-[10px] font-semibold uppercase tracking-wide text-d-green bg-d-green/15 rounded px-1.5 py-0.5 mb-1">Lo que pidió el cliente</span>
              )}
              <p className="text-d-text text-sm font-semibold">
                {recEngine.name}
                {recEngine.power_cv ? <span className="text-d-dim font-normal"> · {recEngine.power_cv} CV</span> : null}
                {recEngine.fuel ? <span className="text-d-dim font-normal"> · {FUEL_LABEL[recEngine.fuel] || recEngine.fuel}</span> : null}
              </p>
              {recEngine.note && <p className="text-d-muted text-xs mt-0.5">{recEngine.note}</p>}
            </div>
          </div>
          {sourceButton(recEngine, true)}
          {renderListings(recEngine)}
        </div>
      )}

      {others.map((e, i) => (
        <div key={i} className="px-3 py-1.5">
          <div className="flex items-start gap-2">
            {e.avoid
              ? <AlertTriangle className="w-3.5 h-3.5 text-d-amber shrink-0 mt-0.5" />
              : <span className="w-3.5 h-3.5 shrink-0 mt-0.5 flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-d-dim" /></span>}
            <div className="min-w-0 flex-1">
              <p className="text-d-text-2 text-xs font-medium">
                {e.name}
                {e.power_cv ? <span className="text-d-dim font-normal"> · {e.power_cv} CV</span> : null}
                {e.avoid ? <span className="text-d-amber font-normal"> · evitar</span> : null}
              </p>
              {e.note && <p className="text-d-dim text-[11px] mt-0.5">{e.note}</p>}
            </div>
          </div>
          {!e.avoid && sourceButton(e, false)}
          {!e.avoid && renderListings(e)}
        </div>
      ))}

      <p className="text-d-dim text-[11px] mt-2.5 leading-snug">Orientativo — confírmalo con el análisis del coche concreto.</p>
    </div>
  );
}
