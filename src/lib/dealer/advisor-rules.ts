/**
 * Motor de reglas del asesor (puerta B de la captación).
 *
 * POR QUÉ ESTO NO LO HACE LA IA
 * -----------------------------
 * El perfil sale de reglas deterministas y la IA solo redacta encima. Así:
 *  · es auditable — el dealer puede ver qué regla disparó qué;
 *  · es reproducible — las mismas respuestas dan el mismo perfil siempre;
 *  · y sobre todo: NO PUEDE recomendar un eléctrico a quien aparca en la calle,
 *    porque la restricción se aplica antes de que el modelo hable.
 *
 * Ninguna de las 7 preguntas menciona carrocería ni combustible: se pregunta por
 * la vida del cliente y aquí se deduce el coche. Es lo que hace que funcione con
 * alguien que no sabe qué es un SUV compacto.
 *
 * Los valores de salida son los de mobile.de (ver lib/mobile-de-search) para que
 * el perfil se pueda meter tal cual en vehicles[] y generar la URL de búsqueda.
 */

export type Usage = 'ciudad' | 'carretera' | 'mixto' | 'trabajo' | 'finde';
export type KmBand = 'menos-10k' | '10-20k' | '20-30k' | 'mas-30k';
export type Occupants = '1-2' | '3-4' | '5' | '6-7';
export type ChildSeats = 'no' | 'una' | 'dos-o-mas';
export type Cargo = 'nada' | 'carrito' | 'deporte' | 'perro' | 'trabajo' | 'remolque';
export type Parking = 'garaje-enchufe' | 'garaje-sin-enchufe' | 'calle-apretada' | 'calle-facil';
export type Priority =
  | 'consumo' | 'espacio' | 'precio' | 'fiabilidad'
  | 'potencia' | 'tecnologia' | 'valor-residual' | 'diseno';

export interface AdvisorAnswers {
  usage: Usage;
  km: KmBand;
  occupants: Occupants;
  childSeats: ChildSeats;
  cargo: Cargo[];
  parking: Parking;
  minPrice: number | null;
  maxPrice: number | null;
  payment: 'contado' | 'financiado' | 'no-lo-se' | null;
  tradeIn: 'si' | 'no' | 'sin-coche' | null;
  priorities: Priority[];
  timeframe?: 'ya' | '1-3-meses' | 'sin-prisa' | null;
}

export interface AdvisorProfile {
  /** Valor mobile.de: OffRoad | EstateCar | SmallCar | Limousine | Van… */
  bodyType: string;
  bodyLabel: string;
  /** Valor mobile.de: DIESEL | PETROL | HYBRID | HYBRID_PLUGIN | ELECTRICITY */
  fuel: string;
  fuelLabel: string;
  /** Valor mobile.de: AUTOMATIC_GEAR | null (sin preferencia) */
  transmission: string | null;
  transmissionLabel: string | null;
  seats: number;
  minPrice: number | null;
  maxPrice: number | null;
  minYear: number | null;
  maxKm: number | null;
  extras: string[];
  /** Titular del resultado, ej. "SUV compacto diésel automático". */
  headline: string;
  /** Bullets del porqué, en el orden en que se muestran. */
  reasons: string[];
  /** Lo que se descartó y por qué — genera confianza más que los aciertos. */
  ruledOut: string[];
}

const BODY_LABELS: Record<string, string> = {
  OffRoad: 'SUV',
  EstateCar: 'Familiar',
  SmallCar: 'Compacto',
  Limousine: 'Sedán',
  Van: 'Monovolumen',
  SportsCar: 'Deportivo',
};
const FUEL_LABELS: Record<string, string> = {
  DIESEL: 'Diésel',
  PETROL: 'Gasolina',
  HYBRID: 'Híbrido',
  HYBRID_PLUGIN: 'Híbrido enchufable',
  ELECTRICITY: 'Eléctrico',
};

const KM_PER_YEAR: Record<KmBand, number> = {
  'menos-10k': 8000,
  '10-20k': 15000,
  '20-30k': 25000,
  'mas-30k': 35000,
};

const KM_LABEL: Record<KmBand, string> = {
  'menos-10k': 'menos de 10.000 km al año',
  '10-20k': '10.000–20.000 km al año',
  '20-30k': '25.000 km al año',
  'mas-30k': 'más de 30.000 km al año',
};

/** ¿Puede cargar en casa? Única puerta a eléctrico/enchufable. */
const canCharge = (p: Parking) => p === 'garaje-enchufe';

