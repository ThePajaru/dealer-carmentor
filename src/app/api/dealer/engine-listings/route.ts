import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDealerAuth, AuthError } from '@/lib/dealer-auth';
import { resolveMobileSearch } from '@/lib/mobile-de-search';
import { fetchMobileSearchHtml } from '@/lib/mobile-de-fetch';
import { parseMobileListings, parseTotalCount } from '@/lib/mobile-de-listings';
import { generationsFor, genSearchRange } from '@/lib/generations';

// Auto-sourcing per motorization: given make/model + a recommended engine
// (fuel + CV) + the dealer's extra filters, fetch the mobile.de search-results
// page and return the matching listings as cards (photo, price, km, year,
// mobile.de's own price rating, VAT-deductible flag, seller type), AI judge's
// best picks first.
//
// FETCH: one request to the mobile.de search page via the scrape.do unlocker
// (src/lib/mobile-de-fetch), parsed to structured rows (src/lib/mobile-de-listings).
// This replaced the memo23~mobile-de-scraper Apify actor (2026-07-21): that
// actor billed ~$0.001/result → ~$0.07 per search and took ~80s; scrape.do is
// one per-request charge and ~10-15s. We take ONE page (~24 ads) by design — no
// pagination. Only ms-quad URLs filter correctly (free-text modelDescription
// does NOT), so a requested trim/version is post-filtered on the ad title, and
// VAT-deductible / dealer-only are post-filtered on the parsed fields.

export const maxDuration = 300;

interface EngineListing {
  id: string | null;
  title: string;
  url: string;
  price: number;
  km: number | null;
  year: number | null;
  power_cv: number | null;
  image: string | null;
  rating: string | null; // mobile.de priceRating (VERY_GOOD_PRICE | GOOD_PRICE | …)
  vat_deductible: boolean;
  seller_type: 'DEALER' | 'PRIVATE' | null;
  /** One-line justification from the AI judge (why this one made the top 5). */
  reason?: string | null;
}

// Persistent cache lives in Supabase (mobile_listing_cache), keyed by search URL
// and shared across dealers. `pending` still dedupes IN-FLIGHT scrapes within a
// warm lambda: two clicks on the same search must join one fetch, not pay twice.
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 h
const pending: Map<string, Promise<{ listings: EngineListing[]; total: number | null }>> =
  (globalThis as any).__engineListingsPending || ((globalThis as any).__engineListingsPending = new Map());

// Service-role client for the shared listings cache (bypasses RLS; server-only).
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// Wreck/export bait dressed as bargains — hard-excluded by title regardless of
// price. Careful: "unfallfrei" / "kein Unfall" mean accident-FREE, so only the
// explicitly bad forms match.
const BADWORDS = /(motorschaden|getriebeschaden|unfallwagen|unfallfahrzeug|unfallauto|defekt|bastler|schlachtfest|ersatzteil|exportpreis|nur export|ohne t[üu]v|kein t[üu]v|tauschmotor)/i;

