// Designaciones de motor (320d, 1.6 TDI) con sus CV reales, extraídas del dataset
// EEA. La gente pide «un 320d» o «un Golf 1.6 TDI», no «150 CV» — este módulo
// convierte las filas crudas (nombre comercial + cilindrada + potencia +
// combustible) en la designación que reconoce el cliente, con los CV al lado.
//
// Dos estrategias, porque cada marca nombra distinto (verificado 2026-07-28):
//  · BMW / Mercedes: la designación ESTÁ en el nombre comercial («320D XDRIVE M
//    SPORT» → 320d; «C 220 D» → C 220 d). Se extrae del nombre.
//  · VW / Audi / Seat / Skoda y resto: el nombre es solo «GOLF» / «A3», así que la
//    designación se deriva de la cilindrada (redondeada a valores reales) + el
//    combustible → «1.6 TDI», «2.0 TSI».
//
// La cilindrada del dataset trae ruido (aparecían «1.9 TDI», «1.3 TDI» que no
// existen), así que se redondea a cilindradas canónicas y se exige un mínimo de
// registros por designación y por CV para tirar el ruido.

export interface DesignationRow {
  commercial_name: string | null;
  displacement_cc: number | null;
  power_kw: number | null;
  fuel_type: string | null;
}

export interface Designation {
  designation: string;   // «320d», «1.6 TDI»
  fuel: string;          // PETROL | DIESEL | HYBRID | ELECTRICITY
  cvs: number[];         // los CV reales de esa designación (asc)
}

const kw2cv = (kw: number) => Math.round(kw / 0.7355);
const CANON = [1.0, 1.2, 1.4, 1.5, 1.6, 1.8, 2.0, 2.2, 2.5, 3.0, 4.0];
const snap = (L: number) => CANON.reduce((a, b) => (Math.abs(b - L) < Math.abs(a - L) ? b : a));

const EEA_FUEL: Record<string, string> = {
  G: 'PETROL', D: 'DIESEL', Elc: 'ELECTRICITY', GyE: 'HYBRID', DyE: 'HYBRID',
};

const VAG = new Set(['volkswagen', 'seat', 'skoda', 'cupra']);

/** La designación de una fila, o null si no se puede determinar. */
function designationOf(makeNorm: string, r: DesignationRow): { desig: string; fuel: string } | null {
  const fuel = EEA_FUEL[r.fuel_type || ''] || null;
  if (!fuel || !r.power_kw) return null;
  const name = (r.commercial_name || '').toUpperCase();

  if (makeNorm.startsWith('bmw')) {
    // «320D XDRIVE» → 320d ; «320I» → 320i ; «330E» → 330e (híbrido)
    const m = name.match(/\b([1-8]\d\d)\s*([ID]|E)?/);
    if (!m) return null;
    const suffix = fuel === 'DIESEL' ? 'd' : fuel === 'HYBRID' ? 'e' : fuel === 'PETROL' ? 'i' : '';
    return { desig: m[1] + suffix, fuel };
  }

  if (makeNorm.startsWith('mercedes')) {
    // «C 220 D» → C 220 d ; «C 180» → C 180 ; «GLC 200 D» → GLC 200 d
    const m = name.match(/\b([A-Z]{1,3})\s?(\d{2,3})\s?(D|BLUETEC|CDI)?/);
    if (!m) return null;
    return { desig: `${m[1]} ${m[2]}${fuel === 'DIESEL' ? ' d' : ''}`, fuel };
  }

  // VAG + resto: derivar de cilindrada + combustible.
  if (!r.displacement_cc || r.displacement_cc < 800) return null;
  const L = snap(r.displacement_cc / 1000).toFixed(1);
  let suffix: string;
  if (makeNorm === 'audi') suffix = fuel === 'DIESEL' ? 'TDI' : fuel === 'PETROL' ? 'TFSI' : fuel === 'HYBRID' ? 'TFSI e' : fuel;
  else if (VAG.has(makeNorm)) suffix = fuel === 'DIESEL' ? 'TDI' : fuel === 'PETROL' ? 'TSI' : fuel === 'HYBRID' ? 'TSI e-Hybrid' : fuel;
  else suffix = fuel === 'DIESEL' ? 'Diésel' : fuel === 'PETROL' ? 'Gasolina' : fuel === 'HYBRID' ? 'Híbrido' : fuel === 'ELECTRICITY' ? 'Eléctrico' : fuel;
  return { desig: `${L} ${suffix}`, fuel };
}

/**
 * Agrupa filas crudas en designaciones con sus CV, tirando el ruido.
 * `minRows` por designación y una fracción por CV filtran las cilindradas sucias
 * (que generaban motores inexistentes como «1.9 TDI» en un Golf moderno).
 */
export function extractDesignations(makeNorm: string, rows: DesignationRow[], minRows = 8): Designation[] {
  const map = new Map<string, { fuel: string; cv: Map<number, number> }>();
  for (const r of rows) {
    const d = designationOf(makeNorm, r);
    if (!d) continue;
    const cv = kw2cv(r.power_kw as number);
    if (cv < 40 || cv > 700) continue;
    const e = map.get(d.desig) || { fuel: d.fuel, cv: new Map<number, number>() };
    e.cv.set(cv, (e.cv.get(cv) || 0) + 1);
    map.set(d.desig, e);
  }

  const out: Designation[] = [];
  for (const [designation, { fuel, cv }] of map) {
    const total = [...cv.values()].reduce((a, b) => a + b, 0);
    if (total < minRows) continue;
    const thresh = Math.max(2, total * 0.08);
    const cvs = [...cv.entries()].filter(([, n]) => n >= thresh).map(([c]) => c).sort((a, b) => a - b);
    if (!cvs.length) continue;
    out.push({ designation, fuel, cvs });
  }
  return out.sort((a, b) =>
    a.fuel.localeCompare(b.fuel) || a.designation.localeCompare(b.designation, 'es', { numeric: true }));
}

/**
 * El prefijo de nombre comercial con el que filtrar el dataset para un modelo.
 * BMW nombra por número de serie (el nombre es «320D», no «3 Series»), Mercedes
 * por letra+número («C 220 D»); el resto por el propio nombre del modelo.
 */
export function commercialPrefix(makeNorm: string, model: string): string {
  const m = model.trim();
  if (makeNorm.startsWith('bmw')) {
    const series = m.match(/^([1-8])\s*series/i) || m.match(/^([1-8])$/);
    if (series) return series[1]; // «3 Series» → «3» (casa 316, 318, 320…)
    return m; // X1, X3, i4…
  }
  if (makeNorm.startsWith('mercedes')) {
    const core = m.replace(/[-\s]?(class|klasse)$/i, '').trim();
    return `${core} `; // «C-Class» → «C » (casa «C 220», excluye CLA/CLS)
  }
  return m; // Golf, A3, Passat, Octavia…
}
