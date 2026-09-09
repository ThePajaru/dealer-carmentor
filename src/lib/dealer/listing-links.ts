/**
 * Reconocimiento de enlaces de anuncios pegados por el cliente.
 *
 * Deliberadamente SIN red: es un regex que corre según el cliente teclea, así
 * que la confirmación («✓ anuncio de mobile.de») aparece al instante y nunca
 * falla por un scrape lento o bloqueado. El título y el precio reales del coche
 * los resuelve después /api/dealer/intake en segundo plano — aquí solo hace
 * falta saber que el enlace es un anuncio de un portal que sabemos analizar.
 */

export interface ListingPortal {
  id: string;
  label: string;
  /** Dominios que identifican al portal (sin www.). */
  hosts: string[];
}

export const LISTING_PORTALS: ListingPortal[] = [
  { id: 'mobile', label: 'mobile.de', hosts: ['mobile.de', 'suchen.mobile.de'] },
  { id: 'autoscout', label: 'AutoScout24', hosts: ['autoscout24.es', 'autoscout24.com', 'autoscout24.de'] },
  { id: 'coches', label: 'coches.net', hosts: ['coches.net'] },
  { id: 'milanuncios', label: 'Milanuncios', hosts: ['milanuncios.com'] },
  { id: 'wallapop', label: 'Wallapop', hosts: ['wallapop.com'] },
  { id: 'autoscout-mobile', label: 'mobile.de', hosts: ['home.mobile.de'] },
  { id: 'coches-com', label: 'coches.com', hosts: ['coches.com'] },
];

export type LinkCheck =
  | { state: 'empty' }
  | { state: 'invalid'; reason: string }
  | { state: 'unknown'; url: string }
  | { state: 'ok'; url: string; portal: string };

/**
 * Clasifica lo que el cliente ha pegado.
 *
 * `unknown` no es un error: aceptamos cualquier URL http(s) porque el analizador
 * sabe leer páginas genéricas. Solo distinguimos los portales conocidos para
 * poder decírselo al cliente y que se fíe.
 */
export function checkListingLink(raw: string): LinkCheck {
  const value = raw.trim();
  if (!value) return { state: 'empty' };

  // El cliente suele pegar sin protocolo desde la app del móvil.
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return { state: 'invalid', reason: 'Eso no parece un enlace. Copia la dirección completa del anuncio.' };
  }

  if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) {
    return { state: 'invalid', reason: 'Eso no parece un enlace. Copia la dirección completa del anuncio.' };
  }

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  const portal = LISTING_PORTALS.find(
    (p) => p.hosts.some((h) => host === h || host.endsWith(`.${h}`)),
  );

  if (portal) return { state: 'ok', url: url.toString(), portal: portal.label };
  return { state: 'unknown', url: url.toString() };
}

/** Etiquetas de los portales conocidos, para el texto de ayuda del campo. */
export const KNOWN_PORTAL_LABELS = Array.from(
  new Set(LISTING_PORTALS.map((p) => p.label)),
);