// mobile.de's free-text modelDescription doesn't filter in the actor (see header),
// so a requested trim/version (e.g. "GTI", "R-Line") is matched on the ad title
// instead, as a whole token so "GTI" doesn't leak into "GTD"/"GTE".
function variantMatcher(variant: string): (title: string) => boolean {
  const v = variant.trim();
  const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}([^\\p{L}\\p{N}]|$)`, 'iu');
    return (title: string) => re.test(title);
  } catch {
    const lc = v.toLowerCase();
    return (title: string) => title.toLowerCase().includes(lc);
  }
}

// The same car can be re-listed under different ad ids — dedupe by ad id,
// normalized URL, and a title+price+km fingerprint. NOTE: mobile.de detail URLs
// are `details.html?id=<n>`, so the id lives in the QUERY — only strip the hash,
// never the query, or every listing collapses to one key.
function dedupe(listings: EngineListing[]): EngineListing[] {
  const seen = new Set<string>();
  return listings.filter(l => {
    const urlKey = l.url.replace(/#.*$/, '');
    const fingerprint = `${l.title.toLowerCase().replace(/\s+/g, ' ').trim()}|${l.price}|${l.km ?? ''}`;
    const keys = [l.id ? `id:${l.id}` : null, `url:${urlKey}`, `fp:${fingerprint}`].filter((k): k is string => !!k);
    if (keys.some(k => seen.has(k))) return false;
    keys.forEach(k => seen.add(k));
    return true;
  });
}

const RATING_BONUS: Record<string, number> = {
  VERY_GOOD_PRICE: 1, GOOD_PRICE: 0.7, REASONABLE_PRICE: 0.35, FAIR_PRICE: 0.35,
};

// Heuristic ranking = mobile.de's own rating + cheap + low km + recent, within
// this result set. Suspiciously cheap listings (<40% of the set's median) are
// dropped — they're accident/export bait.
function pickBest(listings: EngineListing[], n = 5): EngineListing[] {
  if (listings.length === 0) return [];
  const prices = listings.map(l => l.price).sort((a, b) => a - b);
  const median = prices[Math.floor(prices.length / 2)];
  const sane = listings.filter(l => l.price >= median * 0.4);
  const pool = sane.length >= 3 ? sane : listings;

  const nums = (vals: (number | null)[]) => {
    const xs = vals.filter((v): v is number => v != null);
    return { min: Math.min(...xs), max: Math.max(...xs) };
  };
  const p = nums(pool.map(l => l.price));
  const k = nums(pool.map(l => l.km));
  const y = nums(pool.map(l => l.year));
  const norm = (v: number | null, lo: number, hi: number, invert: boolean) => {
    if (v == null || hi === lo) return 0.5;
    const t = (v - lo) / (hi - lo);
    return invert ? 1 - t : t;
  };

  return [...pool]
    .map(l => ({
      l,
      score:
        0.4 * (RATING_BONUS[l.rating || ''] || 0) +
        0.25 * norm(l.price, p.min, p.max, true) +
        0.2 * norm(l.km, k.min, k.max, true) +
        0.15 * norm(l.year, y.min, y.max, false),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(x => x.l);
}

// AI judge: a pro import buyer picks the 4 best from the heuristic top-15 and
// says WHY (shown on each card). Groq fail → heuristic order stands.
async function aiJudge(candidates: EngineListing[], carLabel: string): Promise<EngineListing[] | null> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey || candidates.length <= 4) return null;

  const prices = candidates.map(l => l.price).sort((a, b) => a - b);
  const kms = candidates.map(l => l.km).filter((k): k is number => k != null).sort((a, b) => a - b);
  const medPrice = prices[Math.floor(prices.length / 2)];
  const medKm = kms.length ? kms[Math.floor(kms.length / 2)] : null;

  const rows = candidates.map((l, i) => ({
    i, titulo: l.title, precio: l.price, km: l.km, año: l.year, cv: l.power_cv,
    rating_mobile: l.rating, iva_deducible: l.vat_deductible, vendedor: l.seller_type,
  }));

  const prompt = `Eres un comprador profesional de coches de importación en Alemania para revender en España. De estos ${candidates.length} anuncios de ${carLabel} (mediana del lote: ${medPrice} €${medKm != null ? `, ${medKm} km` : ''}), elige los 4 MEJORES para comprar con margen.

Criterios, por orden:
1. Relación precio/km/año dentro del lote (busca el infravalorado, no solo el barato).
2. rating_mobile: VERY_GOOD_PRICE > GOOD_PRICE > resto. NO_RATING con precio muy bajo = sospechoso.
3. iva_deducible cuenta a favor (compra neta para revendedor).
4. Penaliza señales de taxi, alquiler (Mietwagen), tuning agresivo, "Motorschaden/Unfall/defekt/Export" o kilometraje incoherente con el año.
5. Vendedor profesional ligeramente mejor que particular (garantía).

ANUNCIOS:
${JSON.stringify(rows)}

