// Shared, presentation-agnostic view-model for a car analysis (car_analyses.result_json).
//
// Both the dealer's internal view and the client-facing report render from this
// same normalizer — only the styling (dealer theme) and the `mode` (which fields
// are shown) differ. Keeping the mapping here means one place understands the
// real /api/analyze schema (ficha_tecnica_inicial, analisis_rentabilidad,
// score_carmentor, recomendacion_final, problemas_comunes_modelo, …) and its
// legacy-flat fallbacks.

const SEVERITY_TO_RISK: Record<string, string> = {
  CRITICA: 'alto', ALTA: 'alto', MEDIA: 'medio', BAJA: 'bajo', BAJO: 'bajo',
};

export interface AnalysisFault {
  componente: string;
  riesgo: string; // 'alto' | 'medio' | 'bajo'
  descripcion: string;
  // Enriched fields from problemas_comunes_modelo.fallos_verificados (optional).
  problema?: string | null;
  frecuencia?: string | null; // 'muy_comun' | 'ocasional' | …
  km_min?: number | null;
  km_max?: number | null;
  coste_min?: number | null;
  coste_max?: number | null;
}

export interface AnalysisComparable {
  precio: number | null;
  año: number | null;
  km: number | null;
  cv: number | null;
  url: string | null;
  /** Ad headline as coches.net published it — the dealer's list shows it. */
  titulo: string | null;
}

export interface ImportVat {
  vat_deductible: boolean;
  vat_rate: number;
  precio_bruto: number;
  precio_neto: number;
}

export interface NetEconomics {
  costeNeto: number;        // total landed cost using the net (sin IVA) purchase price
  margenBrutoNeto: number;  // gross profit on the net base
  margenPctNeto: number;    // margin % on the net base (1-decimal)
  ivaDelta: number;         // recoverable import VAT (bruto − neto)
}

/**
 * The margin a dealer *actually trades* when a listing is VAT-deductible and the
 * dealer buys sin IVA (intracomunitario). The real cash cost is the net, not the
 * gross: the total cost drops by the recoverable IVA (bruto − neto) while the sale
 * price is unchanged, so the gross profit rises by exactly that same amount.
 *
 * Returns null when the override does NOT apply — listing not deductible, the
 * dealer's `deduct_import_vat` setting is off, or the inputs are missing — and
 * callers then keep the stored gross figures untouched. This is the single source
 * of truth so every surface (report, peek, list rows) shows one consistent number.
 */
export function netEconomics(
  iva: ImportVat | null | undefined,
  precioCompraTotal: number | null | undefined,
  margenBruto: number | null | undefined,
  deductImportVat: boolean | undefined,
): NetEconomics | null {
  if (!deductImportVat || !iva?.vat_deductible) return null;
  const ivaDelta = (iva.precio_bruto ?? 0) - (iva.precio_neto ?? 0);
  if (!(ivaDelta > 0) || precioCompraTotal == null || margenBruto == null) return null;
  const costeNeto = precioCompraTotal - ivaDelta;
  if (!(costeNeto > 0)) return null;
  const margenBrutoNeto = margenBruto + ivaDelta;
  const margenPctNeto = Math.round((margenBrutoNeto / costeNeto) * 1000) / 10;
  return { costeNeto, margenBrutoNeto, margenPctNeto, ivaDelta };
}

export interface ScoreRadar {
  fiabilidad_mecanica: number;
  coste_mantenimiento: number;
  precio_vs_mercado: number;
  consumo_eficiencia: number;
  score_global: number;
}

// Spec sheet (ficha_tecnica_inicial / ficha_tecnica).
export interface FichaTecnica {
  resumen: string | null;
  marca_modelo: string | null;
  año: number | null;
  kilometraje: number | null;
  potencia: string | null;
  combustible: string | null;
  transmision: string | null;
  carroceria: string | null;
  traccion: string | null;
  emisiones_co2: number | null;
  etiqueta_ambiental: string | null;
  estado_general: string | null;
}

// A single issue flagged in THIS listing (distinct from generic model faults).
export interface ProblemaAnuncio {
  problema: string;
  traduccion: string | null;
  gravedad: string | null; // 'grave' | 'moderado' | 'leve'
}

// Model weak spots grouped by area.
export interface PuntosDebiles {
  electrica: string[];
  interiores: string[];
  electronica: string[];
}

export interface ImportCostLine {
  label: string;
  amount: number;
}
export interface CostesImportacion {
  total: number | null;
  lines: ImportCostLine[];
}

