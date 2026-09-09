/**
 * El origen público del sitio, para los enlaces que el dealer COPIA y PEGA
 * fuera de la app (bio de Instagram, WhatsApp, su web).
 *
 * `window.location.origin` no sirve para esto: en local devuelve
 * `http://localhost:3001` y el dealer acabaría pegando un enlace muerto en su
 * bio. Estos enlaces siempre deben apuntar al dominio público, se estén
 * generando desde donde se estén generando.
 *
 * Orden: NEXT_PUBLIC_BASE_URL (definido en todos los entornos) → el origen del
 * navegador → el dominio de producción.
 */
export function publicOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (typeof window !== 'undefined') return window.location.origin;
  return 'https://carmentor.es';
}

/** El mismo origen sin protocolo, para enseñarlo en pantalla. */
export function publicHost(): string {
  return publicOrigin().replace(/^https?:\/\//, '');
}