Devuelve SOLO JSON: {"picks":[{"i":<índice>,"reason":"<máx 12 palabras, en español, concreta: p.ej. '30.000 km menos que la mediana por solo 400 € más'>"}]} — exactamente 4 picks, ordenados de mejor a peor.`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 600,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    const picks: { i: number; reason?: string }[] = Array.isArray(parsed.picks) ? parsed.picks : [];
    const chosen = picks
      .filter(p => Number.isInteger(p.i) && p.i >= 0 && p.i < candidates.length)
      .slice(0, 4)
      .map(p => ({ ...candidates[p.i], reason: typeof p.reason === 'string' ? p.reason.slice(0, 160) : null }));
    if (chosen.length < 3) return null; // judge misfired — fall back to heuristic
    const chosenSet = new Set(chosen.map(c => c.url));
    const rest = candidates.filter(c => !chosenSet.has(c.url));
    return [...chosen, ...rest];
  } catch {
    return null;
  }
}

/**
 * Techo de la ventana de años.
 *
 * Con solo `min_year` la búsqueda era «Serie 3 desde 2016», que en mobile.de
 * devuelve F30, G20 y G80 en el mismo lote. `max_year` llega del cuestionario
 * cuando el cliente eligió generación, pero las operaciones antiguas (y los años
 * escritos a mano en los filtros) no lo traen: ahí se deduce de la generación
 * que contiene `min_year`. Sin generación conocida se deja abierto, como antes.
 */
function resolveMaxYear(
  make: string,
  model: string | undefined,
  minYear: number | null | undefined,
  explicit: number | null | undefined,
): number | null {
  if (explicit) return explicit;
  if (!minYear || !model) return null;
  const gens = generationsFor(make, model);
  const gen = gens.find(g => minYear >= g.from && (g.to == null || minYear <= g.to));
  if (!gen) return null;
  return genSearchRange(gens, gen).to ?? null;
}

export async function POST(request: NextRequest) {
  try {
    await requireDealerAuth(request);

    let body: {
      make: string;
      model: string;
      engine: { name?: string; fuel?: string | null; power_cv?: number | null };
      filters?: {
        max_price?: number | null;
        max_km?: number | null;
        min_year?: number | null;
        max_year?: number | null;
        transmission?: string | null;
        vat_deductible?: boolean;
        only_dealers?: boolean;
        variant?: string | null; // trim/version keyword (e.g. "GTI", "R-Line")
      };
    };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    if (!body.make?.trim() || !body.engine) {
      return NextResponse.json({ error: 'make y engine son obligatorios' }, { status: 400 });
    }

    if (!process.env.SCRAPEDO_API_KEY) return NextResponse.json({ error: 'Scraper no configurado' }, { status: 503 });

    const { makeId, modelMs } = resolveMobileSearch(body.make, body.model);
    if (!makeId) return NextResponse.json({ error: `Marca no reconocida: ${body.make}` }, { status: 400 });

    const f = body.filters || {};
    const params = new URLSearchParams();
    params.set('ms', modelMs || `${makeId};;;`);
    params.set('vc', 'Car');
    params.set('con', 'USED');
    params.set('dam', 'false');
    // Year window, BOTH ends. With only `min_year` a "Serie 3 desde 2016" search
    // returned every generation above that year, so an F30 lot came back with
    // G20/G80 ads mixed in. `max_year` carries the generation's upper bound
    // (searchYearWindow → VehicleProfile.max_year); mobile.de's `fr` takes
    // `from:to` and either side may be empty.
    const genMaxYear = resolveMaxYear(body.make, body.model, f.min_year, f.max_year);
    if (f.min_year || genMaxYear) {
      params.set('fr', `${f.min_year || ''}:${genMaxYear || ''}`);
    }
    if (f.max_km) params.set('ml', `:${f.max_km}`);
    if (f.max_price) params.set('p', `:${f.max_price}`);
    if (f.transmission) params.set('tr', f.transmission);
    if (body.engine.fuel) params.set('ft', body.engine.fuel);
    if (body.engine.power_cv) {
      const kwMin = Math.round((body.engine.power_cv - 10) * 0.7355);
      const kwMax = Math.round((body.engine.power_cv + 10) * 0.7355);
      params.set('pw', `${kwMin}:${kwMax}`);
    }
    params.set('sb', 'p');
    params.set('od', 'up');
    const searchUrl = `https://suchen.mobile.de/fahrzeuge/search.html?${params.toString()}`;

    // 1) Persistent cache (Supabase). Best-effort: if the table isn't there yet
    //    or the read fails, fall through to a live scrape.
    let rawListings: EngineListing[] | null = null;
    let totalCount: number | null = null;
    try {
      const { data } = await supabase
        .from('mobile_listing_cache')
        .select('listings, total_count, scraped_at')
        .eq('search_url', searchUrl)
        .maybeSingle();
      if (data && Date.now() - new Date(data.scraped_at as string).getTime() < CACHE_TTL) {
        rawListings = (data.listings as EngineListing[]) || [];
        totalCount = (data.total_count as number | null) ?? null;
      }
    } catch { /* cache miss / table absent — scrape below */ }

    // 2) Live fetch via scrape.do (one page ≈ 24 ads), parsed to structured rows.
    //    `pending` joins concurrent clicks on the same search to one fetch.
    if (!rawListings) {
      let run = pending.get(searchUrl);
      if (!run) {
        run = (async () => {
          const html = await fetchMobileSearchHtml(searchUrl);
          const parsed = parseMobileListings(html) as EngineListing[];
          const total = parseTotalCount(html);
          // 3) Persist the structured set (best-effort) so repeats are instant.
          if (parsed.length > 0) {
            try {
              await supabase.from('mobile_listing_cache').upsert({
                search_url: searchUrl,
                make: body.make,
                model: body.model || null,
                engine_name: body.engine.name || null,
                power_cv: body.engine.power_cv ?? null,
                total_count: total,
                listings: parsed,
                scraped_at: new Date().toISOString(),
              }, { onConflict: 'search_url' });
            } catch { /* non-fatal — the cache is an optimization */ }
          }
          return { listings: parsed, total };
        })();
        pending.set(searchUrl, run);
        run.finally(() => pending.delete(searchUrl)).catch(() => {});
      }
      try {
        const r = await run;
        rawListings = r.listings;
        totalCount = r.total;
      } catch (err) {
        console.error(`engine-listings: ${(err as Error).message}`);
        return NextResponse.json({ error: 'La búsqueda en mobile.de falló. Reinténtalo.' }, { status: 502 });
      }
    }

    let listings: EngineListing[] = rawListings ?? [];
    // Bogus first-registration years (seen live: "04/2026" on a €3.200 wreck).
    const maxYear = new Date().getFullYear();
    listings = listings.filter(l => l.year == null || l.year <= maxYear);
    listings = listings.filter(l => !BADWORDS.test(l.title));
    if (f.vat_deductible) listings = listings.filter(l => l.vat_deductible);
    if (f.only_dealers) listings = listings.filter(l => l.seller_type === 'DEALER');
    // Trim/version filter (e.g. "GTI") — post-filtered on the title, since the
    // actor ignores the modelDescription URL param.
    if (f.variant?.trim()) {
      const matches = variantMatcher(f.variant);
      listings = listings.filter(l => matches(l.title));
    }
    listings = dedupe(listings);

    // The scrape already billed us for EVERY row it returned, so we hand back all
    // of them — throwing away ~55 of ~60 paid listings to show 4 was pure waste.
    // Order: the AI judge's picks first (they carry a `reason`), then the rest of
    // the heuristic shortlist, then everything else ranked heuristically. The
    // client shows the head by default and lets the dealer expand the full lot.
    const shortlist = pickBest(listings, 15);
    const judged = await aiJudge(shortlist, `${body.make} ${body.model || ''} ${body.engine.name || ''}`.trim());
    const head = judged || shortlist;
    const headUrls = new Set(head.map(l => l.url));
    const tail = pickBest(listings.filter(l => !headUrls.has(l.url)), listings.length);
    const ranked = [...head, ...tail];

    return NextResponse.json({
      listings: ranked,
      ai_ranked: !!judged,
      total_scanned: rawListings.length,
      total_market: totalCount,
      matched: listings.length,
      // Human-facing variant: the legacy suchen.mobile.de host bot-blocks real
      // visitors on click-through, so the dealer gets the consumer front-end URL
      // (same query params, per src/lib/mobile-de-search.ts). The trim/version
      // goes into the ms quad's 4th slot (modelDescription) — the consumer site
      // DOES honour it, so the click-through is pre-filtered to e.g. only GTI.
      search_url: (() => {
        const human = new URLSearchParams(params);
        if (f.variant?.trim()) human.set('ms', `${modelMs || `${makeId};;;`}${f.variant.trim()}`);
        return `https://www.mobile.de/es/veh%C3%ADculos/buscar.html?${human.toString()}`;
      })(),
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('engine-listings error:', e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