// Registration-tax payload persisted by the analyzer, passed straight to the
// dealer IEDMT breakdown (recomputed client-side via calculateIEDMT).
export interface IedmtData {
  inputs: any; // IEDMTInputs — kept loose to avoid coupling analysis-view to lib/iedmt
  source: string | null;
  co2Estimated: boolean;
}

export interface MaintenanceItem {
  componente: string;
  coste_min: number | null;
  coste_max: number | null;
  coste_estimado: number | null;
  km_estimado: number | null;
  km_restantes: number | null;
  descripcion: string | null;
}
export interface Mantenimiento {
  motor_identificado: string | null;
  items: MaintenanceItem[];
  coste_total_min: number | null;
  coste_total_max: number | null;
  comparativa_segmento: string | null;
  depreciacion_esperada: string | null;
}

export interface RevisionItem {
  elemento: string;
  descripcion: string | null;
  importancia: string | null; // 'alta' | 'media' | …
}
export interface Revision {
  elementos: RevisionItem[];
  consejos: string[];
}

export interface AnalysisView {
  titulo: string | null;
  año: number | null;
  kilometraje: number | null;
  car_images: string[];

  // Listing origin — national (Spanish car already in Spain) hides import/IEDMT/rentabilidad.
  listing_origin: string | null;
  is_national: boolean;
  ubicacion_vendedor: string | null;

  // Spec sheet
  ficha: FichaTecnica;

  // Score
  score_global: number | null; // 0–10
  score_radar: ScoreRadar | null;

  // Economics — DEALER ONLY (hidden in client mode by the renderer)
  precio_compra_total: number | null;
  precio_venta_estimado: number | null;
  margen_bruto: number | null;
  margen_porcentaje: number | null;
  rentabilidad: string | null;
  factores_valoracion: string[];
  low_confidence: boolean;
  /** Por qué el anuncio de ORIGEN no es comparable (siniestro, leasing, subasta,
   *  furgón). Vacío = anuncio normal. Ver lib/listing-quality.ts. */
  listing_flags: string[];
  iva_import: ImportVat | null; // import-VAT (MwSt) net/gross breakdown — dealer only
  costes_importacion: CostesImportacion | null; // dealer only
  iedmt: IedmtData | null; // dealer only

  // Market
  precio_medio: number | null;
  precio_minimo: number | null;
  precio_maximo: number | null;
  n_comparables: number | null;
  comparables: AnalysisComparable[];
  url_busqueda_mercado: string | null;
  url_busqueda_sin_km: string | null;
  analisis_comparativo: string | null;
  extras_encontrados: string[];
  advertencia_precios: string | null;

  // This listing's flagged issues
  problemas_anuncio: ProblemaAnuncio[];
  advertencias_vendedor: string[];
  comentario_anuncio: string | null;

  // Model faults & reputation
  fallos: AnalysisFault[];
  motorizacion: string | null;
  reputacion_motor: string | null;
  historial_motor: string | null;
  puntos_debiles: PuntosDebiles | null;

  // Ongoing costs & inspection
  mantenimiento: Mantenimiento | null;
  revision: Revision | null;

  // Recommendation
  veredicto: string | null;
  razonamiento: string | null;
  estrategia_compra: string | null;
  precio_maximo_compra: number | null;
  precio_objetivo_venta: number | null;
  tips_negociacion: string[];
}

/**
 * Strip dealer economics from a result_json before sending it to a client-facing
 * surface (public presupuesto / informe). The UI hiding fields in "client" mode
 * is not enough — the raw payload would still leak margin/purchase cost over the
 * network. Removes purchase cost, margin, import-cost breakdown, tax params and
 * the dealer's price targets / negotiation tips; keeps market prices, score,
 * model faults, spec sheet, photos and the verdict/reasoning.
 */
