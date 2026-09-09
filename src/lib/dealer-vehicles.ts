// Vehicle profiles for a dealer operación.
//
// A customer usually has "a few cars in mind" — that is ONE operación with N
// vehicle profiles (see docs/DEALER_MULTI_VEHICLE.md). This module is the single
// place that: normalizes an incoming payload (array OR legacy single-spec) into a
// capped Vehicle[], builds the mobile.de search URL per profile, and mirrors
// vehicles[0] back to the flat columns so every existing read keeps working.

import { buildMobileDeSearchUrl, resolveMobileSearch } from './mobile-de-search';

// Cap per operación — keeps the form summary, search-chip UI and the customer's
// patience sane. Locked at 4 (docs/DEALER_MULTI_VEHICLE.md, open decision).
export const MAX_VEHICLES = 4;

export interface Vehicle {
  make: string | null;
  model: string | null;
  make_id: number | null;
  model_id: number | null;
  model_ms: string | null; // full mobile.de ms quad (transient, kept for re-search)
  /** Trim/version free text — goes into the ms quad, so it really filters. */
  variant: string | null;
  /**
   * Engine designations the customer explicitly asked for (320d, 1.6 TDI, 428i).
   * The customer may pick several of the same model. These HEADLINE the
   * motorization advisory (each with its own verdict) — see ModelSearch. Distinct
   * from `variant` (a trim keyword like "GTI"); an engine is an identity, not a
   * search keyword, so it must not be flattened into the ms quad.
   */
  engines: string[] | null;
  min_price: number | null; // suelo del rango de presupuesto (solo en el jsonb — no hay columna plana)
  max_price: number | null;
  max_km: number | null;
  min_year: number | null;
  max_year: number | null;
  /**
   * Código de chasis que eligió el cliente en el cuestionario (F30, 8V, Golf 7).
   * Se guardaba solo derivado a min_year/max_year y el código se perdía, así que
   * al analizar un coche había que volver a adivinar la generación por el año —
   * incluido el año de transición, donde adivinar es justo lo que falla. Con el
   * código guardado, el análisis usa la elección del cliente como verdad (T0 de
   * la cascada de resolveGeneration).
   */
  generation: string | null;
  fuel: string | null;
  transmission: string | null;
  min_cv: number | null;
  color: string | null;      // preference only — deliberately NOT in the search URL
  body_type: string | null;
  drive_type: string | null;
  interior_type: string | null;
  doors: string | null;
  seats: number | null;
  emission_class: string | null;
  /**
   * mobile.de `fe` values the customer called imprescindible. These become hard
   * AND-ed filters in the URL — everything the customer merely *likes* stays in
   * `nice_to_have`, so a long wishlist can never zero out the search.
   */
  features: string[] | null;
  nice_to_have: string[] | null;
  mobile_url: string | null;
}

const num = (v: unknown): number | null => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (String(v ?? '').trim() || null);
const strList = (v: unknown): string[] | null => {
  if (!Array.isArray(v)) return null;
  const out = v.map((x) => String(x ?? '').trim()).filter(Boolean);
  return out.length ? out : null;
};

