// Generaciones (chasis) por marca+modelo — FUENTE ÚNICA.
//
// Sustituye a las dos tablas que vivían duplicadas y desincronizadas:
//   - GENERATION_YEARS en src/app/api/analyze/route.ts (código → años, sin marca:
//     colisionaba, de ahí hacks como PB5/PB8 para no chocar con el Audi A4)
//   - RAW en src/lib/dealer/generations.ts (marca|modelo → años, CON solape)
// La primera decía A3 8P = 2004-2012 y la segunda 8P = 2003-2013. Las dos
// alimentaban búsquedas de comparables distintas para el mismo coche.
//
// PARA QUÉ SIRVE: acotar la búsqueda de comparables en coches.net al MISMO
// chasis. Sin esto, un ±1 año sobre un coche del año de cambio de generación
// mezcla dos coches distintos y el margen sale inventado.
//
// LOS RANGOS NO SE SOLAPAN. Donde dos generaciones comparten año de producción
// (E90 hasta 2011, F30 desde 2012) la vieja se queda el año de transición y la
// nueva empieza al siguiente. Es lo que permite que el ±1 año se recorte contra
// el rango y nunca cruce de generación.
// ÚNICA EXCEPCIÓN: dos filas SÍ pueden solaparse si sus `body` son disjuntos
// (Serie 3 E92 coupé vs F30 berlina). Ahí no hay ambigüedad porque la carrocería
// ya ha elegido rama antes de mirar los años.
//
// `to: null` = sigue en producción. Como mucho una fila por modelo.
//
// LOS AÑOS SON VENTANAS DE BÚSQUEDA, no años de producción exactos: valen para
// acotar coches.net, no para responder «¿qué años se fabricó?». Por eso el E89
// llega a 2018 (matriculaciones de stock) aunque dejara la cadena en 2016.
//
// scripts/check-generations.mjs valida todo lo anterior; ejecútalo tras tocar
// la tabla.

/** Carrocerías que hacen que una gama cambie de generación en fechas distintas. */
export type BodyBucket = 'coupe' | 'cabrio' | 'familiar' | 'berlina';

/**
 * Carrocería del anuncio → bucket. Devuelve null cuando no se puede afirmar, que
 * es lo correcto: sin certeza no se aplica ninguna fila específica de carrocería.
 *
 * El orden importa. mobile.de manda cadenas compuestas tipo
 * "Sportwagen/Coupé/Limousine", así que primero se descartan las señales fuertes
 * (coupé, cabrio) y solo al final se acepta berlina.
 */
export function bodyBucket(bodyType?: string | null): BodyBucket | null {
  if (!bodyType) return null;
  const b = bodyType.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/(cabrio|roadster|convertible|descapotable)/.test(b)) return 'cabrio';
  if (/(coupe|sportwagen)/.test(b)) return 'coupe';
  if (/(kombi|estate|wagon|touring|t-modell|familiar|avant|variant|sw\b)/.test(b)) return 'familiar';
  if (/(limousine|kompaktwagen|kleinwagen|sedan|saloon|hatchback|berlina|turismo)/.test(b)) return 'berlina';
  return null;
}

export interface Generation {
  /** Código de chasis o nombre que reconoce el cliente (E46, F30, Golf 7). */
  code: string;
  from: number;
  /** null = sigue en producción. */
  to: number | null;
  /**
   * Fecha REAL de salida al mercado (año + mes), cuando está verificada. Sirve
   * para desempatar el año frontera: un A3 de 03/2012 es 8P y uno de 11/2012 es
   * 8V, porque el 8V salió en 08/2012.
   *
   * OJO: NO es lo mismo que `from`. `from` es el primer año "limpio" que se usa
   * para acotar la búsqueda; el lanzamiento suele caer en el año ANTERIOR (el
   * Golf 7 se lanzó en 11/2012 pero su `from` es 2013). Por eso se guarda la
   * fecha completa y se compara año+mes: comparar solo el mes daría un Golf de
   * 02/2013 como Golf 6.
   *
   * SIN ESTE DATO NO SE INVENTA NADA — la generación se queda ambigua y se le
   * pregunta al usuario. Rellenar solo con fechas verificadas, con la fuente en
   * el comentario de la fila.
   */
  launch?: { year: number; month: number };
  /**
   * Carrocerías a las que aplica esta fila. Ausente = todas.
   *
   * Hace falta porque una misma gama cambia de generación en fechas DISTINTAS
   * según la carrocería: el BMW Serie 3 berlina pasó a F30 en 2012, pero el
   * coupé siguió siendo E92 hasta 2013 (el F32 ya se llamó Serie 4). Con una
   * sola fila por familia, un 325i coupé de 2012 salía fuera de su generación.
   *
   * Las filas con `body` solo se consideran cuando conocemos la carrocería del
   * coche; si no la sabemos se ignoran y queda la gama principal, que es el
   * comportamiento conservador de siempre.
   */
  body?: BodyBucket[];
}

export type GenerationConfidence = 'exact' | 'high' | 'medium' | 'low';
export type GenerationSource = 'user' | 'code' | 'month' | 'fingerprint' | 'year' | 'none';

export interface ResolvedGeneration {
  /** Código de la generación, o null si no se ha podido determinar. */
  code: string | null;
  /** Rango limpio de la generación (sin solape con las vecinas). */
  from: number;
  to: number | null;
  confidence: GenerationConfidence;
  source: GenerationSource;
  /**
   * true = el año cae justo en la frontera y no hemos podido desempatar.
   * Quien consuma esto NO debe emitir un margen confiado, y puede ofrecer al
   * usuario que confirme (ver `alternative`).
   */
  ambiguous: boolean;
  /** La otra candidata cuando `ambiguous` — para ofrecerla en la confirmación. */
  alternative: Generation | null;
}

