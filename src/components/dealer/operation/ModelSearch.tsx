'use client';

import { useEffect, useState } from 'react';
import {
  Gauge, Loader2, Search, SlidersHorizontal, CheckCircle2, AlertTriangle,
  Car, ExternalLink, RotateCcw, Plus, Ban, Sparkles,
} from 'lucide-react';
import {
  clientChosenEngine, requestedEngines, rankEngines, FUEL_LABEL, RATING_BADGE,
  type Engine, type Listing, type Motorizations,
} from '@/lib/dealer/sourcing';

// One model inside the búsqueda workspace: the reliability advisory + its ranked
// engines, and per engine the live mobile.de lot browsed IN-APP (no jumping out
// to a listing URL). Listings are the only cards here — everything structural is
// dividers + spacing, so the screen doesn't read as a wall of boxes.

export interface SearchVehicle {
  make: string;
  model: string;
  min_year: number | null;
  /** Upper bound of the requested generation (F30 → 2018). Keeps a G20/G80 out. */
  max_year?: number | null;
  min_cv?: number | null;
  /** Engine designations the client asked for (428i, 320d). Headline the card. */
  engines?: string[] | null;
  /** Legacy: older requests stashed the engine here — used as a fallback. */
  variant?: string | null;
  fuel: string | null;
  max_price: number | null;
  max_km: number | null;
  transmission: string | null;
  mobile_url: string | null;
}

interface SourcingState {
  loading: boolean;
  error: string | null;
  listings: Listing[] | null;
  search_url: string | null;
}

const PREVIEW_COUNT = 4;

const RELIABILITY_TAG: Record<'rec' | 'warn' | 'bad', { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  rec: { label: 'Recomendado', cls: 'd-tag-good', Icon: CheckCircle2 },
  warn: { label: 'Con reservas', cls: 'd-tag-warn', Icon: AlertTriangle },
  bad: { label: 'Evitar', cls: 'd-tag-muted', Icon: Ban },
};
function reliabilityOf(e: Engine): 'rec' | 'warn' | 'bad' {
  if (e.avoid || e.reliability === 'baja') return 'bad';
  if (e.reliability === 'media') return 'warn';
  return 'rec';
}

// Two tunes of one block (e.g. EA288 at 150 CV and 184 CV) come back with the
// SAME name and differ only in power. Key on name + CV so each searches and
// caches its own lot — otherwise they'd share a slot and show identical cars.
const engineKey = (e: Engine) => `${e.name}·${e.power_cv ?? '?'}`;