function pickFuel(a: AdvisorAnswers): { fuel: string; reason: string; ruledOut: string[] } {
  const km = KM_PER_YEAR[a.km];
  const ruledOut: string[] = [];
  const highway = a.usage === 'carretera';
  const city = a.usage === 'ciudad';

  if (!canCharge(a.parking)) {
    ruledOut.push(
      'Descartamos eléctrico e híbrido enchufable: sin poder cargar donde aparcas no compensan.',
    );
  }

  // Con enchufe en casa el eléctrico solo tiene sentido si no vives en la autopista.
  if (canCharge(a.parking)) {
    if (city && km <= 15000) {
      return {
        fuel: 'ELECTRICITY',
        reason: `Cargas en casa y haces ${KM_LABEL[a.km]} casi todo en ciudad: es el escenario donde un eléctrico sale más barato de usar.`,
        ruledOut,
      };
    }
    if (km <= 25000) {
      return {
        fuel: 'HYBRID_PLUGIN',
        reason: 'Cargas en casa pero también haces carretera: un híbrido enchufable te deja hacer el diario en eléctrico sin quedarte corto en viajes.',
        ruledOut,
      };
    }
  }

  if (km >= 25000 || (highway && km >= 15000)) {
    return {
      fuel: 'DIESEL',
      reason: `Con ${KM_LABEL[a.km]} y mucha carretera, el diésel te sale más barato que un híbrido a partir de los 20.000 km.`,
      ruledOut,
    };
  }

  if (km < 12000 && (city || a.usage === 'finde')) {
    return {
      fuel: 'PETROL',
      reason: `Con ${KM_LABEL[a.km]} y trayectos cortos, un gasolina sencillo es más barato de comprar y de mantener; no llegarías a amortizar un diésel.`,
      ruledOut,
    };
  }

  return {
    fuel: 'HYBRID',
    reason: `Con ${KM_LABEL[a.km]} repartidos entre ciudad y carretera, el híbrido es el que menos gasta sin depender de tener enchufe.`,
    ruledOut,
  };
}

function pickBody(a: AdvisorAnswers): { body: string; seats: number; reason: string; ruledOut: string[] } {
  const ruledOut: string[] = [];
  const bulky = a.cargo.some((c) => ['deporte', 'perro', 'carrito'].includes(c));
  const wantsSpace = a.priorities.includes('espacio');

  if (a.occupants === '6-7') {
    return {
      body: 'Van',
      seats: 7,
      reason: 'Necesitas 7 plazas de verdad, así que el monovolumen (o un SUV grande de 7 plazas) es lo único que te vale.',
      ruledOut,
    };
  }

  if (a.cargo.includes('remolque')) {
    return {
      body: 'OffRoad',
      seats: 5,
      reason: 'Con remolque o caravana necesitas capacidad de arrastre y enganche: un SUV con motor de par te lo da.',
      ruledOut,
    };
  }

  if (a.cargo.includes('trabajo') || a.usage === 'trabajo') {
    return {
      body: 'EstateCar',
      seats: 5,
      reason: 'Cargas material a diario: un familiar te da maletero largo y plano sin pagar el sobreprecio de un SUV.',
      ruledOut,
    };
  }

  if (a.parking === 'calle-apretada' && a.occupants === '1-2' && !bulky) {
    ruledOut.push('Descartamos SUV y familiar: aparcas en calle apretada y solo sois 1–2, pagarías tamaño que te estorba.');
    return {
      body: 'SmallCar',
      seats: 5,
      reason: 'Aparcas en calle estrecha y sois pocos: un compacto entra donde el resto no y gasta menos.',
      ruledOut,
    };
  }

  if (bulky || a.occupants === '5' || wantsSpace) {
    const reasonBits: string[] = [];
    if (a.cargo.includes('carrito')) reasonBits.push('carrito');
    if (a.cargo.includes('deporte')) reasonBits.push('bicis');
    if (a.cargo.includes('perro')) reasonBits.push('perro');
    if (a.childSeats !== 'no') reasonBits.push(a.childSeats === 'una' ? 'una sillita' : 'dos sillitas');

    // '6-7' ya retornó arriba (monovolumen), así que aquí solo queda descartarlo
    // para los grupos pequeños que llegan por carga o por prioridad de espacio.
    if (a.occupants !== '5') {
      ruledOut.push('Descartamos el monovolumen de 7 plazas: no sois tantos y pagarías espacio que no usas.');
    }

    return {
      body: 'OffRoad',
      seats: 5,
      reason: reasonBits.length
        ? `Con ${reasonBits.join(' + ')} necesitas maletero alto y ancho, no solo largo: por eso un SUV/familiar y no una berlina.`
        : 'Priorizas espacio: un SUV o familiar te da maletero y habitabilidad sin irte a un monovolumen.',
      ruledOut,
    };
  }

  if (a.priorities.includes('potencia') || a.priorities.includes('diseno')) {
    return {
      body: 'Limousine',
      seats: 5,
      reason: 'No cargas nada voluminoso y valoras cómo va y cómo se ve: una berlina te da mejor conducción que un SUV del mismo dinero.',
      ruledOut,
    };
  }

  return {
    body: 'SmallCar',
    seats: 5,
    reason: 'Sin necesidades especiales de carga, un compacto es lo más barato de comprar, usar y aparcar.',
    ruledOut,
  };
}