export function toClientResultJson(rj: any): any {
  if (!rj || typeof rj !== 'object') return rj;
  const clone: any = { ...rj };
  delete clone.analisis_rentabilidad;
  delete clone.costes_importacion;
  delete clone.parametros_calculo_impuestos;
  delete clone.iedmt;
  if (clone.recomendacion_final && typeof clone.recomendacion_final === 'object') {
    const { veredicto, razonamiento } = clone.recomendacion_final;
    clone.recomendacion_final = { veredicto, razonamiento };
  }
  return clone;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(v: unknown): string | null {
  if (typeof v === 'string') return v.length > 0 ? v : null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function strArr(v: unknown): string[] {
  return (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && x.length > 0);
}

/**
 * Comparables reales de un `result_json`, deduplicados.
 *
 * coches.net republica el mismo coche con distinto id de anuncio, así que la
 * longitud bruta sobreestima la muestra (medido: n efectiva 4,83 sobre 5). Se
 * deduplica también en el scraper; aquí se cubren los análisis ya guardados.
 *
 * NUNCA se usa `total_anuncios`: en análisis históricos lo rellenaba la IA y
 * podía estar inventado.
 */
export function dedupedComparables(resultJson: any): AnalysisComparable[] {
  const raw = resultJson || {};
  const mercado = raw.investigacion_mercado || {};
  const precios = mercado.precios_espana || {};
  const cochesNet = Array.isArray(precios.coches_net) ? precios.coches_net
    : Array.isArray(mercado.comparables) ? mercado.comparables : [];
  const seen = new Set<string>();
  return cochesNet
    .map((c: any) => ({
      precio: num(c.precio ?? c.price),
      año: num(c.año ?? c.year),
      km: num(c.km ?? c.kilometraje),
      cv: num(c.cv),
      url: typeof (c.url ?? c.link) === 'string' ? (c.url ?? c.link) : null,
      titulo: typeof (c.titulo ?? c.marca_modelo ?? c.title) === 'string' ? (c.titulo ?? c.marca_modelo ?? c.title) : null,
    }))
    .filter((c: AnalysisComparable) => {
      const key = `${c.precio}|${c.km}|${c.año}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export interface MarketHonesty {
  /** Comparables reales deduplicados. */
  realComparables: number;
  /** Hay al menos un anuncio real que sostenga un precio de mercado. */
  hasRealMarket: boolean;
  /** Muestra pobre (<3) o anuncio de origen no comparable. */
  lowConfidence: boolean;
  /** Flags del anuncio de origen (siniestro / leasing / subasta / furgón). */
  listingFlags: string[];
}

/** Estado del gate de honestidad de mercado para un `result_json`. */
export function marketHonesty(resultJson: any): MarketHonesty {
  const raw = resultJson || {};
  const realComparables = dedupedComparables(raw).length;
  const listingOrigen = raw.listing_origen || {};
  const listingFlags: string[] = Array.isArray(listingOrigen.flags)
    ? listingOrigen.flags.filter((f: unknown): f is string => typeof f === 'string')
    : [];
  return {
    realComparables,
    hasRealMarket: realComparables > 0,
    lowConfidence: realComparables < 3 || listingFlags.length > 0,
    listingFlags,
  };
}

/**
 * Aplica el gate de honestidad a un `result_json` y devuelve una copia.
 *
 * POR QUÉ EXISTE
 *
 * La supresión vivía solo dentro de `buildAnalysisView`, que únicamente usan las
 * superficies de dealer y `/informe`. El panel de consumidor, el feed y el PDF
 * leen `result_json` en crudo, así que los análisis guardados antes del
 * 2026-07-20 —cuando la IA rellenaba `precio_medio` «de su conocimiento
 * general» si el scraper volvía vacío— seguían enseñando un precio inventado
 * como si fuera dato de mercado (medido 2026-07-20: 262 de 1.096, 23,9 %).
 *
 * Al ser supresión en LECTURA, arregla el histórico sin backfill: un análisis
 * con `coches_net: []` deja de tener precio en cuanto se vuelve a abrir.
 *
 * Los análisis nuevos ya salen limpios de `/api/analyze` (que anula esos mismos
 * campos al escribir), así que aquí son una no-op.
 */
export function applyMarketHonesty<T = any>(resultJson: T): T {
  const raw: any = resultJson;
  if (!raw || typeof raw !== 'object') return resultJson;

  const gate = marketHonesty(raw);
  const out: any = { ...raw };

  // El flag viaja siempre: las superficies de consumidor no lo calculaban y por
  // eso enseñaban una muestra de 1-2 anuncios sin marcarla como poco fiable.
  out.analisis_rentabilidad = {
    ...(raw.analisis_rentabilidad || {}),
    low_confidence_market: gate.lowConfidence,
  };
  out.listing_flags = gate.listingFlags;
  out.n_comparables = gate.realComparables;

  if (gate.hasRealMarket) return out;

  // Sin un solo anuncio real no hay precio de mercado que enseñar, y sin precio
  // de mercado tampoco hay margen: `margen_bruto` se calcula contra él.
  const mercado = raw.investigacion_mercado;
  if (mercado && typeof mercado === 'object') {
    const precios = mercado.precios_espana;
    out.investigacion_mercado = {
      ...mercado,
      comparables: [],
      ...(precios && typeof precios === 'object' ? {
        precios_espana: {
          ...precios,
          coches_net: [],
          precio_medio: null,
          precio_mediana: null,
          precio_minimo: null,
          precio_maximo: null,
          media_5_baratos: null,
          total_anuncios: 0,
          total_mercado: 0,
        },
      } : {}),
    };
  }
  out.analisis_rentabilidad = {
    ...out.analisis_rentabilidad,
    precio_venta_estimado: null,
    margen_bruto: null,
    margen_porcentaje: null,
  };
  return out as T;
}

/** Normalize a car_analyses.result_json (+ optional title) into an AnalysisView. */
export function buildAnalysisView(resultJson: any, title?: string | null): AnalysisView {
  const raw = resultJson || {};
  const fichaRaw = raw.ficha_tecnica_inicial || raw.ficha_tecnica || {};
  const rent = raw.analisis_rentabilidad || {};
  const score = raw.score_carmentor || {};
  const reco = raw.recomendacion_final || raw.recomendacion || {};
  const problemas = raw.problemas_comunes_modelo || {};
  const mercado = raw.investigacion_mercado || {};
  const precios = mercado.precios_espana || {};

  const listing_origin = str(raw.listing_origin ?? raw.listing_type);
  const is_national = listing_origin === 'domestic'
    || raw.listing_type === 'national'
    || raw.costes_importacion?.analisis_type === 'national';

  // ── Spec sheet ──
  const ficha: FichaTecnica = {
    resumen: str(fichaRaw.resumen),
    marca_modelo: str(fichaRaw.marca_modelo),
    año: num(fichaRaw.año),
    kilometraje: num(fichaRaw.kilometraje),
    potencia: str(fichaRaw.potencia),
    combustible: str(fichaRaw.combustible),
    transmision: str(fichaRaw.transmision),
    carroceria: str(fichaRaw.carroceria),
    traccion: str(fichaRaw.tipo_traccion),
    emisiones_co2: num(fichaRaw.emisiones_co2 ?? fichaRaw.emisiones_vin),
    etiqueta_ambiental: str(fichaRaw.etiqueta_ambiental),
    estado_general: str(fichaRaw.estado_general),
  };

  // ── Model faults ──
  const rawFallos = problemas.fallos_verificados || problemas.fallos_tipicos_mecanicos || raw.fallos_tipicos || [];
  const fallos: AnalysisFault[] = (Array.isArray(rawFallos) ? rawFallos : []).map((f: any) => ({
    componente: f.componente || f.problema || '—',
    riesgo: f.riesgo || SEVERITY_TO_RISK[String(f.severidad || '').toUpperCase()] || 'bajo',
    descripcion: f.descripcion || '',
    problema: str(f.problema),
    frecuencia: str(f.frecuencia),
    km_min: num(f.km_aparicion_min),
    km_max: num(f.km_aparicion_max),
    coste_min: num(f.coste_reparacion_min),
    coste_max: num(f.coste_reparacion_max),
  }));

  const pdRaw = problemas.puntos_debiles;
  const puntos_debiles: PuntosDebiles | null = (pdRaw && typeof pdRaw === 'object')
    ? { electrica: strArr(pdRaw.electrica), interiores: strArr(pdRaw.interiores), electronica: strArr(pdRaw.electronica) }
    : null;

  // ── This listing's flagged issues ──
  const paRaw = raw.problemas_detectados_anuncio || raw.problemas_detectados || {};
  const paObj = Array.isArray(paRaw) ? { problemas: paRaw } : paRaw;
  const problemas_anuncio: ProblemaAnuncio[] = (Array.isArray(paObj.problemas) ? paObj.problemas : [])
    .map((p: any) => {
      if (typeof p === 'string') return { problema: p, traduccion: null, gravedad: null };
      return {
        problema: p.problema || '',
        traduccion: p.traduccion && p.traduccion !== p.problema ? p.traduccion : null,
        gravedad: (typeof p.gravedad === 'string' ? p.gravedad.toLowerCase() : null) || null,
      };
    })
    .filter((p: ProblemaAnuncio) => !!p.problema);

  // ── Market comparables (real path is precios_espana.coches_net) ──
  // Recuento, dedupe y flags viven en `marketHonesty` / `dedupedComparables`,
  // compartidos con `applyMarketHonesty` (el mismo gate para las superficies de
  // consumidor, que no pasan por este view-model). Duplicarlo aquí era la vía
  // directa a que dealer y consumidor volvieran a divergir.
  const comparables: AnalysisComparable[] = dedupedComparables(raw);
  const { realComparables, hasRealMarket, listingFlags } = marketHonesty(raw);

  // ── Import costs (dealer only) ──
  const ci = raw.costes_importacion || {};
  const importCandidates: [string, unknown][] = [
    ['Precio de compra', ci.precio_compra],
    ['Transporte / combustible', ci.coste_combustible],
    ['Vuelo', ci.vuelo],
    ['Peajes', ci.peajes],
    ['ITV', ci.itv],
    ['COC', ci.coc],
    ['DGT', ci.dgt],
    ['Placas', ci.coste_placas],
    ['Impuesto de matriculación', ci.impuesto_matriculacion],
    ['Impuesto de circulación', ci.impuesto_circulacion ?? ci.impuesto_circulacion_anual ?? ci.impuesto_circulacion_prorrata],
  ];
  const importLines: ImportCostLine[] = importCandidates
    .map(([label, v]) => ({ label, amount: num(v) }))
    .filter((l): l is ImportCostLine => l.amount != null && l.amount !== 0);
  const costes_importacion: CostesImportacion | null = Object.keys(ci).length > 0
    ? { total: num(ci.coste_total), lines: importLines }
    : null;

  // ── IEDMT (dealer only) ──
  const iedmtRaw = raw.iedmt;
  const iedmt: IedmtData | null = (iedmtRaw && iedmtRaw.inputs)
    ? { inputs: iedmtRaw.inputs, source: str(iedmtRaw.source), co2Estimated: !!iedmtRaw.co2Estimated }
    : null;

  // ── Maintenance (coste_mantenimiento_real) ──
  const mant = raw.coste_mantenimiento_real || {};
  const mantItems: MaintenanceItem[] = (Array.isArray(mant.mantenimientos_futuros) ? mant.mantenimientos_futuros : [])
    .map((m: any) => ({
      componente: m.componente || '—',
      coste_min: num(m.coste_min),
      coste_max: num(m.coste_max),
      coste_estimado: num(m.coste_estimado),
      km_estimado: num(m.km_estimado),
      km_restantes: num(m.km_restantes),
      descripcion: str(m.descripcion),
    }));
  const mantenimiento: Mantenimiento | null = Object.keys(mant).length > 0
    ? {
        motor_identificado: str(mant.motor_identificado),
        items: mantItems,
        coste_total_min: num(mant.coste_total_proximas_revisiones?.min),
        coste_total_max: num(mant.coste_total_proximas_revisiones?.max),
        comparativa_segmento: str(mant.comparativa_segmento),
        depreciacion_esperada: str(mant.depreciacion_esperada),
      }
    : null;

  // ── Recommended inspection ──
  const rev = raw.revision_tecnica_recomendada || raw.revision_tecnica || {};
  const revElems: RevisionItem[] = (Array.isArray(rev.elementos_revision) ? rev.elementos_revision : [])
    .map((e: any) => ({ elemento: e.elemento || '—', descripcion: str(e.descripcion), importancia: str(e.importancia) }));
  const revConsejos = strArr(rev.consejos_mecanico);
  const revision: Revision | null = (revElems.length > 0 || revConsejos.length > 0)
    ? { elementos: revElems, consejos: revConsejos }
    : null;

  const hasRadar = ['fiabilidad_mecanica', 'coste_mantenimiento', 'precio_vs_mercado', 'consumo_eficiencia']
    .some((k) => typeof score[k] === 'number');

  return {
    titulo: title ?? ficha.marca_modelo ?? raw.titulo ?? null,
    año: num(fichaRaw.año ?? raw.año),
    kilometraje: num(fichaRaw.kilometraje ?? raw.kilometraje),
    car_images: strArr(raw.car_images),

    listing_origin,
    is_national,
    ubicacion_vendedor: str(raw.ubicacion_vendedor),

    ficha,

    score_global: num(score.score_global ?? raw.puntuacion_global),
    score_radar: hasRadar ? {
      fiabilidad_mecanica: num(score.fiabilidad_mecanica) ?? 0,
      coste_mantenimiento: num(score.coste_mantenimiento) ?? 0,
      precio_vs_mercado: num(score.precio_vs_mercado) ?? 0,
      consumo_eficiencia: num(score.consumo_eficiencia) ?? 0,
      score_global: num(score.score_global) ?? 0,
    } : null,

    precio_compra_total: num(rent.precio_compra_total ?? raw.precio_publicado ?? raw.precio),
    // Con CERO comparables reales no hay nada contra lo que calcular un margen:
    // la venta estimada salía del `precio_medio` inventado por la IA, así que el
    // margen heredaba la ficción con aspecto de dato. Se suprimen en lectura —
    // `low_confidence` sigue marcando la franja 1-2 comparables, que sí existe
    // pero es frágil. Sin esto el 23,9 % del histórico enseña margen sin mercado.
    precio_venta_estimado: hasRealMarket
      ? num(rent.precio_venta_estimado ?? raw.precio_venta_estimado)
      : null,
    margen_bruto: hasRealMarket ? num(rent.margen_bruto) : null,
    margen_porcentaje: hasRealMarket
      ? num(rent.margen_porcentaje ?? raw.margen_porcentaje)
      : null,
    rentabilidad: rent.rentabilidad ?? null,
    factores_valoracion: strArr(rent.factores_valoracion),
    // Honesty gate (single source of truth): a margin is low-confidence when el
    // servidor lo marcó O la muestra española deduplicada tiene menos de 3
    // anuncios REALES. Se cuenta sobre `comparables`, no sobre `total_anuncios`
    // (campo que la IA podía inventar), así que los análisis antiguos guardados
    // con un recuento inflado se corrigen solos al leerlos.
    low_confidence: (rent.low_confidence_market ?? false) ||
      realComparables < 3 ||
      listingFlags.length > 0,
    listing_flags: listingFlags,
    iva_import: (rent.iva_import && typeof rent.iva_import === 'object')
      ? {
          vat_deductible: !!rent.iva_import.vat_deductible,
          vat_rate: num(rent.iva_import.vat_rate) ?? 19,
          precio_bruto: num(rent.iva_import.precio_bruto) ?? 0,
          precio_neto: num(rent.iva_import.precio_neto) ?? 0,
        }
      : null,
    costes_importacion,
    iedmt,

    // Sin anuncios reales no hay precio de mercado. Históricamente, cuando el
    // scraper no encontraba nada la IA rellenaba `precio_medio` "de su
    // conocimiento general" y la ficha lo pintaba como dato (medido 2026-07-20:
    // 262 de 1.096 análisis, 23,9 %, con `coches_net: []` y un precio_medio no
    // nulo). Como estos campos se muestran SIN pasar por `low_confidence`, aquí
    // se suprimen en lectura: arregla también todo el histórico ya guardado.
    precio_medio: hasRealMarket ? num(precios.precio_medio) : null,
    precio_minimo: hasRealMarket ? num(precios.precio_minimo) : null,
    precio_maximo: hasRealMarket ? num(precios.precio_maximo) : null,
    n_comparables: realComparables,
    comparables,
    url_busqueda_mercado: raw.url_busqueda_mercado ?? mercado.url_busqueda_real ?? mercado.url_busqueda ?? mercado.url_busqueda_mercado ?? null,
    url_busqueda_sin_km: str(raw.url_busqueda_sin_km),
    analisis_comparativo: str(mercado.analisis_comparativo),
    extras_encontrados: strArr(mercado.extras_encontrados),
    advertencia_precios: str(mercado.advertencia_precios),

    problemas_anuncio,
    advertencias_vendedor: strArr(paObj.advertencias_vendedor),
    comentario_anuncio: str(paObj.comentario_problemas_anuncio),

    fallos,
    motorizacion: str(problemas.motorizacion),
    reputacion_motor: str(problemas.reputacion_motor),
    historial_motor: str(problemas.historial_motor),
    puntos_debiles,

    mantenimiento,
    revision,

    veredicto: reco.veredicto ?? raw.veredicto ?? null,
    razonamiento: reco.razonamiento ?? null,
    estrategia_compra: str(reco.estrategia_compra),
    precio_maximo_compra: num(reco.precio_maximo_compra ?? reco.precio_maximo_recomendado),
    precio_objetivo_venta: num(reco.precio_objetivo_venta),
    tips_negociacion: strArr(reco.tips_negociacion),
  };
}
