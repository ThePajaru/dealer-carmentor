// Fetch a mobile.de search-results page through the scrape.do unlocker — the
// same residential-proxy service already used as the coches.net anti-DataDome
// fallback (src/lib/coches-market-scraper). mobile.de is a German site, so we
// exit through a German IP (geoCode=de). ONE request returns the first results
// page (~24 ads) with the full structured data embedded; we deliberately do NOT
// paginate. This replaces the per-result Apify actor: seconds, not ~80s, and
// priced per request instead of per listing.
//
// Rotates across scrape.do accounts (src/lib/scrapedo): each free account is
// 1.000 credits/month = 100 searches, so a single key runs an active dealer dry
// in a couple of days. A failed attempt costs nothing (scrape.do only charges on
// a successful response), so falling through to the next account is free.

import {
  scrapedoKeys,
  markScrapedoExhausted,
  markScrapedoHealthy,
  isScrapedoQuotaStatus,
  buildScrapedoUrl,
} from './scrapedo';

export async function fetchMobileSearchHtml(searchUrl: string): Promise<string> {
  const keys: string[] = scrapedoKeys();
  if (keys.length === 0) throw new Error('SCRAPEDO_API_KEY no configurado');

  let lastError: Error | null = null;
  for (const key of keys) {
    try {
      const res = await fetch(buildScrapedoUrl(key, searchUrl, { geoCode: 'de' }), {
        signal: AbortSignal.timeout(90000),
      });
      if (res.ok) {
        markScrapedoHealthy(key);
        return await res.text();
      }
      // Sin crédito / bloqueada: se aparca y se sigue con la siguiente cuenta.
      if (isScrapedoQuotaStatus(res.status)) markScrapedoExhausted(key);
      lastError = new Error(`scrape.do devolvió ${res.status}`);
    } catch (err) {
      lastError = err as Error; // timeout o fallo de red — probamos la siguiente
    }
  }
  throw lastError || new Error('scrape.do: todas las cuentas fallaron');
}
