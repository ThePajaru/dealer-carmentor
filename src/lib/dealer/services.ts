// Los dos servicios con persona detrás que CarMentor presta SOBRE una operación
// ya guardada: el gestor que paga los impuestos de matriculación (modelo 576 e
// IVTM) y el ingeniero que firma la ficha técnica reducida con las fotos que el
// runner ya sacó en su inspección.
//
// Se cobran por encargo (Stripe one-off), no van en la cuota. El precio vive en
// Stripe — aquí NUNCA se escribe un importe a mano para no desincronizarse; la
// API lo lee del price y lo devuelve al cliente (ver /api/dealer/services).

import { FICHA_PHOTOS, type GuidedPhoto } from './inspection-master';

export type ServiceKey = 'impuestos' | 'ficha_reducida';

// Ciclo de vida de un encargo. `pendiente_pago` es el estado en que nace: el
// encargo se guarda ANTES del checkout para que un pago que vuelve por webhook
// tenga siempre una fila a la que agarrarse.
export type ServiceStatus =
  | 'pendiente_pago'
  | 'pagado'
  | 'en_tramite'
  | 'completado'
  | 'cancelado';

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  pendiente_pago: 'Pendiente de pago',
  pagado: 'Pagado',
  en_tramite: 'En trámite',
  completado: 'Completado',
  cancelado: 'Cancelado',
};

export interface ServiceDef {
  key: ServiceKey;
  label: string;
  /** Quién lo ejecuta, en una línea — es lo que el dealer está comprando. */
  who: string;
  desc: string;
  /** Qué recibe el dealer al final. */
  deliverable: string;
  /** Price de Stripe (one-off). Sin él la ruta de checkout devuelve 500. */
  priceEnv: string;
}

export const SERVICES: ServiceDef[] = [
  {
    key: 'impuestos',
    label: 'Impuestos de matriculación',
    who: 'Nuestro gestor',
    desc: 'Presentamos y pagamos por ti el modelo 576 (impuesto de matriculación) y el IVTM del ayuntamiento donde se matricula el coche.',
    deliverable: 'Justificantes de pago del 576 y del IVTM, listos para la matriculación.',
    priceEnv: 'STRIPE_SERVICE_IMPUESTOS_PRICE_ID',
  },
  {
    key: 'ficha_reducida',
    label: 'Ficha técnica reducida',
    who: 'Nuestro ingeniero',
    desc: 'Con las fotos que tu runner ya sacó en la inspección, nuestro ingeniero redacta y firma la ficha técnica reducida del vehículo importado.',
    deliverable: 'Ficha técnica reducida firmada por ingeniero, en PDF.',
    priceEnv: 'STRIPE_SERVICE_FICHA_PRICE_ID',
  },
];

export const serviceDef = (key: string): ServiceDef | undefined =>
  SERVICES.find(s => s.key === key);

export const isServiceKey = (v: unknown): v is ServiceKey =>
  typeof v === 'string' && SERVICES.some(s => s.key === v);

export function servicePriceId(key: ServiceKey): string {
  const def = serviceDef(key);
  return def ? (process.env[def.priceEnv] || '') : '';
}

/* ---------- Expediente de la ficha reducida ---------- */

export interface FichaPhotoState {
  key: string;
  label: string;
  hint?: string;
  optional: boolean;
  url: string | null;
}

/**
 * Cruza las fotos marcadas `ficha: true` en el checklist maestro con las que el
 * runner subió realmente. El informe del runner guarda las fotos por LABEL
 * (`runner_report.photos[] = { label, url }`), así que el cruce va por label —
 * es lo que persiste en la base, no la key.
 */
export function fichaExpediente(
  runnerReport: { photos?: { label?: string; url?: string }[] } | null | undefined,
): FichaPhotoState[] {
  const byLabel = new Map<string, string>();
  for (const p of runnerReport?.photos || []) {
    if (p?.label && p?.url && !byLabel.has(p.label)) byLabel.set(p.label, p.url);
  }
  return FICHA_PHOTOS.map((p: GuidedPhoto) => ({
    key: p.key,
    label: p.label,
    hint: p.hint,
    optional: !!p.optional,
    url: byLabel.get(p.label) || null,
  }));
}

/** Fotos obligatorias del expediente que aún faltan (las `optional` no cuentan). */
export function fichaMissing(expediente: FichaPhotoState[]): FichaPhotoState[] {
  return expediente.filter(p => !p.optional && !p.url);
}