function pickTransmission(a: AdvisorAnswers): { tr: string | null; reason: string | null } {
  const km = KM_PER_YEAR[a.km];
  if (a.usage === 'ciudad') {
    return { tr: 'AUTOMATIC_GEAR', reason: 'En ciudad y atascos a diario, el automático te va a cambiar la vida más que cualquier extra.' };
  }
  if (km >= 20000) {
    return { tr: 'AUTOMATIC_GEAR', reason: 'Haces muchos kilómetros: el automático cansa mucho menos en trayectos largos.' };
  }
  return { tr: null, reason: null };
}

/**
 * Año mínimo y techo de km, derivados del presupuesto y de la prioridad.
 * "Que no dé problemas" sube el año y baja los km; "el precio más bajo" al revés.
 */
function pickAgeAndKm(a: AdvisorAnswers): { minYear: number | null; maxKm: number | null; reason: string | null } {
  const budget = a.maxPrice;
  if (budget == null) return { minYear: null, maxKm: null, reason: null };

  const year = new Date().getFullYear();
  const wantsReliable = a.priorities.includes('fiabilidad');
  const wantsCheap = a.priorities.includes('precio');

  // Base: cuanto más presupuesto, más nuevo se puede exigir.
  let age = budget >= 35000 ? 4 : budget >= 22000 ? 6 : budget >= 14000 ? 8 : 10;
  let maxKm = budget >= 35000 ? 90000 : budget >= 22000 ? 120000 : budget >= 14000 ? 150000 : 180000;

  let reason: string | null = null;
  if (wantsReliable && !wantsCheap) {
    age -= 1;
    maxKm -= 30000;
    reason = 'Como priorizas que no dé problemas, apuntamos a coches más nuevos y con menos kilómetros de lo que tu presupuesto permitiría.';
  } else if (wantsCheap && !wantsReliable) {
    age += 2;
    maxKm += 40000;
    reason = 'Como priorizas el precio, ampliamos a coches algo mayores: por el mismo dinero te llevas más coche.';
  }

  return { minYear: year - age, maxKm: Math.max(60000, maxKm), reason };
}

function pickExtras(a: AdvisorAnswers): string[] {
  const extras: string[] = [];
  if (a.childSeats !== 'no') extras.push('ISOFIX');
  if (a.cargo.includes('remolque')) extras.push('Enganche de remolque');
  if (a.cargo.includes('perro') || a.cargo.includes('deporte')) extras.push('Maletero grande');
  if (a.usage === 'carretera') extras.push('Control de crucero adaptativo');
  if (a.usage === 'ciudad' || a.parking === 'calle-apretada') extras.push('Cámara de aparcamiento');
  if (a.priorities.includes('tecnologia')) extras.push('Apple CarPlay / Android Auto');
  if (a.occupants === '6-7') extras.push('7 plazas');
  return Array.from(new Set(extras));
}

/** Titular corto y legible: "SUV diésel automático". */
function buildHeadline(bodyLabel: string, fuelLabel: string, trLabel: string | null): string {
  return [bodyLabel, fuelLabel.toLowerCase(), trLabel?.toLowerCase()].filter(Boolean).join(' ');
}

export function buildAdvisorProfile(a: AdvisorAnswers): AdvisorProfile {
  const fuelPick = pickFuel(a);
  const bodyPick = pickBody(a);
  const trPick = pickTransmission(a);
  const age = pickAgeAndKm(a);

  const bodyLabel = BODY_LABELS[bodyPick.body] ?? bodyPick.body;
  const fuelLabel = FUEL_LABELS[fuelPick.fuel] ?? fuelPick.fuel;
  const trLabel = trPick.tr === 'AUTOMATIC_GEAR' ? 'Automático' : null;

  const reasons = [fuelPick.reason, bodyPick.reason, trPick.reason, age.reason]
    .filter((r): r is string => !!r);

  const ruledOut = [...bodyPick.ruledOut, ...fuelPick.ruledOut];

  return {
    bodyType: bodyPick.body,
    bodyLabel,
    fuel: fuelPick.fuel,
    fuelLabel,
    transmission: trPick.tr,
    transmissionLabel: trLabel,
    seats: bodyPick.seats,
    minPrice: a.minPrice,
    maxPrice: a.maxPrice,
    minYear: age.minYear,
    maxKm: age.maxKm,
    extras: pickExtras(a),
    headline: buildHeadline(bodyLabel, fuelLabel, trLabel),
    reasons,
    ruledOut,
  };
}

/** El perfil traducido a un vehicles[] que la API de operaciones ya entiende. */
export function profileToVehicle(p: AdvisorProfile) {
  return {
    body_type: p.bodyType,
    fuel: p.fuel,
    transmission: p.transmission ?? undefined,
    min_price: p.minPrice,
    max_price: p.maxPrice,
    min_year: p.minYear,
    max_km: p.maxKm,
  };
}
