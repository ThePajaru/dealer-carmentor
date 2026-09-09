/**
 * IEDMT — Impuesto Especial sobre Determinados Medios de Transporte (Modelo 576)
 *
 * Pure calculation module — no DB / no I/O. Safe for client and server use.
 * Replicates the formula from dieselogasolina.com (validated against multiple
 * scenarios). Only handles cars (turismos), both nuevos y importados:
 *   - Per-region rates (incl. Cataluña, Cantabria, Murcia, Extremadura, etc.)
 *   - Canarias (IGIC) and Ceuta/Melilla (IPSI) special regimes
 *   - Depreciation table by age (imports)
 *   - Minoración (IVA histórico + IEDMT regional embebido)
 *   - Reducción BI familia numerosa (50%)
 *   - Exenciones (discapacidad, taxi, eléctrico, Ceuta/Melilla)
 *   - Pre-2007 imports special minoración rates
 *
 * Base normativa: Ley 38/1992 art. 70 — BOE-A-1992-28741.
 * Tabla de depreciación: BOE-A-2025-26357 (vigor Enero 2026).
 */

export type Region =
  | 'andalucia'
  | 'cataluna'
  | 'valencia'
  | 'asturias'
  | 'baleares'
  | 'cantabria'
  | 'extremadura'
  | 'murcia'
  | 'canarias'
  | 'ceuta-melilla'
  | 'otra';

export type VehicleType = 'coche-nuevo' | 'coche-importado';

export type Combustible = 'G' | 'D' | 'GyE' | 'S' | 'Elc' | 'DyE';

export const REGION_LABELS: Record<Region, string> = {
  andalucia: 'Andalucía',
  cataluna: 'Cataluña',
  valencia: 'Valencia',
  asturias: 'Asturias',
  baleares: 'Baleares',
  cantabria: 'Cantabria',
  extremadura: 'Extremadura',
  murcia: 'Murcia',
  canarias: 'Canarias',
  'ceuta-melilla': 'Ceuta o Melilla',
  otra: 'Otra comunidad',
};

export interface IEDMTInputs {
  vehicleType: VehicleType;
  /** Valoración inicial en € (precio sin IVA para nuevos; valoración Hacienda o factura para importados). */
  valoracion: number;
  /** Emisiones CO2 reales en g/km. Si no se conoce, dejar null → tramo "sin acreditación". */
  co2?: number | null;
  region: Region;
  electrico?: boolean;
  discapacidad?: boolean;
  taxi?: boolean;
  familiaNumerosa?: boolean;
  /** Importados: fecha de 1ª matriculación (afecta a depreciación + IVA histórico). */
  fechaMatriculacion?: Date | string | null;
  /** Importados: combustible (necesario para minoración pre-2007). */
  combustible?: Combustible | null;
  /** Importados: cilindrada cc (necesaria para minoración pre-2007). */
  cilindradaCC?: number | null;
  /** Importados Canarias: potencia fiscal (CVF) — determina IGIC 9,5% o 13,5%. */
  potenciaFiscalCVF?: number | null;
  /** Si el usuario indica valoración manual (factura), no se aplica depreciación ni minoración. */
  valoracionManual?: boolean;
  /**
   * Fecha de referencia para la edad del vehículo (congela la depreciación al
   * momento del análisis). Sin ella la edad se recalcula con Date.now() y el
   * importe mostrado deriva con el tiempo respecto al guardado en el análisis.
   */
  fechaCalculo?: Date | string | null;
}

export type Epigrafe = 1 | 2 | 3 | 4 | 5;

export interface IEDMTBreakdownStep {
  label: string;
  value: string;
  raw?: number;
  highlight?: boolean;
}