// ============================================================
// NORMALIZACIÓN DE CLAVES
// El mismo coche llega con nombres distintos según la rama:
//   - /api/analyze pasa por mapModelToCoches() → nombres de coches.net
//     ("Serie 3", "Clase A", "GLC")
//   - el formulario dealer usa las etiquetas de mobile.de
//     ("3 Series", "A-Class", "GLC-Class")
// Las claves de la tabla están en forma coches.net; MODEL_ALIASES traduce el
// resto. Sin esto, la mitad de las búsquedas caerían al ±1 año pelado.
// ============================================================

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Marcas: variantes → forma canónica de la tabla. */
const MAKE_ALIASES: Record<string, string> = {
  vw: 'volkswagen',
  mercedes: 'mercedes benz',
  'mercedes benz': 'mercedes benz',
  'vauxhall': 'opel',
  // CUPRA nació como acabado de Seat y el León/Ateca comparten chasis y
  // generaciones. Sin esto, un "Cupra Leon" se quedaba sin generación: la
  // entrada de PERFORMANCE_BASE apuntaba a 'cupra|leon', que no existe.
  cupra: 'seat',
};

/**
 * Modelos: variantes → forma canónica. La clave incluye la marca porque "A3"
 * de Audi y un hipotético "A3" de otra marca no son el mismo modelo.
 */
const MODEL_ALIASES: Record<string, string> = {
  // BMW — mobile.de usa "3 Series", coches.net "Serie 3", alemán "3er"
  'bmw|1 series': 'serie 1', 'bmw|1er': 'serie 1',
  'bmw|2 series': 'serie 2', 'bmw|2er': 'serie 2',
  'bmw|3 series': 'serie 3', 'bmw|3er': 'serie 3',
  'bmw|4 series': 'serie 4', 'bmw|4er': 'serie 4',
  'bmw|5 series': 'serie 5', 'bmw|5er': 'serie 5',
  'bmw|6 series': 'serie 6', 'bmw|6er': 'serie 6',
  'bmw|7 series': 'serie 7', 'bmw|7er': 'serie 7',
  'bmw|8 series': 'serie 8', 'bmw|8er': 'serie 8',
  // Mercedes — mobile.de "A-Class", coches.net "Clase A"
  'mercedes benz|a class': 'clase a',
  'mercedes benz|b class': 'clase b',
  'mercedes benz|c class': 'clase c',
  'mercedes benz|e class': 'clase e',
  'mercedes benz|s class': 'clase s',
  'mercedes benz|g class': 'clase g',
  'mercedes benz|m class': 'clase m',
  'mercedes benz|v class': 'clase v',
  'mercedes benz|cla class': 'cla',
  'mercedes benz|cls class': 'cls',
  'mercedes benz|gla class': 'gla',
  'mercedes benz|glb class': 'glb',
  'mercedes benz|glc class': 'glc',
  'mercedes benz|gle class': 'gle',
  'mercedes benz|gls class': 'gls',
  'mercedes benz|glk class': 'clase glk',
  // Seat / Skoda / otros — acentos ya los quita norm()
  'seat|leon': 'leon',
  'skoda|octavia': 'octavia',
  'kia|ceed': 'ceed', "kia|cee d": 'ceed',
  // El cuestionario del dealer ofrece "840"/"850" como modelos sueltos (son las
  // etiquetas de mobile.de), no "8 Series".
  'bmw|840': 'serie 8', 'bmw|850': 'serie 8',
};

/**
 * Variantes deportivas que comparten chasis con el modelo base. Un S3 es un A3 y
 * un Golf R es un Golf: misma generación, mismos años. Sin esto cada acabado
 * parecería un modelo sin generación conocida.
 */
const PERFORMANCE_BASE: Record<string, string> = {
  'audi|s1': 'a1', 'audi|s3': 'a3', 'audi|rs3': 'a3', 'audi|s4': 'a4', 'audi|rs4': 'a4',
  'audi|s5': 'a5', 'audi|rs5': 'a5', 'audi|s6': 'a6', 'audi|rs6': 'a6', 'audi|s7': 'a7',
  'audi|rs7': 'a7',
  'audi|s8': 'a8', 'audi|sq5': 'q5', 'audi|rsq3': 'q3', 'audi|rs q3': 'q3', 'audi|sq7': 'q7',
  'audi|tts': 'tt', 'audi|ttrs': 'tt',
  'volkswagen|golf gti': 'golf', 'volkswagen|golf r': 'golf', 'volkswagen|golf gtd': 'golf',
  'seat|cupra leon': 'leon',
  // BMW M. /api/analyze NO las necesita —mapModelToCoches() ya convierte
  // "M135i"/"M3" en "Serie 1"/"Serie 3" antes de llegar aquí—, pero hay dos
  // ramas que llaman con el nombre SIN mapear:
  //   - el cuestionario del dealer, que manda las etiquetas de mobile.de tal cual
  //     ("M3", "M5", y los sub-modelos crudos van sin la i final: "M135", "M340")
  //   - watch-checker, que manda el texto de la IA ("M135i xDrive")
  // Con un solo token no entra ni el recorte de prefijos de lookupGenerations(),
  // así que sin estas filas la generación se apagaba en silencio.
  // OJO: "M1" NO está a propósito — es el deportivo de 1978, no un Serie 1.
  'bmw|m2': 'serie 2', 'bmw|m3': 'serie 3', 'bmw|m4': 'serie 4',
  'bmw|m5': 'serie 5', 'bmw|m6': 'serie 6', 'bmw|m8': 'serie 8',
  'bmw|m135': 'serie 1', 'bmw|m135i': 'serie 1', 'bmw|m140': 'serie 1', 'bmw|m140i': 'serie 1',
  'bmw|m235': 'serie 2', 'bmw|m235i': 'serie 2', 'bmw|m240': 'serie 2', 'bmw|m240i': 'serie 2',
  'bmw|m340': 'serie 3', 'bmw|m340i': 'serie 3', 'bmw|m340d': 'serie 3',
  'bmw|m440': 'serie 4', 'bmw|m440i': 'serie 4', 'bmw|m440d': 'serie 4',
  'bmw|m550': 'serie 5', 'bmw|m550i': 'serie 5', 'bmw|m550d': 'serie 5',
  'bmw|m760': 'serie 7', 'bmw|m760i': 'serie 7', 'bmw|m760li': 'serie 7',
  'bmw|m850': 'serie 8', 'bmw|m850i': 'serie 8',
  // Los X/Z M no hacen falta: "X3 M40i" son dos tokens y el recorte de prefijos
  // ya cae en "x3". Solo se listan los que llegan pegados.
  'bmw|x3m40i': 'x3', 'bmw|x4m40i': 'x4', 'bmw|x5m50d': 'x5', 'bmw|x6m50d': 'x6',
};

