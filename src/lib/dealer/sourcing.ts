// Shared sourcing model for the dealer búsqueda workspace: the engine/listing
// types and the deterministic engine ranking. Kept out of the components so the
// operation page and any future view rank motorizations identically.
//
// The ranking was proven in the /dealerv23 prototype; this is its canonical home.

export interface Engine {
  name: string;
  fuel: string | null;
  power_cv: number | null;
  reliability: 'alta' | 'media' | 'baja';
  note: string;
  avoid: boolean;
}

export interface Motorizations {
  recommended: string | null;
  summary: string;
  engines: Engine[];
  confidence: string;
}

export interface Listing {
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
  /** Why the AI judge put this ad in the top 4 (≤12 words). Only the judged head carries it. */
  reason?: string | null;
}

/** What the client asked for — drives which engine headlines and how we score. */
export interface EngineWant {
  fuel: string | null;
  minCv?: number | null;
}

/**
 * The engine the client actually asked for (closest advisory engine within
 * ±20 CV, or a synthetic one at that power). This headlines the model — not the
 * AI's reliability pick, which ignores what the client requested. Null when no
 * power was requested.
 */
export function clientChosenEngine(engines: Engine[], minCv: number | null | undefined, fuel: string | null): Engine | null {
  if (minCv == null) return null;
  const near = engines
    .filter(e => e.power_cv != null && Math.abs((e.power_cv as number) - minCv) <= 20)
    .sort((a, b) => Math.abs((a.power_cv as number) - minCv) - Math.abs((b.power_cv as number) - minCv))[0];
  if (near) return near;
  return { name: `${minCv} CV`, fuel, power_cv: minCv, reliability: 'media', note: 'La motorización que pidió el cliente', avoid: false };
}

const normDesig = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The engines the client explicitly asked for, BY DESIGNATION (320d, 1.6 TDI,
 * 428i) — not by CV. Each requested designation is matched against the advisory
 * engine that carries its verdict (so a 428i shows as good/bad, with a source),
 * and falls back to a synthetic entry when the advisory somehow lacks it. These
 * HEADLINE the model, in the order the client picked them, ahead of our own
 * recommendation. Returns [] when the client didn't name a specific engine —
 * callers then fall back to clientChosenEngine (the CV-based advisor path).
 *
 * Matching is loose on purpose: advisory names carry a code in parentheses
 * ("2.0 TDI (EA288)") while the client picked "2.0 TDI", so either containing the
 * other counts. First match wins; each advisory engine is used at most once.
 */
export function requestedEngines(advisory: Engine[], requested: string[] | null | undefined, fuel: string | null): Engine[] {
  if (!requested || requested.length === 0) return [];
  const used = new Set<Engine>();
  const seen = new Set<string>();
  const out: Engine[] = [];
  for (const raw of requested) {
    const key = normDesig(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const match = advisory.find(e => {
      if (used.has(e)) return false;
      const n = normDesig(e.name);
      return n === key || n.includes(key) || key.includes(n);
    });
    if (match) {
      used.add(match);
      out.push(match);
    } else {
      out.push({
        name: raw.trim(),
        fuel,
        power_cv: null,
        reliability: 'media',
        note: 'La motorización que pidió el cliente — sin datos de fiabilidad todavía.',
        avoid: false,
      });
    }
  }
  return out;
}

/**
 * Rank engines deterministically instead of trusting the LLM's claimed order.
 * The advisor says it returns motors "most-to-least recommendable", but nobody
 * checks — cutting to the top N blind can drop a high-reliability engine and
 * keep two to-avoid ones. We score explicitly:
 *
 *   reliability          alta +3 · media +1.5 · baja 0 · avoid −3
 *   picked by the advisor           +1.5
 *   matches the client's fuel        +1
 *   power: meets the client's min +0.75 · falls short −1.5
 *
 * Ties keep the advisor's original order.
 */
export function rankEngines(engines: Engine[], recommended: string | null, want: EngineWant, max = 4): Engine[] {
  const score = (e: Engine): number => {
    let s = e.reliability === 'alta' ? 3 : e.reliability === 'media' ? 1.5 : 0;
    if (e.avoid) s -= 3;
    if (recommended && e.name === recommended) s += 1.5;
    if (want.fuel && e.fuel === want.fuel) s += 1;
    if (want.minCv && e.power_cv != null) s += e.power_cv >= want.minCv ? 0.75 : -1.5;
    return s;
  };
  return engines
    .map((e, i) => ({ e, i, s: score(e) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(x => x.e)
    .slice(0, max);
}

export const FUEL_LABEL: Record<string, string> = {
  PETROL: 'Gasolina', DIESEL: 'Diésel', HYBRID: 'Híbrido', HYBRID_PLUGIN: 'Híbrido enchufable', PLUGINHYBRID: 'Híbrido enchufable', ELECTRICITY: 'Eléctrico',
};

/** mobile.de price-rating → on-theme badge. */
export const RATING_BADGE: Record<string, { label: string; cls: string }> = {
  VERY_GOOD_PRICE: { label: 'Muy buen precio', cls: 'bg-d-green/15 text-d-green' },
  GOOD_PRICE: { label: 'Buen precio', cls: 'bg-d-green/10 text-d-green/90' },
  REASONABLE_PRICE: { label: 'Precio razonable', cls: 'bg-d-surface-3 text-d-muted' },
  FAIR_PRICE: { label: 'Precio justo', cls: 'bg-d-surface-3 text-d-muted' },
};
