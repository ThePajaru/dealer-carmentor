// Parse a mobile.de search-results page (fetched via the scrape.do unlocker)
// into structured listings. mobile.de's consumer front-end (Next.js app router)
// streams the result set as RSC chunks — `self.__next_f.push([n,"…escaped…"])` —
// whose concatenation contains a `"listings":[…]` array, one entry per ad with
// everything we show: id, title, price, and an `attr` object (ml=km, fr=first
// registration, pw="110 kW (150 PS)", ft=fuel), plus images, priceRating and
// the seller type. This replaces the per-result Apify actor: one page fetch,
// ~24 ads, seconds instead of ~80s. See src/app/api/dealer/engine-listings.

export interface MobileListing {
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
}

/** Concatenate every streamed RSC string chunk and JSON-unescape it. */
function recoverRSCPayload(html: string): string {
  let out = '';
  const re = /self\.__next_f\.push\(\[\d+,"((?:[^"\\]|\\.)*)"\]\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try { out += JSON.parse('"' + m[1] + '"'); } catch { /* skip an un-parseable chunk */ }
  }
  return out;
}

/** Bracket-match a JSON array that follows `key` (e.g. `"listings":[`), string-aware. */
function extractJsonArray(s: string, key: string): string | null {
  const at = s.indexOf(key);
  if (at < 0) return null;
  const start = s.indexOf('[', at);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < s.length; j++) {
    const ch = s[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']') { if (--depth === 0) return s.slice(start, j + 1); }
  }
  return null;
}

/** European-formatted number ("174.842 km", "14.685 €") → integer. */
function num(s?: string | null): number | null {
  if (!s) return null;
  const digits = String(s).replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

function mapListing(it: any): MobileListing | null {
  const id = it?.id != null ? String(it.id) : null;
  const price = num(it?.p) ?? (Number.isFinite(it?.price?.grs?.amount) ? Math.round(it.price.grs.amount) : null);
  if (!id || price == null || price < 500) return null;

  const attr = it.attr || {};
  const title = String(it.title || `${it.shortTitle || ''} ${it.subTitle || ''}`).trim().slice(0, 140);
  const km = num(attr.ml);
  const yearMatch = /((?:19|20)\d{2})/.exec(attr.fr || '');
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
  const psMatch = /\((\d+)\s*PS\)/.exec(attr.pw || '') || /(\d+)\s*PS/.exec(attr.pw || '');
  const power_cv = psMatch ? parseInt(psMatch[1], 10) : null;

  const uri: string | null = it.images?.[0]?.uri || null;
  const image = uri ? `https://${String(uri).replace(/^\/*/, '').replace(/^https?:\/\//, '')}?rule=mo-640.jpg` : null;

  // "19,00% MwSt." on the ad ⇒ VAT shown separately ⇒ deductible; empty ⇒ not.
  const vat_deductible = /mwst|%/i.test(String(it.vat || ''));
  const enumType = it.contact?.enumType;
  const seller_type: 'DEALER' | 'PRIVATE' | null =
    enumType === 'DEALER' || it.st === 'Händler' ? 'DEALER'
    : enumType === 'PRIVATE' || it.st ? 'PRIVATE' : null;
  const rating = (typeof it.priceRating === 'object' ? it.priceRating?.rating : it.priceRating) || null;

  return {
    id, title,
    url: `https://suchen.mobile.de/fahrzeuge/details.html?id=${id}`,
    price, km, year, power_cv, image, rating, vat_deductible, seller_type,
  };
}

/** Parse the full result set out of a scraped mobile.de search page. */
export function parseMobileListings(html: string): MobileListing[] {
  const payload = recoverRSCPayload(html);
  const arrTxt = extractJsonArray(payload, '"listings":[');
  if (!arrTxt) return [];
  let arr: any[];
  try { arr = JSON.parse(arrTxt); } catch { return []; }
  if (!Array.isArray(arr)) return [];

  const out: MobileListing[] = [];
  const seen = new Set<string>();
  for (const it of arr) {
    const mapped = mapListing(it);
    if (mapped?.id && !seen.has(mapped.id)) { seen.add(mapped.id); out.push(mapped); }
  }
  return out;
}

/** Total match count mobile.de reports ("6809 Angebote"), for context/logging. */
export function parseTotalCount(html: string): number | null {
  const m = /([\d.]+)\s*Angebote/.exec(html);
  return m ? parseInt(m[1].replace(/\./g, ''), 10) : null;
}