export interface IEDMTResult {
  exento: boolean;
  exentoRazon?: string;
  valoracionInicial: number;
  /** % de depreciación aplicado por antigüedad (100 si no aplica). */
  porcentajeDepreciacion: number;
  /** € restados como impuestos ya pagados (IVA + IEDMT embebido). 0 si no aplica. */
  minoracion: number;
  baseImponible: number;
  /** % reducción aplicada a la BI (familia numerosa 50). */
  reduccionBI: number;
  baseImponibleFinal: number;
  epigrafe: Epigrafe;
  epigrafeDescripcion: string;
  cuotaTributariaPct: number;
  totalAPagar: number;
  steps: IEDMTBreakdownStep[];
  warnings: string[];
  /** Información meta para depuración / mostrar. */
  meta: {
    region: Region;
    regionLabel: string;
    vehicleType: VehicleType;
    isImported: boolean;
    edadAnyos?: number;
    ivaHistorico?: number;
    impuestoMinoracion?: 'IVA' | 'IGIC' | 'IPSI';
    porcentajeAReducir?: number;
  };
}

/* ───────────────────────── Constantes ───────────────────────── */

const EPIGRAFE_DESC: Record<Epigrafe, string> = {
  1: 'Hasta 120 g/km de CO₂',
  2: 'De 120 a 159 g/km de CO₂',
  3: 'De 160 a 199 g/km de CO₂',
  4: '200 g/km de CO₂ o más',
  5: 'Sin acreditación de emisiones de CO₂',
};

/* ───────────────────────── Helpers ───────────────────────── */

function isImported(t: VehicleType): boolean {
  return t === 'coche-importado';
}

/** Tramos CO₂ → número de epígrafe (1-5) para turismos. */
export function getEpigrafeFromCO2(co2: number | null | undefined): Epigrafe {
  if (co2 == null || isNaN(co2)) return 5; // sin acreditación
  if (co2 <= 120) return 1;
  if (co2 < 160) return 2;
  if (co2 < 200) return 3;
  return 4;
}

/** Coeficiente de depreciación oficial (Orden anual de "precios medios"). */
export function getAgeDepreciationPercentage(carAgeYears: number): number {
  if (carAgeYears <= 1) return 100;
  if (carAgeYears <= 2) return 84;
  if (carAgeYears <= 3) return 67;
  if (carAgeYears <= 4) return 56;
  if (carAgeYears <= 5) return 47;
  if (carAgeYears <= 6) return 39;
  if (carAgeYears <= 7) return 34;
  if (carAgeYears <= 8) return 28;
  if (carAgeYears <= 9) return 24;
  if (carAgeYears <= 10) return 19;
  if (carAgeYears <= 11) return 17;
  if (carAgeYears <= 12) return 13;
  return 10;
}

/**
 * IVA histórico vigente en la fecha de 1ª matriculación (para minoración).
 * <2010-07 → 16% · 2010-07 a 2012-08 → 18% · ≥2012-09 → 21%
 */
function getHistoricalIVA(fecha: Date): number {
  const y = fecha.getFullYear();
  const m = fecha.getMonth() + 1;
  if (y < 2010 || (y === 2010 && m < 7)) return 0.16;
  if (y === 2010 || y === 2011 || (y === 2012 && m < 9)) return 0.18;
  return 0.21;
}

/** Mapeo region → porcentajes por epígrafe (decimal 0..1). */
export function getPorcentajesByRegion(region: Region): {
  p1: number;
  p2: number;
  p3: number;
  p4: number;
  p5: number;
} {
  // Base nacional (Andalucía y "Otra"):
  let p1 = 0;
  let p2 = 0.0475;
  let p3 = 0.0975;
  let p4 = 0.1475;
  let p5 = 0.12;

  switch (region) {
    case 'andalucia':
    case 'otra':
      break;
    case 'cataluna':
    case 'asturias':
    case 'baleares':
      p4 = 0.16;
      break;
    case 'cantabria':
      p4 = 0.15;
      p5 = 0.12;
      break;
    case 'extremadura':
      p2 = 0.052;
      p3 = 0.11;
      p4 = 0.16;
      p5 = 0.13;
      break;
    case 'murcia':
      p4 = 0.159;
      break;
    case 'valencia':
      p4 = 0.16;
      break;
    case 'canarias':
      p1 = 0;
      p2 = 0.0375;
      p3 = 0.0875;
      p4 = 0.1375;
      p5 = 0.11;
      break;
    case 'ceuta-melilla':
      p1 = p2 = p3 = p4 = p5 = 0;
      break;
  }
  return { p1, p2, p3, p4, p5 };
}

