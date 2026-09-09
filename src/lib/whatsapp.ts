/**
 * Números para enlaces wa.me (click-to-chat).
 *
 * wa.me exige el número en formato internacional y SOLO dígitos: nada de `+`,
 * espacios ni guiones. Los teléfonos que llegan del formulario de captación
 * vienen como los escribe el cliente («612 34 56 78», «+34 612345678»), así que
 * hay que normalizar antes de construir el enlace.
 */

/** Prefijo por defecto cuando el cliente escribe su móvil sin país (España). */
const DEFAULT_CC = '34';

/**
 * Devuelve el número listo para `https://wa.me/<n>`, o '' si no hay teléfono
 * usable — en ese caso el enlace sin número abre WhatsApp con el mensaje ya
 * escrito y el dealer elige el contacto.
 */
export function waNumber(phone?: string | null): string {
  if (!phone) return '';
  const hadPlus = phone.trim().startsWith('+');
  let digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  // 00 34 … → 34 …
  if (digits.startsWith('00')) digits = digits.slice(2);
  // 9 dígitos españoles (6/7 móvil, 8/9 fijo) sin prefijo de país.
  else if (!hadPlus && digits.length === 9) digits = DEFAULT_CC + digits;
  // Demasiado corto para ser un número internacional → no arriesgamos a abrir
  // un chat con un desconocido.
  return digits.length >= 10 ? digits : '';
}

/** Enlace click-to-chat completo. Sin número: abre WhatsApp con el texto listo. */
export function waLink(phone: string | null | undefined, text: string): string {
  return `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
}