function canonicalKey(make: string, model: string): string {
  const mk0 = norm(make);
  const mk = MAKE_ALIASES[mk0] ?? mk0;
  const md0 = norm(model);
  const md = MODEL_ALIASES[`${mk}|${md0}`] ?? md0;
  return `${mk}|${md}`;
}

/**
 * Busca las generaciones de un modelo tolerando lo que venga pegado al nombre.
 *
 * Los títulos reales traen el acabado y hasta la generación dentro del propio
 * nombre: "Golf GTI Clubsport", "Golf VII GTI Performance", "A4 Avant 2.0 TDI",
 * "Q5 8R". Con búsqueda exacta, todos esos parecían modelos sin generación
 * conocida — medido sobre producción, el 58,8 % de los análisis fallaba aquí, y
 * la mayoría eran Golf. No faltaban filas en la tabla: faltaba recortar el
 * nombre.
 *
 * Se prueba el nombre entero y se le va quitando la última palabra hasta dar con
 * una fila. El prefijo MÁS LARGO gana, así que un "Serie 3 Gran Turismo" cae en
 * "Serie 3" y nunca en algo más corto y equivocado.
 */
function lookupGenerations(make: string, model: string): Generation[] {
  const key = canonicalKey(make, model);
  const direct = GENERATIONS[key];
  if (direct) return direct;

  const [mk, md] = key.split('|');
  const perf = PERFORMANCE_BASE[key] ?? PERFORMANCE_BASE[`${mk}|${md.replace(/\s+/g, '')}`];
  if (perf && GENERATIONS[`${mk}|${perf}`]) return GENERATIONS[`${mk}|${perf}`];

  const tokens = md.split(' ').filter(Boolean);
  for (let n = tokens.length - 1; n >= 1; n--) {
    const prefix = tokens.slice(0, n).join(' ');
    const aliased = MODEL_ALIASES[`${mk}|${prefix}`] ?? prefix;
    const base = PERFORMANCE_BASE[`${mk}|${aliased}`] ?? aliased;
    const hit = GENERATIONS[`${mk}|${base}`];
    if (hit) return hit;
  }
  return [];
}

// ============================================================
// TABLA
// Ordenadas de la más NUEVA a la más ANTIGUA.
// Las claves ya están en forma canónica (= lo que devuelve canonicalKey()).
// Cobertura: los modelos que de verdad se importan. Un modelo que no esté aquí
// cae al ±1 año de siempre — no se rompe nada, solo no se afina.
// ============================================================