export default function ModelSearch({
  vehicle, token, isSelected, toggle, full, analyzedUrls,
}: {
  vehicle: SearchVehicle;
  token: string;
  isSelected: (url: string) => boolean;
  toggle: (l: Listing) => void;
  full: boolean;
  analyzedUrls: Set<string>;
}) {
  const { make, model, min_year: minYear, max_year: maxYear, min_cv: minCv, fuel } = vehicle;

  // What the client asked for, by designation (428i, 320d). New requests carry
  // `engines`; older ones stashed the single engine in `variant`, so fall back to
  // it — that's what makes an operación created before this change light up too.
  // The variant fallback is guarded: a trim like "GTI"/"AMG" is NOT an engine, so
  // only treat variant as one when it looks like a designation (has a digit or a
  // known engine tag), never a bare trim.
  const looksLikeEngine = (s: string) => /\d/.test(s) || /\b(tdi|tsi|tfsi|cdi|dci|hdi|crdi|bluetec)\b/i.test(s);
  const reqDesignations = vehicle.engines && vehicle.engines.length
    ? vehicle.engines
    : (vehicle.variant && looksLikeEngine(vehicle.variant) ? [vehicle.variant] : []);
  const reqKey = reqDesignations.join('|');

  const [data, setData] = useState<Motorizations | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Filters the dealer can tweak before sourcing (prefilled from the request).
  const [showFilters, setShowFilters] = useState(false);
  const [fMaxPrice, setFMaxPrice] = useState(vehicle.max_price != null ? String(vehicle.max_price) : '');
  const [fMaxKm, setFMaxKm] = useState(vehicle.max_km != null ? String(vehicle.max_km) : '');
  const [fMinYear, setFMinYear] = useState(minYear != null ? String(minYear) : '');
  const [fMaxYear, setFMaxYear] = useState(maxYear != null ? String(maxYear) : '');
  const [fTrans, setFTrans] = useState(vehicle.transmission || '');
  const [fVariant, setFVariant] = useState('');
  const [fVat, setFVat] = useState(false);
  const [fDealers, setFDealers] = useState(false);

  const [sourcing, setSourcing] = useState<Record<string, SourcingState>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!token) { setLoading(false); setFailed(true); return; }
    let cancelled = false;
    setLoading(true); setFailed(false);
    fetch('/api/dealer/motorizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ make, model, year_from: minYear, year_to: maxYear ?? null, fuel, engines: reqDesignations }),
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
  }, [make, model, minYear, maxYear, fuel, token, reqKey]);

  // Silently disappear when there's no useful advice (Groq down / no data).
  if (failed) return null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-d-dim text-xs py-3">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando la motorización más fiable de {make} {model}…
      </div>
    );
  }
  if (!data) return null;

  // Headlines: every engine the client asked for (by designation), each with its
  // own verdict, IN THE ORDER PICKED. When they didn't name one, fall back to the
  // CV-based pick, then to the advisor's own recommendation.
  const requested = requestedEngines(data.engines, reqDesignations, fuel);
  let heads: { engine: Engine; asked: boolean }[];
  if (requested.length) {
    heads = requested.map(engine => ({ engine, asked: true }));
  } else {
    const cv = clientChosenEngine(data.engines, minCv, fuel);
    const head = cv || data.engines.find(e => e.name === data.recommended) || data.engines.find(e => !e.avoid) || null;
    heads = head ? [{ engine: head, asked: cv != null }] : [];
  }
  const headSet = new Set(heads.map(h => h.engine));
  const others = rankEngines(data.engines.filter(e => !headSet.has(e)), data.recommended, { fuel, minCv }, 4);

  const sourceEngine = async (engine: Engine) => {
    const key = engineKey(engine);
    setSourcing(prev => ({ ...prev, [key]: { loading: true, error: null, listings: null, search_url: prev[key]?.search_url || null } }));
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
            max_year: fMaxYear ? Number(fMaxYear) : null,
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
      setSourcing(prev => ({ ...prev, [key]: { loading: false, error: null, listings: d.listings || [], search_url: d.search_url || null } }));
    } catch (e) {
      setSourcing(prev => ({ ...prev, [key]: { loading: false, error: (e as Error).message, listings: null, search_url: prev[key]?.search_url || null } }));
    }
  };

  const engineMeta = (e: Engine) =>
    [e.power_cv ? `${e.power_cv} CV` : null, e.fuel ? FUEL_LABEL[e.fuel] || e.fuel : null].filter(Boolean).join(' · ');

  const renderListings = (engine: Engine) => {
    const st = sourcing[engineKey(engine)];
    if (!st) return null;
    if (st.loading) {
      return (
        <div className="mt-2.5 flex items-center gap-2 text-d-dim text-xs py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Rastreando mobile.de y eligiendo los mejores…
        </div>
      );
    }
    if (st.error) {
      return (
        <div className="mt-2.5">
          <p className="text-d-red text-xs">{st.error}</p>
          <ResearchLink onRetry={() => sourceEngine(engine)} searchUrl={st.search_url} />
        </div>
      );
    }
    if (!st.listings) return null;
    if (st.listings.length === 0) {
      return (
        <div className="mt-2.5">
          <p className="text-d-dim text-xs">Sin resultados con estos filtros — prueba a relajar precio o km.</p>
          <ResearchLink onRetry={() => sourceEngine(engine)} searchUrl={st.search_url} />
        </div>
      );
    }
    const isOpen = !!expanded[engineKey(engine)];
    const visible = isOpen ? st.listings : st.listings.slice(0, PREVIEW_COUNT);
    const hidden = st.listings.length - visible.length;
    return (
      <div className="mt-2.5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {visible.map(l => (
            <ListingTile
              key={l.url}
              listing={l}
              selected={isSelected(l.url)}
              analyzed={analyzedUrls.has(l.url)}
              blocked={full && !isSelected(l.url)}
              onToggle={() => toggle(l)}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {(hidden > 0 || isOpen) && (
            <button
              onClick={() => setExpanded(p => ({ ...p, [engineKey(engine)]: !isOpen }))}
              className="text-[11px] font-medium text-d-dim hover:text-d-text transition-colors"
            >
              {isOpen ? `Ver solo los ${PREVIEW_COUNT} mejores` : `Ver los ${hidden} anuncios restantes`}
            </button>
          )}
          <ResearchLink onRetry={() => sourceEngine(engine)} searchUrl={st.search_url} inline />
        </div>
      </div>
    );
  };

  const sourceButton = (engine: Engine, primary: boolean) => {
    const st = sourcing[engineKey(engine)];
    if (st?.loading || st?.listings) return null;
    return (
      <button
        onClick={() => sourceEngine(engine)}
        className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
          primary ? 'd-btn-primary' : 'text-d-text-2 border border-d-border hover:bg-d-surface-2 hover:text-d-text'
        }`}
      >
        <Search className="w-3.5 h-3.5" /> Ver los mejores anuncios{engine.power_cv ? ` · ${engine.power_cv} CV` : ''}
      </button>
    );
  };

  return (
    <section className="py-4 border-t border-d-border first:border-t-0 first:pt-0">
      {/* Model header — no box, just a row + a hairline under it */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="d-ic w-8 h-8 shrink-0"><Gauge className="w-4 h-4" /></span>
          <div className="min-w-0">
            <h4 className="text-d-text text-[15px] font-semibold truncate leading-tight">{make} {model}</h4>
            <p className="text-d-dim text-[11px]">Motorización recomendada</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowFilters(s => !s)}
            className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md transition-colors ${showFilters ? 'bg-d-accent/10 text-d-accent' : 'text-d-dim hover:text-d-text'}`}
          >
            <SlidersHorizontal className="w-3 h-3" /> Ajustes
          </button>
          {vehicle.mobile_url && (
            <a
              href={vehicle.mobile_url} target="_blank" rel="noopener"
              title={`Abrir la búsqueda general en mobile.de · ${make} ${model}`}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-d-dim hover:text-d-accent transition-colors"
            >
              mobile.de <ExternalLink className="w-3 h-3" />
            </a>
          )}
          <span className="d-tag d-tag-muted">Orientativo</span>
        </div>
      </div>

      {showFilters && (
        <div className="mt-3 rounded-lg border border-d-border bg-d-surface-2/50 p-3 space-y-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
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
              <span className="block text-[10px] text-d-dim mb-0.5">Año máx</span>
              <input type="number" inputMode="numeric" value={fMaxYear} onChange={e => setFMaxYear(e.target.value)} placeholder="fin de la generación" className="d-input d-num w-full px-2 py-1.5 text-xs" />
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
          </label>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <label className="inline-flex items-center gap-1.5 text-xs text-d-text-2 cursor-pointer">
              <input type="checkbox" checked={fVat} onChange={e => setFVat(e.target.checked)} className="accent-[#AABEF5]" /> Solo IVA deducible
            </label>
            <label className="inline-flex items-center gap-1.5 text-xs text-d-text-2 cursor-pointer">
              <input type="checkbox" checked={fDealers} onChange={e => setFDealers(e.target.checked)} className="accent-[#AABEF5]" /> Solo profesionales
            </label>
          </div>
          <p className="text-d-dim text-[10px]">Se aplican al buscar los anuncios de cualquier motor.</p>
        </div>
      )}

      {data.summary && <p className="text-d-text-2 text-[13px] mt-2.5 leading-relaxed">{data.summary}</p>}

      {/* Headline engines — what the client asked for goes FIRST, in the order
          picked, each with its own verdict (good/bad), then their sourcing. The
          tint follows the verdict, so a requested-but-unreliable engine reads
          honestly (amber/red) instead of a misleading green. */}
      {heads.map(({ engine, asked }) => {
        const rel = reliabilityOf(engine);
        const tag = RELIABILITY_TAG[rel];
        const TagIcon = tag.Icon;
        const tint = rel === 'rec' ? 'bg-d-green/[0.05]' : rel === 'warn' ? 'bg-d-amber/[0.05]' : 'bg-d-red/[0.05]';
        const iconColor = rel === 'rec' ? 'text-d-green' : rel === 'warn' ? 'text-d-amber' : 'text-d-red';
        return (
          <div key={`head-${engineKey(engine)}`} className={`mt-3 rounded-lg ${tint} px-3 py-2.5`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <TagIcon className={`w-4 h-4 ${iconColor} shrink-0`} />
              <div className="min-w-0 flex-1">
                {asked && (
                  <span className="inline-block text-[10px] font-semibold uppercase tracking-wide text-d-accent bg-d-accent/10 rounded px-1.5 py-0.5 mb-1">Lo que pidió el cliente</span>
                )}
                <p className="text-d-text text-sm font-semibold">
                  {engine.name}
                  {engineMeta(engine) && <span className="text-d-dim font-normal"> · {engineMeta(engine)}</span>}
                </p>
                {engine.note && <p className="text-d-muted text-xs mt-0.5">{engine.note}</p>}
              </div>
              {sourceButton(engine, true)}
              <span className={`d-tag ${tag.cls} shrink-0`}>{asked ? tag.label : 'Recomendado'}</span>
            </div>
            {renderListings(engine)}
          </div>
        );
      })}

      {/* Other engines — a divided list, no boxes */}
      {others.length > 0 && (
        <div className="mt-1 divide-y divide-d-border">
          {others.map(e => {
            const tag = RELIABILITY_TAG[reliabilityOf(e)];
            return (
              <div key={engineKey(e)} className="py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-d-text-2 text-[13px] font-medium">
                      {e.name}
                      {engineMeta(e) && <span className="text-d-dim font-normal"> · {engineMeta(e)}</span>}
                    </p>
                    {e.note && <p className="text-d-dim text-[11px] mt-0.5">{e.note}</p>}
                  </div>
                  {!e.avoid && sourceButton(e, false)}
                  <span className={`d-tag ${tag.cls} shrink-0`}>{tag.label}</span>
                </div>
                {!e.avoid && renderListings(e)}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** "Volver a buscar" + the mobile.de fallback link, shown under a lot. */
function ResearchLink({ onRetry, searchUrl, inline }: { onRetry: () => void; searchUrl: string | null; inline?: boolean }) {
  return (
    <div className={inline ? 'inline-flex items-center gap-3' : 'mt-2 flex items-center gap-3'}>
      <button onClick={onRetry} className="inline-flex items-center gap-1 text-[11px] font-medium text-d-dim hover:text-d-text transition-colors">
        <RotateCcw className="w-3 h-3" /> Volver a buscar
      </button>
      {searchUrl && (
        <a href={searchUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[11px] font-medium text-d-dim hover:text-d-accent transition-colors" title="Abrir esta búsqueda en mobile.de">
          mobile.de <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

/** A single ad — the ONE place a card is justified, because you pick it. */
function ListingTile({
  listing: l, selected, analyzed, blocked, onToggle,
}: {
  listing: Listing;
  selected: boolean;
  analyzed: boolean;
  blocked: boolean;
  onToggle: () => void;
}) {
  const badge = l.rating ? RATING_BADGE[l.rating] : null;
  const disabled = analyzed || blocked;
  return (
    <div
      onClick={() => !disabled && onToggle()}
      className={`rounded-lg border overflow-hidden flex flex-col transition-colors ${
        selected ? 'border-d-accent ring-1 ring-d-accent bg-d-accent/5' : 'border-d-border bg-d-surface-2/40'
      } ${disabled ? 'opacity-60 cursor-default' : 'cursor-pointer hover:border-d-border-strong'}`}
    >
      {l.image ? (
        <img src={l.image} alt="" loading="lazy" className="w-full h-24 object-cover" />
      ) : (
        <div className="w-full h-24 bg-d-surface-2 grid place-items-center"><Car className="w-5 h-5 text-d-dim" /></div>
      )}
      <div className="p-2.5 flex flex-col flex-1">
        <p className="text-d-text text-xs font-medium leading-snug line-clamp-2">{l.title}</p>
        <div className="flex items-baseline gap-2 mt-1.5 flex-wrap">
          <span className="text-d-text text-sm font-bold d-num">€{l.price.toLocaleString('es-ES')}</span>
          {badge && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>}
        </div>
        <p className="text-d-dim text-[11px] mt-0.5 d-num">
          {[l.km != null ? `${l.km.toLocaleString('es-ES')} km` : null, l.year, l.power_cv ? `${l.power_cv} CV` : null].filter(Boolean).join(' · ')}
        </p>
        {l.reason && <p className="text-d-accent/90 text-[11px] mt-1 leading-snug flex gap-1"><Sparkles className="w-3 h-3 shrink-0 mt-0.5" /> {l.reason}</p>}
        {(l.vat_deductible || l.seller_type === 'DEALER') && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {l.vat_deductible && <span className="text-[10px] px-1.5 py-0.5 rounded bg-d-accent/10 text-d-accent">IVA deducible</span>}
            {l.seller_type === 'DEALER' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-d-surface-3 text-d-muted">Profesional</span>}
          </div>
        )}
        <div className="flex items-center gap-1.5 mt-auto pt-2.5">
          <button
            type="button"
            onClick={e => { e.stopPropagation(); if (!disabled) onToggle(); }}
            disabled={disabled}
            title={blocked ? 'Has llegado al máximo de la tanda' : undefined}
            className={`flex-1 py-1.5 rounded-md text-[11px] font-semibold inline-flex items-center justify-center gap-1 transition-colors ${
              analyzed ? 'bg-d-green/15 text-d-green' : selected ? 'bg-d-accent text-[#141619]' : 'text-d-text-2 border border-d-border hover:bg-d-surface-3'
            }`}
          >
            {analyzed
              ? <><CheckCircle2 className="w-3 h-3" /> Ya analizado</>
              : selected
                ? <><CheckCircle2 className="w-3 h-3" /> Seleccionado</>
                : <><Plus className="w-3 h-3" /> Seleccionar</>}
          </button>
          <a
            href={l.url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
            className="p-1.5 rounded-md text-d-dim hover:text-d-accent hover:bg-d-surface-3 transition-colors" title="Ver anuncio en mobile.de"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
