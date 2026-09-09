// Rotación de cuentas de scrape.do — misma idea que lib/apify.ts, pero aquí hay
// un motivo extra para hacerlo: el plan gratuito son 1.000 créditos/mes y cada
// petición al unlocker cuesta 10, o sea **100 búsquedas al mes por cuenta**. Con
// una sola clave, un dealer activo agota el mes en un par de días y el sourcing
// deja de funcionar hasta el día 1.
//
// CommonJS a propósito: las dos superficies que llaman a scrape.do tienen que
// compartir UNA lista de claves, y una de ellas (coches-market-scraper) es
// CommonJS y además no usa `fetch`, sino curl.
//
// Claves por env, en orden de prioridad:
//   SCRAPEDO_API_KEYS = "k1,k2,k3"   (coma / espacio / salto de línea)
//   SCRAPEDO_API_KEY  = "k"          (la de siempre; se fusiona, no se pierde)
//
// Rotar ante CUALQUIER fallo es seguro y gratis aquí, al contrario que en Apify:
// scrape.do solo cobra cuando la petición devuelve una respuesta correcta, así
// que un intento fallido no cuesta créditos. Por eso no hace falta adivinar si el
// error concreto es "sin crédito" — se prueba la siguiente cuenta y ya.

function parseKeys() {
  const multi = String(process.env.SCRAPEDO_API_KEYS || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const single = String(process.env.SCRAPEDO_API_KEY || '').trim();
  return [...new Set([...multi, ...(single ? [single] : [])])];
}

// Estado en memoria por instancia serverless. En un arranque en frío se pierde,
// así que el peor caso es un intento desperdiciado contra una cuenta agotada
// antes de volver a aparcarla — barato y se cura solo.
const g = globalThis;
const exhausted = g.__scrapedoExhausted || (g.__scrapedoExhausted = new Map());
const COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 h

/** ¿Hay al menos una clave configurada? */
function scrapedoConfigured() {
  return parseKeys().length > 0;
}

/** Número de cuentas configuradas (para logs y diagnóstico). */
function scrapedoKeyCount() {
  return parseKeys().length;
}

/**
 * Claves a probar, en orden: primero las vivas (barajadas), luego las aparcadas.
 *
 * El barajado reparte el gasto: empezando siempre por la #1 se agotaría esa
 * primero y cada petición posterior tendría que ir tropezando con cuentas llenas
 * hasta dar con una viva. Barajando, las cuentas se vacían a la vez.
 */
function scrapedoKeys() {
  const keys = parseKeys();
  const now = Date.now();
  const live = keys.filter((k) => (exhausted.get(k) || 0) <= now);
  const parked = keys.filter((k) => (exhausted.get(k) || 0) > now);
  for (let i = live.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [live[i], live[j]] = [live[j], live[i]];
  }
  return [...live, ...parked];
}

/** Aparca una cuenta 6 h (sin crédito / bloqueada). */
function markScrapedoExhausted(key) {
  exhausted.set(key, Date.now() + COOLDOWN_MS);
}

/** La cuenta ha respondido bien: vuelve a la rotación. */
function markScrapedoHealthy(key) {
  exhausted.delete(key);
}

/**
 * ¿Este código HTTP significa "esta cuenta no puede servir más"?
 *
 * 401 = token inválido o sin crédito, 402 = pago requerido, 429 = límite de
 * concurrencia o de plan. Un 5xx o un bloqueo del destino NO aparcan la cuenta:
 * el problema no es de la cuenta y aparcarla nos dejaría sin claves por nada.
 */
function isScrapedoQuotaStatus(status) {
  return status === 401 || status === 402 || status === 403 || status === 429;
}

/** URL del unlocker para un objetivo. `geoCode` es el país de salida (de/es). */
function buildScrapedoUrl(token, targetUrl, options) {
  const opts = options || {};
  const geo = opts.geoCode || 'de';
  const superProxy = opts.super !== false;
  return (
    `https://api.scrape.do/?token=${token}&url=${encodeURIComponent(targetUrl)}` +
    (superProxy ? '&super=true' : '') +
    `&geoCode=${geo}`
  );
}

module.exports = {
  scrapedoConfigured,
  scrapedoKeyCount,
  scrapedoKeys,
  markScrapedoExhausted,
  markScrapedoHealthy,
  isScrapedoQuotaStatus,
  buildScrapedoUrl,
};