const GENERATIONS: Record<string, Generation[]> = {
  // ── BMW ───────────────────────────────────────────────────────────────────
  // Mismo caso que el Serie 3: el coupé (E82) y el cabrio (E88) NO cambiaron de
  // generación con el hatch. Siguieron hasta 2013, y su sucesor ya se llamó
  // Serie 2 (F22). Sin las filas con `body`, un 135i Coupé de 2012-2013 salía
  // F20/F21 con confidence 'high' y ambiguous:false — mal, y en silencio.
  'bmw|serie 1': [
    { code: 'F70', from: 2024, to: null },
    { code: 'F40', from: 2020, to: 2023 },
    { code: 'F20/F21', from: 2012, to: 2019, body: ['berlina', 'familiar'] },
    { code: 'E82/E88', from: 2007, to: 2013, body: ['coupe', 'cabrio'] },
    { code: 'E81/E87', from: 2004, to: 2011, body: ['berlina', 'familiar'] },
  ],
  'bmw|serie 2': [
    // G42 (coupé) y U06 (Active Tourer) son la misma hornada de 2022; se listan
    // juntos porque coches.net los vende bajo el mismo "Serie 2".
    { code: 'G42/U06', from: 2022, to: null },
    { code: 'F22/F23/F45', from: 2014, to: 2021 },
  ],
  // OJO con el coupé: la berlina pasó a F30 en 2012, pero el coupé/cabrio siguió
  // siendo E92/E93 hasta 2013 — el sucesor ya se llamó Serie 4 (F32, 2014). En
  // coches.net el coupé sigue viviendo bajo "Serie 3", así que las dos ramas
  // comparten ModelId y solo las separa la carrocería (y el filtro de puertas).
  'bmw|serie 3': [
    { code: 'G20/G21', from: 2019, to: null },
    // Primeras entregas 11/02/2012 (de.wikipedia.org/wiki/BMW_F30).
    { code: 'F30/F31', from: 2012, to: 2018, launch: { year: 2012, month: 2 }, body: ['berlina', 'familiar'] },
    { code: 'E92/E93', from: 2007, to: 2013, body: ['coupe', 'cabrio'] },
    { code: 'E90/E91', from: 2006, to: 2011, body: ['berlina', 'familiar'] },
    { code: 'E46', from: 1998, to: 2005 },
    { code: 'E36', from: 1990, to: 1997 },
    { code: 'E30', from: 1982, to: 1989 },
  ],
  'bmw|serie 4': [
    { code: 'G22/G23', from: 2021, to: null },
    { code: 'F32/F33/F36', from: 2013, to: 2020 },
  ],
  'bmw|serie 5': [
    { code: 'G60', from: 2024, to: null },
    { code: 'G30/G31', from: 2017, to: 2023 },
    { code: 'F10/F11', from: 2010, to: 2016 },
    { code: 'E60/E61', from: 2003, to: 2009 },
    { code: 'E39', from: 1995, to: 2002 },
    { code: 'E34', from: 1988, to: 1994 },
  ],
  // El Serie 6 no estaba en ninguna de las dos tablas viejas y sí aparece en
  // producción (630i Gran Turismo sin generación) y en el cuestionario ("6
  // Series", "M6"). Discontinuado en 2023: ninguna fila abierta.
  'bmw|serie 6': [
    { code: 'G32', from: 2018, to: 2023 },
    { code: 'F06/F12/F13', from: 2011, to: 2017 },
    { code: 'E63/E64', from: 2004, to: 2010 },
  ],
  'bmw|serie 7': [
    { code: 'G70', from: 2023, to: null },
    { code: 'G11/G12', from: 2015, to: 2022 },
    { code: 'F01/F02', from: 2008, to: 2014 },
    { code: 'E65/E66', from: 2001, to: 2007 },
  ],
  // Hueco real 2000-2017: el Serie 8 se dejó de fabricar en 1999 y no volvió
  // hasta el G15 (a la venta 11/2018). No es un fallo de la tabla.
  'bmw|serie 8': [
    { code: 'G14/G15/G16', from: 2018, to: null },
    { code: 'E31', from: 1990, to: 1999 },
  ],
  'bmw|x1': [
    { code: 'U11', from: 2023, to: null },
    { code: 'F48', from: 2015, to: 2022 },
    { code: 'E84', from: 2009, to: 2014 },
  ],
  'bmw|x2': [
    { code: 'U10', from: 2024, to: null },
    { code: 'F39', from: 2018, to: 2023 },
  ],
  'bmw|x3': [
    { code: 'G45', from: 2024, to: null },
    { code: 'G01', from: 2017, to: 2023 },
    { code: 'F25', from: 2011, to: 2016 },
    { code: 'E83', from: 2003, to: 2010 },
  ],
  'bmw|x4': [
    { code: 'G02', from: 2018, to: null },
    { code: 'F26', from: 2014, to: 2017 },
  ],
  'bmw|x5': [
    { code: 'G05', from: 2019, to: null },
    { code: 'F15', from: 2014, to: 2018 },
    { code: 'E70', from: 2007, to: 2013 },
    { code: 'E53', from: 1999, to: 2006 },
  ],
  'bmw|x6': [
    { code: 'G06', from: 2020, to: null },
    { code: 'F16', from: 2015, to: 2019 },
    { code: 'E71', from: 2008, to: 2014 },
  ],
  // El E89 dejó de fabricarse en 2016 y el G29 no llegó hasta 2019, así que
  // 2017-2018 se quedaba sin ninguna generación (venía así de la tabla vieja) y
  // un Z4 de esos años caía al ±1 año pelado. Un Z4 matriculado en 2017-2018 ES
  // un E89 de stock, así que el rango de BÚSQUEDA del E89 llega hasta 2018.
  'bmw|z4': [
    { code: 'G29', from: 2019, to: null },
    { code: 'E89', from: 2009, to: 2018 },
    { code: 'E85/E86', from: 2002, to: 2008 },
  ],

  // ── Volkswagen ────────────────────────────────────────────────────────────
  'volkswagen|golf': [
    { code: 'Golf 8', from: 2020, to: null },
    // En concesionarios el 10/11/2012 — dos meses ANTES de su `from` de 2013,
    // que es justo por lo que la fecha de lanzamiento lleva año además de mes
    // (autobild.de "VW Golf VII (2013): Marktstart am 10. November 2012").
    { code: 'Golf 7', from: 2013, to: 2019, launch: { year: 2012, month: 11 } },
    { code: 'Golf 6', from: 2009, to: 2012 },
    { code: 'Golf 5', from: 2004, to: 2008 },
    { code: 'Golf 4', from: 1997, to: 2003 },
    { code: 'Golf 3', from: 1992, to: 1996 },
    { code: 'Golf 2', from: 1983, to: 1991 },
  ],
  'volkswagen|polo': [
    { code: 'Polo 6 (AW)', from: 2018, to: null },
    { code: 'Polo 5 (6R/6C)', from: 2010, to: 2017 },
    { code: 'Polo 4 (9N)', from: 2002, to: 2009 },
    { code: 'Polo 3 (6N)', from: 1994, to: 2001 },
  ],
  'volkswagen|passat': [
    { code: 'B9', from: 2024, to: null },
    { code: 'B8', from: 2015, to: 2023 },
    { code: 'B7', from: 2011, to: 2014 },
    { code: 'B6', from: 2005, to: 2010 },
    { code: 'B5', from: 1996, to: 2004 },
  ],
  'volkswagen|tiguan': [
    { code: 'Tiguan 3', from: 2024, to: null },
    { code: 'Tiguan 2 (AD)', from: 2016, to: 2023 },
    { code: 'Tiguan 1 (5N)', from: 2007, to: 2015 },
  ],
  'volkswagen|touran': [
    { code: 'Touran 2 (5T)', from: 2015, to: null },
    { code: 'Touran 1 (1T)', from: 2003, to: 2014 },
  ],
  'volkswagen|t roc': [{ code: 'T-Roc (A1)', from: 2017, to: null }],
  'volkswagen|t cross': [{ code: 'T-Cross', from: 2019, to: null }],

  // ── Audi ──────────────────────────────────────────────────────────────────
  'audi|a1': [
    { code: 'GB', from: 2019, to: null },
    { code: '8X', from: 2010, to: 2018 },
  ],
  'audi|a3': [
    { code: '8Y', from: 2021, to: null },
    // 3 puertas al mercado el 24/08/2012; Sportback 15/02/2013
    // (de.wikipedia.org/wiki/Audi_A3_8V). Es EL caso frontera clásico.
    { code: '8V', from: 2013, to: 2020, launch: { year: 2012, month: 8 } },
    { code: '8P', from: 2004, to: 2012 },
    { code: '8L', from: 1996, to: 2003 },
  ],
  'audi|a4': [
    // Limousine y Avant al mercado en 11/2015 (de.wikipedia.org/wiki/Audi_A4_B9).
    { code: 'B9', from: 2016, to: null, launch: { year: 2015, month: 11 } },
    { code: 'B8', from: 2008, to: 2015 },
    { code: 'B7', from: 2005, to: 2007 },
    { code: 'B6', from: 2001, to: 2004 },
    { code: 'B5', from: 1994, to: 2000 },
  ],
  'audi|a5': [
    { code: 'F5', from: 2016, to: null },
    { code: '8T', from: 2007, to: 2015 },
  ],
  'audi|a6': [
    { code: 'C8', from: 2019, to: null },
    { code: 'C7', from: 2012, to: 2018 },
    { code: 'C6', from: 2005, to: 2011 },
    { code: 'C5', from: 1997, to: 2004 },
  ],
  'audi|a7': [
    { code: '4K', from: 2018, to: null },
    { code: '4G', from: 2010, to: 2017 },
  ],
  'audi|a8': [
    { code: 'D5', from: 2018, to: null },
    { code: 'D4', from: 2011, to: 2017 },
    { code: 'D3', from: 2003, to: 2010 },
    { code: 'D2', from: 1994, to: 2002 },
  ],
  'audi|q2': [{ code: 'GA', from: 2016, to: null }],
  'audi|q3': [
    { code: 'F3', from: 2018, to: null },
    { code: '8U', from: 2011, to: 2017 },
  ],
  'audi|q5': [
    { code: 'FY', from: 2017, to: null },
    { code: '8R', from: 2008, to: 2016 },
  ],
  'audi|q7': [
    { code: '4M', from: 2015, to: null },
    { code: '4L', from: 2005, to: 2014 },
  ],
  'audi|tt': [
    { code: '8S', from: 2014, to: null },
    { code: '8J', from: 2006, to: 2013 },
    { code: '8N', from: 1998, to: 2005 },
  ],

  // ── Mercedes-Benz ─────────────────────────────────────────────────────────
  'mercedes benz|clase a': [
    { code: 'W177', from: 2019, to: null },
    { code: 'W176', from: 2013, to: 2018 },
    { code: 'W169', from: 2005, to: 2012 },
    { code: 'W168', from: 1997, to: 2004 },
  ],
  'mercedes benz|clase b': [
    { code: 'W247', from: 2019, to: null },
    { code: 'W246', from: 2012, to: 2018 },
    { code: 'W245', from: 2005, to: 2011 },
  ],
  // Coupé/cabrio otra vez con calendario propio: el C204 (coupé, desde 2011)
  // convivió con la berlina W205 hasta 2015, y el C205 coupé/cabrio siguió
  // vendiéndose hasta 2023 con el W206 berlina ya en la calle desde 2021.
  // Hueco conocido en el bucket coupé: 2008-2011 (antes del C204 el coupé
  // compacto era el CLC, que es otro modelo en coches.net).
  'mercedes benz|clase c': [
    { code: 'W206', from: 2022, to: null, body: ['berlina', 'familiar'] },
    { code: 'C205', from: 2016, to: 2023, body: ['coupe', 'cabrio'] },
    // Estreno en concesionario 15/03/2014; el W204 siguió fabricándose hasta
    // 04/2014 en Sindelfingen — solape real, de ahí que el mes importe
    // (de.wikipedia.org/wiki/Mercedes-Benz_Baureihe_205).
    { code: 'W205', from: 2015, to: 2021, launch: { year: 2014, month: 3 }, body: ['berlina', 'familiar'] },
    { code: 'C204', from: 2011, to: 2015, body: ['coupe', 'cabrio'] },
    { code: 'W204', from: 2008, to: 2014, body: ['berlina', 'familiar'] },
    { code: 'W203', from: 2001, to: 2007 },
    { code: 'W202', from: 1993, to: 2000 },
  ],
  // Igual que la Clase C: el coupé/cabrio C207 aguantó hasta 2017 con el W213
  // berlina ya presentado, y el C238 arrancó en 2018.
  'mercedes benz|clase e': [
    { code: 'W214', from: 2024, to: null },
    { code: 'C238', from: 2018, to: 2023, body: ['coupe', 'cabrio'] },
    { code: 'W213', from: 2017, to: 2023, body: ['berlina', 'familiar'] },
    { code: 'C207', from: 2010, to: 2017, body: ['coupe', 'cabrio'] },
    { code: 'W212', from: 2010, to: 2016, body: ['berlina', 'familiar'] },
    { code: 'W211', from: 2003, to: 2009 },
    { code: 'W210', from: 1995, to: 2002 },
    { code: 'W124', from: 1985, to: 1994 },
  ],
  'mercedes benz|clase s': [
    { code: 'W223', from: 2021, to: null },
    { code: 'W222', from: 2014, to: 2020 },
    { code: 'W221', from: 2006, to: 2013 },
    { code: 'W220', from: 1998, to: 2005 },
  ],
  // La Clase M (ML) desapareció del consolidado y su alias 'm class' apuntaba a
  // una clave inexistente. El W166 se renombró GLE en 2015: aquí solo llega
  // hasta 2015 y de ahí en adelante vive en 'mercedes benz|gle'.
  'mercedes benz|clase m': [
    { code: 'W166', from: 2012, to: 2015 },
    { code: 'W164', from: 2006, to: 2011 },
    { code: 'W163', from: 1998, to: 2005 },
  ],
  'mercedes benz|cla': [
    { code: 'C118', from: 2019, to: null },
    { code: 'C117', from: 2013, to: 2018 },
  ],
  'mercedes benz|cls': [
    { code: 'C257', from: 2018, to: null },
    { code: 'C218', from: 2011, to: 2017 },
  ],
  'mercedes benz|gla': [
    { code: 'H247', from: 2020, to: null },
    { code: 'X156', from: 2014, to: 2019 },
  ],
  'mercedes benz|glc': [
    { code: 'X254', from: 2022, to: null },
    { code: 'X253', from: 2015, to: 2021 },
  ],
  'mercedes benz|gle': [
    { code: 'W167', from: 2019, to: null },
    { code: 'W166', from: 2015, to: 2018 },
  ],
  'mercedes benz|gls': [
    { code: 'X167', from: 2020, to: null },
    { code: 'X166', from: 2016, to: 2019 },
  ],
  'mercedes benz|clase g': [
    { code: 'W463 II', from: 2018, to: null },
    { code: 'W463', from: 1990, to: 2017 },
  ],

  // ── Seat / Cupra ──────────────────────────────────────────────────────────
  'seat|leon': [
    { code: 'Leon 4 (KL)', from: 2021, to: null },
    // En concesionarios el 24/11/2012 (de.wikipedia.org/wiki/Seat_Leon_III).
    { code: 'Leon 3 (5F)', from: 2013, to: 2020, launch: { year: 2012, month: 11 } },
    { code: 'Leon 2 (1P)', from: 2006, to: 2012 },
    { code: 'Leon 1 (1M)', from: 1999, to: 2005 },
  ],
  'seat|ibiza': [
    { code: 'Ibiza 5 (KJ)', from: 2018, to: null },
    { code: 'Ibiza 4 (6J/6P)', from: 2009, to: 2017 },
    { code: 'Ibiza 3 (6L)', from: 2002, to: 2008 },
  ],
  'seat|ateca': [{ code: 'Ateca', from: 2016, to: null }],
  'seat|arona': [{ code: 'Arona', from: 2017, to: null }],

  // ── Skoda ─────────────────────────────────────────────────────────────────
  'skoda|octavia': [
    { code: 'Octavia 4 (NX)', from: 2021, to: null },
    // Berlina desde mediados de 02/2013; Combi 25/05/2013
    // (de.wikipedia.org/wiki/Škoda_Octavia_III).
    { code: 'Octavia 3 (5E)', from: 2014, to: 2020, launch: { year: 2013, month: 2 } },
    { code: 'Octavia 2 (1Z)', from: 2005, to: 2013 },
    { code: 'Octavia 1 (1U)', from: 1996, to: 2004 },
  ],
  'skoda|fabia': [
    { code: 'Fabia 4', from: 2022, to: null },
    { code: 'Fabia 3 (NJ)', from: 2015, to: 2021 },
    { code: 'Fabia 2 (5J)', from: 2007, to: 2014 },
  ],
  'skoda|superb': [
    { code: 'Superb 3 (3V)', from: 2015, to: null },
    { code: 'Superb 2 (3T)', from: 2008, to: 2014 },
    { code: 'Superb 1 (3U)', from: 2001, to: 2007 },
  ],
  'skoda|karoq': [{ code: 'Karoq', from: 2017, to: null }],
  'skoda|kodiaq': [{ code: 'Kodiaq', from: 2017, to: null }],

  // ── Porsche ───────────────────────────────────────────────────────────────
  'porsche|911': [
    { code: '992', from: 2020, to: null },
    { code: '991', from: 2012, to: 2019 },
    { code: '997', from: 2005, to: 2011 },
    { code: '996', from: 1998, to: 2004 },
  ],
  // Boxster y Cayman desaparecieron enteros del consolidado. mapPorscheModel()
  // los separa en tres modelos distintos ("Boxster", "Cayman", "718"), que es
  // como los tiene coches.net, así que van en tres claves.
  'porsche|boxster': [
    { code: '981', from: 2013, to: 2016 },
    { code: '987', from: 2005, to: 2012 },
    { code: '986', from: 1996, to: 2004 },
  ],
  'porsche|cayman': [
    { code: '981C', from: 2013, to: 2016 },
    { code: '987C', from: 2006, to: 2012 },
  ],
  // El 718 (982) sustituyó a Boxster y Cayman en 2016 y es un modelo propio.
  'porsche|718': [{ code: '982', from: 2016, to: null }],
  'porsche|cayenne': [
    { code: '9YA', from: 2018, to: null },
    { code: '92A', from: 2011, to: 2017 },
    { code: '9PA', from: 2002, to: 2010 },
  ],
  'porsche|macan': [{ code: '95B', from: 2014, to: null }],
  'porsche|panamera': [
    { code: '971', from: 2017, to: null },
    { code: '970', from: 2009, to: 2016 },
  ],

  // ── Resto de habituales ───────────────────────────────────────────────────
  'ford|focus': [
    { code: 'Focus 4', from: 2018, to: null },
    { code: 'Focus 3', from: 2011, to: 2017 },
    { code: 'Focus 2', from: 2005, to: 2010 },
    { code: 'Focus 1', from: 1998, to: 2004 },
  ],
  'ford|fiesta': [
    { code: 'Fiesta 7', from: 2017, to: null },
    { code: 'Fiesta 6', from: 2009, to: 2016 },
    { code: 'Fiesta 5', from: 2002, to: 2008 },
  ],
  'ford|kuga': [
    { code: 'Kuga 3', from: 2020, to: null },
    { code: 'Kuga 2', from: 2013, to: 2019 },
    { code: 'Kuga 1', from: 2008, to: 2012 },
  ],
  'ford|mondeo': [
    { code: 'Mondeo 5', from: 2015, to: null },
    { code: 'Mondeo 4', from: 2007, to: 2014 },
    { code: 'Mondeo 3', from: 2000, to: 2006 },
  ],
  'opel|astra': [
    { code: 'Astra L', from: 2022, to: null },
    { code: 'Astra K', from: 2016, to: 2021 },
    { code: 'Astra J', from: 2010, to: 2015 },
    { code: 'Astra H', from: 2004, to: 2009 },
    { code: 'Astra G', from: 1998, to: 2003 },
  ],
  'opel|corsa': [
    { code: 'Corsa F', from: 2020, to: null },
    { code: 'Corsa E', from: 2015, to: 2019 },
    { code: 'Corsa D', from: 2007, to: 2014 },
    { code: 'Corsa C', from: 2000, to: 2006 },
  ],
  'opel|insignia': [
    { code: 'Insignia B', from: 2017, to: null },
    { code: 'Insignia A', from: 2008, to: 2016 },
  ],
  'renault|megane': [
    { code: 'Megane 4', from: 2016, to: null },
    { code: 'Megane 3', from: 2009, to: 2015 },
    { code: 'Megane 2', from: 2002, to: 2008 },
  ],
  'renault|clio': [
    { code: 'Clio 5', from: 2020, to: null },
    { code: 'Clio 4', from: 2013, to: 2019 },
    { code: 'Clio 3', from: 2005, to: 2012 },
  ],
  'volvo|xc60': [
    { code: 'XC60 II', from: 2018, to: null },
    { code: 'XC60 I', from: 2008, to: 2017 },
  ],
  'volvo|xc90': [
    { code: 'XC90 II', from: 2015, to: null },
    { code: 'XC90 I', from: 2002, to: 2014 },
  ],
  'volvo|v60': [
    { code: 'V60 II', from: 2018, to: null },
    { code: 'V60 I', from: 2010, to: 2017 },
  ],
  'hyundai|tucson': [
    { code: 'NX4', from: 2021, to: null },
    { code: 'TL', from: 2016, to: 2020 },
    { code: 'ix35', from: 2010, to: 2015 },
    { code: 'JM', from: 2004, to: 2009 },
  ],
  'hyundai|i30': [
    { code: 'PD', from: 2017, to: null },
    { code: 'GD', from: 2012, to: 2016 },
    { code: 'FD', from: 2007, to: 2011 },
  ],
  'kia|sportage': [
    { code: 'NQ5', from: 2022, to: null },
    { code: 'QL', from: 2016, to: 2021 },
    { code: 'SL', from: 2010, to: 2015 },
    { code: 'JE', from: 2004, to: 2009 },
  ],
  'kia|ceed': [
    { code: 'CD', from: 2019, to: null },
    { code: 'JD', from: 2013, to: 2018 },
    { code: 'ED', from: 2006, to: 2012 },
  ],
  'toyota|rav4': [
    { code: 'XA50', from: 2019, to: null },
    { code: 'XA40', from: 2013, to: 2018 },
    { code: 'XA30', from: 2005, to: 2012 },
  ],
  'toyota|corolla': [
    { code: 'E210', from: 2019, to: null },
    { code: 'E150/E180', from: 2007, to: 2018 },
    { code: 'E120', from: 2001, to: 2006 },
  ],
  'nissan|qashqai': [
    { code: 'J12', from: 2022, to: null },
    { code: 'J11', from: 2014, to: 2021 },
    { code: 'J10', from: 2007, to: 2013 },
  ],
};