/* ───────────────────────── Cálculo principal ───────────────────────── */

const fmtEUR = (n: number) =>
  new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(Math.round(n));
const fmtEURDec = (n: number) =>
  new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export function calculateIEDMT(inputs: IEDMTInputs): IEDMTResult {
  const warnings: string[] = [];
  const steps: IEDMTBreakdownStep[] = [];

  const region = inputs.region;
  const regionLabel = REGION_LABELS[region];
  const imported = isImported(inputs.vehicleType);
  const valoracionInicial = Math.round(inputs.valoracion);

  steps.push({ label: 'Valoración inicial', value: `${fmtEUR(valoracionInicial)} €`, raw: valoracionInicial });

  /* ─── Exenciones ─── */
  if (inputs.electrico) {
    return buildExento('Vehículo 100% eléctrico (exento)', inputs, regionLabel, imported, valoracionInicial);
  }
  if (inputs.discapacidad) {
    return buildExento('Persona con discapacidad (exento)', inputs, regionLabel, imported, valoracionInicial);
  }
  if (inputs.taxi) {
    return buildExento('Uso taxi / VTC (exento)', inputs, regionLabel, imported, valoracionInicial);
  }
  if (region === 'ceuta-melilla') {
    return buildExento('Matriculación en Ceuta/Melilla (exento)', inputs, regionLabel, imported, valoracionInicial);
  }

  /* ─── Determinar epígrafe (siempre desde CO2 para turismos) ─── */
  const epigrafe: Epigrafe = getEpigrafeFromCO2(inputs.co2);

  const porcentajes = getPorcentajesByRegion(region);
  const pctMap: Record<Epigrafe, number> = {
    1: porcentajes.p1,
    2: porcentajes.p2,
    3: porcentajes.p3,
    4: porcentajes.p4,
    5: porcentajes.p5,
  };
  const cuotaTributariaPct = pctMap[epigrafe] * 100;

  /* ─── Depreciación + minoración (sólo importados, salvo valoración manual) ─── */
  let valoracion = valoracionInicial;
  let porcentajeDepreciacion = 100;
  let minoracion = 0;
  let ivaHistorico: number | undefined;
  let impuestoMinoracion: 'IVA' | 'IGIC' | 'IPSI' | undefined;
  let porcentajeAReducir: number | undefined;
  let edadAnyos: number | undefined;

  if (imported && !inputs.valoracionManual) {
    const fecha = parseFechaMatriculacion(inputs.fechaMatriculacion);
    if (!fecha) {
      warnings.push('Sin fecha de matriculación: se asume vehículo < 1 año (sin depreciación).');
    }
    const fechaSegura = fecha ?? new Date();
    const referencia = parseFechaMatriculacion(inputs.fechaCalculo) ?? new Date();
    const msPerYear = 1000 * 60 * 60 * 24 * 365.25;
    edadAnyos = Math.max(0, (referencia.getTime() - fechaSegura.getTime()) / msPerYear);
    porcentajeDepreciacion = getAgeDepreciationPercentage(edadAnyos);
    const valorMercado = valoracionInicial * (porcentajeDepreciacion / 100);

    steps.push({
      label: 'Porcentaje a aplicar (depreciación)',
      value: `${porcentajeDepreciacion}%`,
      raw: porcentajeDepreciacion,
    });

    /* Cálculo del porcentaje_a_reducir (lo embebido) */
    ivaHistorico = getHistoricalIVA(fechaSegura);
    const fuel = inputs.combustible;
    const cc = inputs.cilindradaCC ?? 0;
    const year = fechaSegura.getFullYear();
    const isCanarias = region === 'canarias';

    if (year <= 2007) {
      const lowCC = (fuel === 'G' && cc < 1600) || (fuel === 'D' && cc < 2000);
      const highCC = (fuel === 'G' && cc >= 1600) || (fuel === 'D' && cc >= 2000);
      if (lowCC) porcentajeAReducir = isCanarias ? 6 : 7;
      else if (highCC) porcentajeAReducir = isCanarias ? 11 : 12;
      else porcentajeAReducir = cuotaTributariaPct; // datos insuficientes
    } else {
      porcentajeAReducir = cuotaTributariaPct;
    }

    /* Impuesto territorial: Canarias→IGIC, resto→IVA (Ceuta/Melilla ya devuelto como exento arriba) */
    let impPct: number;
    if (region === 'canarias') {
      const cvf = inputs.potenciaFiscalCVF ?? 0;
      impPct = cvf <= 11 ? 9.5 : 13.5;
      impuestoMinoracion = 'IGIC';
    } else {
      impPct = ivaHistorico * 100;
      impuestoMinoracion = 'IVA';
    }
    const totalDeduccionDiv = 1 + (impPct + porcentajeAReducir) / 100;
    const baseSinImpuestos = valorMercado / totalDeduccionDiv;
    minoracion = Math.round(valorMercado - baseSinImpuestos);
    valoracion = Math.round(baseSinImpuestos);

    steps.push({
      label: 'Minoración (impuestos ya pagados)',
      value: `−${fmtEUR(minoracion)} €`,
      raw: -minoracion,
    });
  }

  steps.push({
    label: 'Base imponible',
    value: `${fmtEUR(valoracion)} €`,
    raw: valoracion,
    highlight: true,
  });

  /* ─── Reducciones BI (familia numerosa 50%) ─── */
  const reduccionBI = inputs.familiaNumerosa ? 50 : 0;
  const baseImponibleFinal = Math.round(valoracion - (valoracion * reduccionBI) / 100);

  steps.push({
    label: 'Reducción de la base imponible',
    value: reduccionBI > 0 ? `−${reduccionBI}%` : 'NO',
  });
  steps.push({
    label: 'Base imponible final',
    value: `${fmtEUR(baseImponibleFinal)} €`,
    raw: baseImponibleFinal,
    highlight: true,
  });

  /* ─── Cuota ─── */
  const epigrafeDescripcion = EPIGRAFE_DESC[epigrafe];

  steps.push({
    label: `Cuota tributaria (epígrafe ${epigrafe}.º · ${regionLabel})`,
    value: `${cuotaTributariaPct.toFixed(2)}%`,
    raw: cuotaTributariaPct,
  });

  const totalAPagar = Math.max(0, (baseImponibleFinal * cuotaTributariaPct) / 100);

  steps.push({
    label: 'Total a pagar',
    value: `${fmtEURDec(totalAPagar)} €`,
    raw: totalAPagar,
    highlight: true,
  });

  return {
    exento: false,
    valoracionInicial,
    porcentajeDepreciacion,
    minoracion,
    baseImponible: valoracion,
    reduccionBI,
    baseImponibleFinal,
    epigrafe,
    epigrafeDescripcion,
    cuotaTributariaPct,
    totalAPagar,
    steps,
    warnings,
    meta: {
      region,
      regionLabel,
      vehicleType: inputs.vehicleType,
      isImported: imported,
      edadAnyos,
      ivaHistorico,
      impuestoMinoracion,
      porcentajeAReducir,
    },
  };
}

function buildExento(
  razon: string,
  inputs: IEDMTInputs,
  regionLabel: string,
  imported: boolean,
  valoracionInicial: number,
): IEDMTResult {
  return {
    exento: true,
    exentoRazon: razon,
    valoracionInicial,
    porcentajeDepreciacion: 100,
    minoracion: 0,
    baseImponible: valoracionInicial,
    reduccionBI: 0,
    baseImponibleFinal: valoracionInicial,
    epigrafe: 1,
    epigrafeDescripcion: razon,
    cuotaTributariaPct: 0,
    totalAPagar: 0,
    steps: [
      { label: 'Valoración inicial', value: `${fmtEUR(valoracionInicial)} €`, raw: valoracionInicial },
      { label: 'Situación', value: razon },
      { label: 'Cuota tributaria', value: '0%' },
      { label: 'Total a pagar', value: '0 €', highlight: true, raw: 0 },
    ],
    warnings: [],
    meta: {
      region: inputs.region,
      regionLabel,
      vehicleType: inputs.vehicleType,
      isImported: imported,
    },
  };
}

function parseFechaMatriculacion(input?: Date | string | null): Date | null {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
}