// A raw vehicle carries either dropdown ids (make_id/model_ms, from the
// questionnaire) or free text (make/model, from the dealer intake / Tally).
function coerce(raw: Record<string, unknown>): Vehicle {
  let makeId = num(raw.make_id);
  let modelMs = str(raw.model_ms);

  // Free-text path: resolve make/model to a mobile.de id + ms quad.
  if (makeId == null && str(raw.make)) {
    const r = resolveMobileSearch(str(raw.make), str(raw.model));
    makeId = r.makeId ?? null;
    if (modelMs == null) modelMs = r.modelMs ?? null;
  }

  const v: Vehicle = {
    make: str(raw.make),
    model: str(raw.model),
    make_id: makeId,
    model_id: num(raw.model_id),
    model_ms: modelMs,
    variant: str(raw.variant),
    engines: strList(raw.engines),
    min_price: num(raw.min_price),
    max_price: num(raw.max_price),
    max_km: num(raw.max_km),
    min_year: num(raw.min_year),
    max_year: num(raw.max_year),
    generation: str(raw.generation),
    fuel: str(raw.fuel),
    transmission: str(raw.transmission),
    min_cv: num(raw.min_cv),
    color: str(raw.color),
    body_type: str(raw.body_type),
    drive_type: str(raw.drive_type),
    interior_type: str(raw.interior_type),
    doors: str(raw.doors),
    seats: num(raw.seats),
    emission_class: str(raw.emission_class),
    features: strList(raw.features),
    nice_to_have: strList(raw.nice_to_have),
    mobile_url: null,
  };

  // Only build a URL when there's at least one real search constraint (mirrors
  // the old clients-route gate; color is never applied — see mobile-de-search).
  const hasSearch =
    v.make_id != null || v.max_price != null || v.max_km != null ||
    v.min_year != null || v.fuel != null || v.body_type != null ||
    v.drive_type != null || v.seats != null || v.features != null;

  v.mobile_url = hasSearch
    ? buildMobileDeSearchUrl({
        makeId: v.make_id ?? undefined,
        modelMs: v.model_ms ?? undefined,
        variant: v.variant ?? undefined,
        minPrice: v.min_price ?? undefined,
        maxPrice: v.max_price ?? undefined,
        maxKm: v.max_km ?? undefined,
        minYear: v.min_year ?? undefined,
        maxYear: v.max_year ?? undefined,
        fuel: v.fuel ?? undefined,
        transmission: v.transmission ?? undefined,
        minCv: v.min_cv ?? undefined,
        bodyType: v.body_type ?? undefined,
        driveType: v.drive_type ?? undefined,
        interiorType: v.interior_type ?? undefined,
        doors: v.doors ?? undefined,
        seats: v.seats ?? undefined,
        emissionClass: v.emission_class ?? undefined,
        features: v.features ?? undefined,
      })
    : null;

  return v;
}

// True when a coerced vehicle carries any real content worth storing.
function isMeaningful(v: Vehicle): boolean {
  return !!(v.make || v.model || v.variant || (v.engines && v.engines.length) ||
    v.min_price || v.max_price || v.max_km ||
    v.min_year || v.max_year || v.fuel || v.transmission || v.min_cv || v.color ||
    v.body_type || v.drive_type || v.interior_type || v.doors || v.seats ||
    v.emission_class || v.features || v.nice_to_have);
}

/**
 * Normalize a write payload into a capped Vehicle[].
 * Accepts `{ vehicles: [...] }` (new) or a flat single-spec body (legacy).
 * Returns `[]` when nothing meaningful was provided (a bare operación).
 */
export function normalizeVehicles(body: Record<string, unknown>): Vehicle[] {
  const raws: Record<string, unknown>[] =
    Array.isArray(body.vehicles) && body.vehicles.length
      ? (body.vehicles as Record<string, unknown>[])
      : [body];

  return raws.slice(0, MAX_VEHICLES).map(coerce).filter(isMeaningful);
}

/** The flat-column mirror of vehicles[0], for backward-compatible reads. */
export function flatFromVehicles(vehicles: Vehicle[]): {
  make: string | null; model: string | null; make_id: number | null; model_id: number | null;
  max_price: number | null; max_km: number | null; min_year: number | null;
  fuel: string | null; transmission: string | null; min_cv: number | null;
  color: string | null; body_type: string | null; mobile_url: string | null;
} {
  const v: Partial<Vehicle> = vehicles[0] ?? {};
  return {
    make: v.make ?? null, model: v.model ?? null,
    make_id: v.make_id ?? null, model_id: v.model_id ?? null,
    max_price: v.max_price ?? null, max_km: v.max_km ?? null, min_year: v.min_year ?? null,
    fuel: v.fuel ?? null, transmission: v.transmission ?? null, min_cv: v.min_cv ?? null,
    color: v.color ?? null, body_type: v.body_type ?? null, mobile_url: v.mobile_url ?? null,
  };
}