/**
 * Código de chasis de mobile.de (`modelRange`) → clave de generación.
 * mobile.de manda el código suelto sin marca ("F30", "8V"), así que buscamos el
 * código dentro del modelo que YA hemos identificado — nunca globalmente. Es lo
 * que evita la colisión que obligaba a inventar claves como PB5/PB8 (el B8 es a
 * la vez Passat y Audi A4).
 */
function matchByCode(gens: Generation[], code: string): Generation | null {
  const c = norm(code).replace(/\s/g, '');
  if (!c) return null;
  for (const g of gens) {
    // `code` de la tabla puede ser compuesto ("F30/F31", "E90/E91/E92")
    const parts = g.code.split('/').map((p) => norm(p).replace(/\s/g, ''));
    if (parts.includes(c)) return g;
    // "Golf 7" ↔ "Mk7" / "VII"
    const mk = c.match(/^mk(\d+)$/);
    if (mk && parts.some((p) => p.endsWith(mk[1]))) return g;
  }
  return null;
}

// ============================================================
// API
// ============================================================

/**
 * Generaciones curadas de un modelo, o [] si no lo tenemos.
 *
 * `bodyType` selecciona la rama correcta cuando una gama cambia de generación en
 * fechas distintas según la carrocería (Serie 3 berlina vs coupé). Si no se
 * conoce la carrocería se asume BERLINA, que deja exactamente la gama principal
 * — el comportamiento de siempre. Solo nos desviamos cuando sabemos con certeza
 * que es un coupé o un cabrio.
 */
export function generationsFor(
  make?: string | null,
  model?: string | null,
  bodyType?: string | null,
): Generation[] {
  if (!make || !model) return [];
  const all = lookupGenerations(make, model);
  if (!all.some((g) => g.body)) return all;
  const bucket = bodyBucket(bodyType) ?? 'berlina';
  return all.filter((g) => !g.body || g.body.includes(bucket));
}

/** Etiqueta con su rango de años (para chips de UI). */
export function generationLabel(g: Generation): string {
  return `${g.code} · ${g.to ? `${g.from}–${g.to}` : `${g.from}+`}`;
}

export interface ResolveInput {
  make?: string | null;
  model?: string | null;
  /** Año de matriculación. */
  year?: number | null;
  /** Mes de matriculación (1-12). Desempata el año frontera. */
  month?: number | null;
  /** Código de chasis del anuncio (mobile.de `modelRange`). Máxima autoridad. */
  code?: string | null;
  /** Generación confirmada por el usuario. Gana a todo lo demás. */
  userConfirmed?: string | null;
  /**
   * Carrocería del anuncio. Elige la rama correcta cuando la gama cambia de
   * generación en fechas distintas según carrocería (Serie 3 berlina vs coupé).
   */
  bodyType?: string | null;
}

/**
 * Determina la generación con una cascada de fuentes, de más a menos fiable:
 *   1. confirmación del usuario / elección del dealer en el cuestionario → exact
 *   2. código de chasis del anuncio (mobile.de `modelRange`)              → exact
 *   3. año + mes de matriculación, si la tabla tiene `startMonth`         → high
 *   4. año a secas                                       → high, o medium/low si
 *      cae en el año frontera entre dos generaciones
 *
 * NUNCA fuerza una elección en caso de duda: devuelve `ambiguous: true` con la
 * candidata alternativa para que quien llame ofrezca confirmarla, y mientras
 * tanto searchYearWindow() se queda dentro de una sola generación.
 */
export function resolveGeneration(input: ResolveInput): ResolvedGeneration {
  const gens = generationsFor(input.make, input.model, input.bodyType);
  const year = Number(input.year) || 0;

  const none: ResolvedGeneration = {
    code: null, from: 0, to: null,
    confidence: 'low', source: 'none', ambiguous: false, alternative: null,
  };
  if (!gens.length) return none;

  const asResolved = (
    g: Generation,
    confidence: GenerationConfidence,
    source: GenerationSource,
    ambiguous = false,
    alternative: Generation | null = null,
  ): ResolvedGeneration => ({
    code: g.code, from: g.from, to: g.to, confidence, source, ambiguous, alternative,
  });

  // 1. Confirmada por el usuario (o elegida en el cuestionario del dealer).
  if (input.userConfirmed) {
    const g = matchByCode(gens, input.userConfirmed);
    if (g) return asResolved(g, 'exact', 'user');
  }

  // 2. Código de chasis del anuncio.
  if (input.code) {
    const g = matchByCode(gens, input.code);
    if (g) return asResolved(g, 'exact', 'code');
  }

  if (!year) return none;

  // 3/4. Por año. La tabla no se solapa, así que como mucho una generación
  // contiene el año — pero el año FRONTERA (el último de una o el primero de la
  // siguiente) puede llevar stock residual de la vecina.
  const inRange = gens.find((g) => year >= g.from && year <= (g.to ?? 9999));
  if (!inRange) return none;

  const prev = gens.find((g) => (g.to ?? 9999) === inRange.from - 1);
  const next = gens.find((g) => g.from === (inRange.to ?? -1) + 1);

  // ¿Es el año de transición? Sí si es el primero de esta generación (puede
  // haber matriculaciones tardías de la anterior) o el último (matriculaciones
  // adelantadas de la siguiente).
  const atStart = year === inRange.from && !!prev;
  const atEnd = inRange.to != null && year === inRange.to && !!next;
  if (!atStart && !atEnd) return asResolved(inRange, 'high', 'year');

  const neighbour = atStart ? prev! : next!;
  // De las dos candidatas, cuál es la NUEVA y cuál la vieja.
  const newer = atStart ? inRange : neighbour;
  const older = atStart ? neighbour : inRange;

  // La fecha de matriculación desempata, si tenemos la de lanzamiento verificada
  // de la generación nueva. Se comparan año+mes juntos (no solo el mes): el
  // lanzamiento cae a menudo en el año anterior al `from`, así que comparar meses
  // sueltos daría un Golf de 02/2013 como Golf 6.
  const month = Number(input.month) || 0;
  if (month >= 1 && month <= 12 && newer.launch) {
    const carMonths = year * 12 + month;
    const launchMonths = newer.launch.year * 12 + newer.launch.month;
    return asResolved(carMonths >= launchMonths ? newer : older, 'high', 'month');
  }

  // Sin mes útil: nos quedamos con la que dice la tabla, pero marcada como
  // ambigua. searchYearWindow() NO quita el año frontera —quitarlo dejaría al
  // coche comparándose solo contra años posteriores y más caros—, pero sí acota
  // la ventana dentro de esta generación; y quien llame puede pedir
  // confirmación al usuario (ver /api/analyses/[id]/confirm-generation).
  return asResolved(inRange, 'medium', 'year', true, neighbour);
}

/**
 * Ventana de años para buscar comparables en coches.net.
 *
 * Base ±1 año, RECORTADA contra el rango de la generación: nunca cruza a la
 * vecina. Un coche de 2011 cuya generación empieza en 2011 busca 2011–2012, no
 * 2010–2012, porque 2010 son coches de la generación anterior y meterlos falsea
 * la mediana.
 *
 * Cuando la generación es ambigua (año frontera sin mes que desempate) se
 * ELIMINA además el propio año frontera de la ventana si eso deja algo con lo
 * que buscar — mejor buscar solo el lado limpio que arriesgar la mezcla.
 * Si al recortar no queda ventana, se cae al ±1 año pelado.
 *
 * Ensanchar años DENTRO de la generación es el primer escalón sensato si la
 * muestra sale corta: distorsiona menos que soltar el filtro de cambio o de
 * puertas (ver la cascada de index.js).
 */
export function searchYearWindow(
  resolved: ResolvedGeneration,
  year: number,
): { minYear: number; maxYear: number } {
  // El suelo de 1990 lo pone coches.net (no lista nada anterior). Aplicándolo
  // solo al extremo bajo, un coche de antes de 1991 salía con la ventana dada la
  // vuelta (minYear 1990 > maxYear 1989) y el scraper buscaba en nada; por eso el
  // extremo alto sube con él.
  const floored = (lo: number, hi: number) => {
    const minYear = Math.max(lo, 1990);
    return { minYear, maxYear: Math.max(hi, minYear) };
  };
  const fallback = floored(year - 1, year + 1);
  if (!year || !resolved.code || !resolved.from) return fallback;

  const genFrom = resolved.from;
  const genTo = resolved.to ?? 9999;

  // El año del coche puede caer FUERA del rango de su propia generación, y es
  // legítimo: los primeros ejemplares se matriculan en el año del lanzamiento,
  // que suele ser anterior al primer año "limpio". Un A3 de 11/2012 es un 8V
  // aunque el 8V arranque en 2013, y un Serie 3 de 01/2012 es un E90 aunque el
  // E90 acabe en 2011. En esos casos NO se puede buscar por el año del coche
  // —2012 en coches.net es casi todo 8P— así que se ancla dentro de la
  // generación: los comparables buenos son los 8V de 2013.
  const anchor = Math.min(Math.max(year, genFrom), genTo);
  // Más de un año de desfase no es stock de lanzamiento, es un dato malo.
  if (Math.abs(anchor - year) > 1) return fallback;

  let lo = Math.max(anchor - 1, genFrom);
  let hi = Math.min(anchor + 1, genTo);

  // El año del propio coche NO se excluye nunca, ni siquiera si es el de
  // transición. Quitarlo dejaría al coche comparándose solo contra años
  // posteriores —más caros—, que infla el precio de mercado y con él el margen.
  // Ese es el error peligroso; dejar algo de stock residual de la generación
  // vecina en su propio año es el error barato.
  //
  // Ensanchar hasta 2 años SIEMPRE dentro de la generación: con un solo año la
  // muestra se queda en nada y el margen pasa a depender de 2-3 anuncios.
  const MIN_SPAN = 2;
  let span = hi - lo + 1;
  if (span < MIN_SPAN && hi < genTo) {
    hi = Math.min(hi + (MIN_SPAN - span), genTo);
    span = hi - lo + 1;
  }
  if (span < MIN_SPAN && lo > genFrom) {
    lo = Math.max(lo - (MIN_SPAN - span), genFrom);
  }

  if (lo > hi) return fallback;
  return floored(lo, hi);
}

/**
 * Rango de búsqueda de una generación completa (sin solape con la siguiente).
 * Lo usa el formulario del dealer para pasar de «elijo un F30» a un rango de
 * años con el que buscar en mobile.de.
 */
export function genSearchRange(gens: Generation[], g: Generation): { from: number; to: number | null } {
  const nextFrom = gens
    .filter((x) => x.from > g.from)
    .reduce<number | null>((min, x) => (min == null || x.from < min ? x.from : min), null);
  return { from: g.from, to: nextFrom != null ? nextFrom - 1 : g.to };
}
