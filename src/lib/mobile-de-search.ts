// mobile.de search-URL builder + make/model reference data.
//
// The make/model IDs come from mobile.de's own reference data
// (window.__INITIAL_STATE__.shared / consumer reference-data API), extracted
// 2026-06 and stored in ./data/mobile-de-makes-models.json. They are static
// reference data (they drift maybe once a year), so we bundle them as a file
// rather than a DB table — the URL builder runs server-side and synchronously
// on every questionnaire submit, and the client form imports MAKES directly.
//
// To refresh: re-extract from mobile.de and overwrite the JSON, then commit.

import RAW_MAKES from './data/mobile-de-makes-models.json';

// ── Raw data shape ──────────────────────────────────────────────────────────
// Each make has a flat list of models. A model is one of:
//   - a modelGroup        → has `g: 1`           (e.g. BMW "3 Series")
//   - a sub-model/trim     → has `p: <groupId>`   (e.g. BMW "320d" under 3 Series)
//   - a standalone model   → neither g nor p      (e.g. Audi "A4")
interface RawModel {
  i: string;   // model id
  n: string;   // model name
  g?: number;  // 1 => this entry is a modelGroup
  p?: string;  // parent modelGroup id => this entry is a sub-model
}
interface RawMake {
  id: string;
  name: string;
  models: RawModel[];
}

const RAW = RAW_MAKES as RawMake[];

// ── Public option types (consumed by the questionnaire UI) ──────────────────
export interface ModelOption {
  label: string;
  id: number;
  /**
   * The full mobile.de `ms` quad (`make;model;modelGroup;modelDescription`) for
   * this option. Carrying it on the option is what lets the URL builder stay
   * dumb: it just emits `ms` verbatim. It also sidesteps a nasty quirk — a model
   * id is NOT unique within a make (mobile.de keeps modelGroup and model ids in
   * separate namespaces, so e.g. VW "Golf" group 29 and "Scirocco" model 29
   * collide), and it makes surfacing specific sub-models (BMW X3) trivial.
   */
  ms: string;
  /** true when this option is a mobile.de modelGroup (vs. a standalone model). */
  group: boolean;
}

export interface MakeOption {
  label: string;
  id: number;
  models: ModelOption[];
}

// The `ms` quad for one raw model:
//   - group      -> `make;;groupId;`
//   - sub-model  -> `make;modelId;parentGroupId;`
//   - standalone -> `make;modelId;;`
function msFor(makeId: string, m: RawModel): string {
  if (m.g === 1) return `${makeId};;${m.i};`;
  if (m.p) return `${makeId};${m.i};${m.p};`;
  return `${makeId};${m.i};;`;
}

// A handful of mobile.de modelGroups are "umbrella" lines that lump genuinely
// distinct vehicles together (BMW "X Series" = X1…X7, "M Models" = M2…M6). The
// Spanish German-import market asks for these specific models, so we additionally
// surface the base sub-models alongside the umbrella group. Matched by exact name
// against the make's sub-model list, so ids stay data-driven.
const EXTRA_SUBMODELS: Record<string, string[]> = {
  BMW: ['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'M2', 'M3', 'M4', 'M5', 'M6', 'Z4'],
};

// mobile.de lists every nameplate it has ever known — including a catch-all
// "Other" on every make, plus long-dead classics and pure commercial vans. A
// Spanish import buyer filling the questionnaire wants current passenger models,
// so we hide that noise. The JSON carries no year, so classics/vans are an
// explicit per-make list (names match the raw JSON exactly — edit freely). Hiding
// a model here only removes it from the questionnaire dropdown; the free-text
// dealer flow (`resolveMobileSearch`) still resolves it, and clients can always
// name anything in the notes field.
const HIDE_MODELS_GLOBAL = new Set(['Other']);
const HIDE_MODELS: Record<string, string[]> = {
  Audi: ['80', '90', '100', '200', 'V8'],
  BMW: ['2002'],
  'Mercedes-Benz': ['190', '200', '220', '230', '240', '250', '260', '270', '280', '290', '300', '320', '350', '380', '400', '416', '420', '450', '500', '560', '600'],
  Volkswagen: ['181', 'Buggy', 'Iltis', 'Käfer', 'Karmann Ghia', 'LT', 'Taro', 'Santana', 'Routan', 'Corrado'],
  Porsche: ['356', '912', '914', '924', '928', '944', '959', '962', '968'],
  Volvo: ['240', '244', '245', '262', '264', '340', '360', '440', '460', '480', '740', '744', '745', '760', '780', '850', '855', '940', '944', '945', '960', '965', 'Amazon'],
  Skoda: ['105', '120', '130', '135', 'Favorit', 'Forman', 'Praktik'],
};

// Top-level selectable models for the dropdown: modelGroups (e.g. "3 Series")
// plus standalone models (e.g. Audi "A4", BMW "i4"), plus any curated umbrella
// sub-models. Trim-level sub-models are otherwise hidden to keep the list clean —
// picking a group searches the whole family, the right granularity for a
// client questionnaire.
export const MAKES: MakeOption[] = RAW.map((mk) => {
  const hidden = HIDE_MODELS[mk.name];
  const isHidden = (name: string) => HIDE_MODELS_GLOBAL.has(name) || (hidden?.includes(name) ?? false);
  const tops = mk.models.filter((m) => !m.p && !isHidden(m.n));
  const extraNames = EXTRA_SUBMODELS[mk.name];
  const extras = extraNames
    ? mk.models.filter((m) => m.p && extraNames.includes(m.n))
    : [];
  return {
    label: mk.name,
    id: Number(mk.id),
    models: [...tops, ...extras]
      .map((m) => ({ label: m.n, id: Number(m.i), ms: msFor(mk.id, m), group: m.g === 1 }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true })),
  };
})
  .filter((mk) => mk.models.length > 0)
  .sort((a, b) => a.label.localeCompare(b.label, 'es'));

// ── Filter enums (mobile.de URL values) ─────────────────────────────────────
export const FUELS = [
  { label: 'Gasolina', value: 'PETROL' },
  { label: 'Diésel', value: 'DIESEL' },
  { label: 'Eléctrico', value: 'ELECTRICITY' },
  { label: 'Híbrido', value: 'HYBRID' },
  { label: 'Híbrido enchufable', value: 'HYBRID_PLUGIN' },
] as const;

export const TRANSMISSIONS = [
  { label: 'Automático', value: 'AUTOMATIC_GEAR' },
  { label: 'Manual', value: 'MANUAL_GEAR' },
] as const;

// Exterior colour. The param IS `ecol=<value>` (verified live 2026-07-26 against
// mobile.de's own filter panel), but the questionnaire still collects it as a
// *preference* rather than a filter: nobody imports a car from Germany because
// it's black, and hard-filtering colour is the fastest way to turn 5.000 hits
// into 40 (see the KNOWN_BUGS over-filter lesson). `exteriorColor` below is
// wired for the dealer's own re-search, not for the capture form.
export const COLORS = [
  { label: 'Negro', value: 'BLACK', hex: '#1a1a1a' },
  { label: 'Blanco', value: 'WHITE', hex: '#f5f5f5' },
  { label: 'Gris', value: 'GREY', hex: '#808080' },
  { label: 'Plateado', value: 'SILVER', hex: '#c0c0c0' },
  { label: 'Azul', value: 'BLUE', hex: '#2563eb' },
  { label: 'Rojo', value: 'RED', hex: '#dc2626' },
  { label: 'Verde', value: 'GREEN', hex: '#16a34a' },
  { label: 'Marrón', value: 'BROWN', hex: '#92400e' },
  { label: 'Naranja', value: 'ORANGE', hex: '#ea580c' },
  { label: 'Amarillo', value: 'YELLOW', hex: '#eab308' },
  { label: 'Dorado', value: 'GOLD', hex: '#ca8a04' },
  { label: 'Beige', value: 'BEIGE', hex: '#d4c5a9' },
  { label: 'Morado', value: 'PURPLE', hex: '#7c3aed' },
] as const;

export const BODY_TYPES = [
  { label: 'SUV', value: 'OffRoad' },
  { label: 'Sedán', value: 'Limousine' },
  { label: 'Familiar', value: 'EstateCar' },
  { label: 'Compacto', value: 'SmallCar' },
  { label: 'Deportivo', value: 'SportsCar' },
  { label: 'Cabrio', value: 'Cabrio' },
  { label: 'Monovolumen', value: 'Van' },
] as const;

export const KM_OPTIONS = [
  { label: '25.000 km', value: 25000 },
  { label: '50.000 km', value: 50000 },
  { label: '75.000 km', value: 75000 },
  { label: '100.000 km', value: 100000 },
  { label: '150.000 km', value: 150000 },
  { label: '200.000 km', value: 200000 },
] as const;

// ── The rest of mobile.de's filter vocabulary ───────────────────────────────
// Param names and enum values were read straight off mobile.de's own detailed
// search form (2026-07-26): every filter was set, the form submitted, and the
// resulting query string decoded. Do NOT invent values here — a value mobile.de
// doesn't know is silently ignored at best and zeroes the result set at worst.

/** `dt` — drive type. "Tracción integral" is the one Spanish buyers ask for. */
export const DRIVE_TYPES = [
  { label: 'Tracción integral (4x4)', value: 'ALL_WHEEL' },
  { label: 'Delantera', value: 'FRONT' },
  { label: 'Trasera', value: 'REAR' },
] as const;

/** `it` — interior material. */
export const INTERIOR_TYPES = [
  { label: 'Cuero', value: 'LEATHER' },
  { label: 'Cuero parcial', value: 'PARTIAL_LEATHER' },
  { label: 'Polipiel', value: 'IMITATION_LEATHER' },
  { label: 'Alcántara', value: 'ALCANTARA' },
  { label: 'Tela', value: 'FABRIC' },
] as const;

/** `door` — door count, as mobile.de buckets it. */
export const DOOR_OPTIONS = [
  { label: '2 / 3 puertas', value: 'TWO_OR_THREE' },
  { label: '4 / 5 puertas', value: 'FOUR_OR_FIVE' },
  { label: '6 / 7 puertas', value: 'SIX_OR_SEVEN' },
] as const;

/** `sc` — seat count (exact). Only the counts a customer actually asks for. */
export const SEAT_OPTIONS = [
  { label: '5 plazas', value: 5 },
  { label: '7 plazas', value: 7 },
  { label: '9 plazas', value: 9 },
] as const;

/** `emc` — emission class. Drives the Spanish DGT sticker, so it matters here. */
export const EMISSION_CLASSES = [
  { label: 'Euro 6 o superior', value: 'EURO6' },
  { label: 'Euro 5 o superior', value: 'EURO5' },
  { label: 'Euro 4 o superior', value: 'EURO4' },
] as const;

/** `clim` — climate control. */
export const CLIMATISATIONS = [
  { label: 'Climatizador automático', value: 'AUTOMATIC_CLIMATISATION' },
  { label: 'Climatizador bizona', value: 'AUTOMATIC_CLIMATISATION_2_ZONES' },
  { label: 'Climatizador trizona', value: 'AUTOMATIC_CLIMATISATION_3_ZONES' },
  { label: 'Aire acondicionado (manual o automático)', value: 'MANUAL_CLIMATISATION' },
] as const;

/** `spc` — cruise control. */
export const CRUISE_CONTROLS = [
  { label: 'Control de crucero', value: 'CRUISE_CONTROL' },
  { label: 'Control de crucero adaptativo', value: 'ADAPTIVE_CRUISE_CONTROL' },
] as const;

/**
 * `fe` — equipment. Repeatable (`&fe=A&fe=B`) and AND-ed by mobile.de, so every
 * extra the customer marks as imprescindible narrows the result set hard: on a
 * used Golf GTI, `fe=PANORAMIC_GLASS_ROOF` alone cuts 5.884 ads to 1.176
 * (measured 2026-07-26). That is exactly why the capture form separates
 * «imprescindible» (→ this param) from «me gustaría» (→ a note for the dealer).
 *
 * Curated subset: the equipment a Spanish import buyer actually names out loud.
 * mobile.de exposes ~115 values; listing them all would make the form unusable
 * and every extra chip is a chance to over-filter.
 */
export interface FeatureGroup {
  group: string;
  items: { label: string; value: string }[];
}

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    group: 'Confort',
    items: [
      { label: 'Techo panorámico', value: 'PANORAMIC_GLASS_ROOF' },
      { label: 'Techo solar', value: 'SUNROOF' },
      { label: 'Asientos calefactados', value: 'ELECTRIC_HEATED_SEATS' },
      { label: 'Asientos ventilados', value: 'VENTILATED_SEATS' },
      { label: 'Asientos eléctricos con memoria', value: 'MEMORY_SEATS' },
      { label: 'Asientos deportivos', value: 'SPORT_SEATS' },
      { label: 'Volante calefactado', value: 'HEATED_STEERING_WHEEL' },
      { label: 'Volante en piel', value: 'LEATHER_STEERING_WHEEL' },
      { label: 'Iluminación ambiental', value: 'AMBIENT_LIGHTING' },
      { label: 'Portón trasero eléctrico', value: 'ELECTRIC_TAILGATE' },
      { label: 'Apertura sin llave', value: 'KEYLESS_ENTRY' },
      { label: 'Suspensión neumática', value: 'AIR_SUSPENSION' },
    ],
  },
  {
    group: 'Multimedia',
    items: [
      { label: 'Navegador', value: 'NAVIGATION_SYSTEM' },
      { label: 'Apple CarPlay', value: 'CARPLAY' },
      { label: 'Android Auto', value: 'ANDROID_AUTO' },
      { label: 'Pantalla táctil', value: 'TOUCHSCREEN' },
      { label: 'Cuadro digital', value: 'DIGITAL_COCKPIT' },
      { label: 'Head-up display', value: 'HEAD_UP_DISPLAY' },
      { label: 'Equipo de sonido', value: 'SOUND_SYSTEM' },
      { label: 'Carga inalámbrica del móvil', value: 'WIRELESS_CHARGING' },
      { label: 'Bluetooth', value: 'BLUETOOTH' },
      { label: 'Radio digital DAB', value: 'DAB_RADIO' },
    ],
  },
  {
    group: 'Seguridad y ayudas a la conducción',
    items: [
      { label: 'Cámara trasera', value: 'REAR_VIEW_CAM' },
      { label: 'Cámara 360º', value: 'CAM_360_DEGREES' },
      { label: 'Sensores de aparcamiento delante', value: 'FRONT_SENSORS' },
      { label: 'Sensores de aparcamiento detrás', value: 'REAR_SENSORS' },
      { label: 'Aparcamiento automático', value: 'AUTOMATIC_PARKING' },
      { label: 'Aviso de ángulo muerto', value: 'BLIND_SPOT_MONITOR' },
      { label: 'Frenada de emergencia', value: 'COLLISION_AVOIDANCE' },
      { label: 'Aviso de cambio de carril', value: 'LANE_DEPARTURE_WARNING' },
      { label: 'Lectura de señales', value: 'TRAFFIC_SIGN_RECOGNITION' },
      { label: 'Isofix', value: 'ISOFIX' },
    ],
  },
  {
    group: 'Exterior',
    items: [
      { label: 'Faros LED', value: 'LED_HEADLIGHTS' },
      { label: 'Faros de xenón', value: 'XENON_HEADLIGHTS' },
      { label: 'Faros matriciales', value: 'GLARE_FREE_HIGH_BEAM' },
      { label: 'Llantas de aleación', value: 'ALLOY_WHEELS' },
      { label: 'Barras de techo', value: 'ROOF_RAILS' },
      { label: 'Lunas tintadas', value: 'TINTED_WINDOWS' },
      { label: 'Pintura metalizada', value: 'METALLIC' },
    ],
  },
  {
    group: 'Práctico',
    items: [
      { label: 'Paquete de invierno', value: 'WINTER_PACKAGE' },
      { label: 'Calefacción independiente', value: 'AUXILIARY_HEATING' },
      { label: 'Neumáticos de invierno', value: 'WINTER_TIRES' },
      { label: 'Rueda de repuesto', value: 'SPARE_WHEEL' },
      { label: 'Enganche de remolque', value: 'TRAILER_COUPLING' },
    ],
  },
];

/**
 * `TRAILER_COUPLING` is our own pseudo-value: mobile.de files the tow hitch
 * under `tct`, not `fe`, and `tct` is single-valued (FIX | DETACHABLE |
 * SWIVELING — a repeated param keeps only the first, verified live). Picking one
 * kind would silently drop the other two, so the builder turns it into a
 * preference rather than a filter. Kept in the catalogue because customers do
 * ask for it and the dealer needs to read it.
 */
export const PSEUDO_FEATURES = new Set(['TRAILER_COUPLING']);

/** Spanish label for any `fe` value in the catalogue (for summaries/emails). */
export const FEATURE_LABELS: Record<string, string> = Object.fromEntries(
  FEATURE_GROUPS.flatMap((g) => g.items.map((i) => [i.value, i.label])),
);

export const PRICE_OPTIONS = [
  { label: '10.000 €', value: 10000 },
  { label: '15.000 €', value: 15000 },
  { label: '20.000 €', value: 20000 },
  { label: '25.000 €', value: 25000 },
  { label: '30.000 €', value: 30000 },
  { label: '40.000 €', value: 40000 },
  { label: '50.000 €', value: 50000 },
  { label: '60.000 €', value: 60000 },
  { label: '80.000 €', value: 80000 },
  { label: '100.000 €', value: 100000 },
] as const;

export interface ClientPreferences {
  makeId?: number;
  modelMs?: string; // full mobile.de `ms` quad from the chosen ModelOption
  /**
   * Trim/version free text ("GTI", "M Sport", "AMG Line"). Goes into the 4th
   * slot of the `ms` quad (modelDescription) — mobile.de's consumer front-end
   * honours it, so `ms=25200;;29;GTI` really does return only GTIs.
   */
  variant?: string;
  minPrice?: number; // suelo del rango — filtra chatarra por debajo de lo que el cliente contempla
  maxPrice?: number;
  maxKm?: number;
  minYear?: number;
  maxYear?: number;
  fuel?: string;
  transmission?: string;
  minCv?: number;      // power in CV/PS (converted to kW for the URL)
  color?: string;      // collected but not applied to the URL (see COLORS note)
  exteriorColor?: string; // `ecol` — only for dealer-side re-search, never the capture form
  bodyType?: string;
  driveType?: string;      // `dt`
  interiorType?: string;   // `it`
  doors?: string;          // `door`
  seats?: number;          // `sc`
  emissionClass?: string;  // `emc`
  climatisation?: string;  // `clim`
  cruiseControl?: string;  // `spc`
  /** `fe` values the customer marked as imprescindible. AND-ed by mobile.de. */
  features?: string[];
  /** `vat=1` — only ads with deductible VAT (MwSt ausweisbar). Dealer economics. */
  vatDeductible?: boolean;
  /** `st=DEALER` — professional sellers only. */
  dealersOnly?: boolean;
}

/** Build a current-scheme mobile.de search URL, sorted cheapest-first. */
// Resolve a free-text make + model (as typed by a dealer, e.g. "BMW" / "320d")
// into a mobile.de make id and, when possible, a specific model `ms` quad. Unlike
// the `MAKES` dropdown export (which only surfaces model *groups*), this searches
// the full model list including sub-models, so "320d" resolves to BMW 320 rather
// than falling back to an all-BMW search.
export function resolveMobileSearch(makeName?: string | null, modelName?: string | null): { makeId?: number; modelMs?: string } {
  if (!makeName?.trim()) return {};
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '');
  const mkNorm = norm(makeName);
  const mk = RAW.find((m) => norm(m.name) === mkNorm) || RAW.find((m) => norm(m.name).startsWith(mkNorm));
  if (!mk) return {};
  const makeId = Number(mk.id);
  if (!modelName?.trim()) return { makeId };

  const mn = norm(modelName);
  // 1) exact model name
  let best = mk.models.find((m) => norm(m.n) === mn);
  // 2) model label is a prefix of the query ("320" ⊂ "320d") — longest label wins
  if (!best) {
    best = mk.models
      .filter((m) => norm(m.n).length >= 2 && mn.startsWith(norm(m.n)))
      .sort((a, b) => norm(b.n).length - norm(a.n).length)[0];
  }
  // 3) query is a prefix of the model label ("3 series" → "3 Series")
  if (!best && mn.length >= 2) best = mk.models.find((m) => norm(m.n).startsWith(mn));

  return best ? { makeId, modelMs: msFor(mk.id, best) } : { makeId };
}

export function buildMobileDeSearchUrl(prefs: ClientPreferences): string {
  const params = new URLSearchParams();

  // Vehicle class + used + no accident-damaged + sort cheapest first.
  params.set('vc', 'Car');
  params.set('con', 'USED');
  params.set('dam', 'false');
  params.set('sfmr', 'false');
  params.set('sb', 'p');   // sort by price
  params.set('od', 'up');  // ascending — best-margin candidates first

  // El `ms` es un quad `marca;modelo;grupo;versión`. La versión (4º hueco) es
  // texto libre y filtra de verdad, así que un «Golf GTI» se busca como GTI y no
  // como todos los Golf.
  const variant = prefs.variant?.trim() ?? '';
  if (prefs.modelMs) {
    params.set('ms', `${prefs.modelMs}${variant}`);
  } else if (prefs.makeId) {
    params.set('ms', `${prefs.makeId};;;${variant}`);
  }

  // mobile.de acepta `p=min:max`; cualquiera de los dos extremos puede faltar.
  if (prefs.minPrice || prefs.maxPrice) {
    params.set('p', `${prefs.minPrice ?? ''}:${prefs.maxPrice ?? ''}`);
  }
  if (prefs.maxKm) params.set('ml', `:${prefs.maxKm}`);
  if (prefs.minYear || prefs.maxYear) {
    params.set('fr', `${prefs.minYear ?? ''}:${prefs.maxYear ?? ''}`);
  }
  if (prefs.fuel) params.set('ft', prefs.fuel);
  if (prefs.transmission) params.set('tr', prefs.transmission);
  if (prefs.bodyType) params.set('c', prefs.bodyType);
  if (prefs.driveType) params.set('dt', prefs.driveType);
  if (prefs.interiorType) params.set('it', prefs.interiorType);
  if (prefs.doors) params.set('door', prefs.doors);
  if (prefs.seats) params.set('sc', String(prefs.seats));
  if (prefs.emissionClass) params.set('emc', prefs.emissionClass);
  if (prefs.climatisation) params.set('clim', prefs.climatisation);
  if (prefs.cruiseControl) params.set('spc', prefs.cruiseControl);
  if (prefs.exteriorColor) params.set('ecol', prefs.exteriorColor);
  if (prefs.vatDeductible) params.set('vat', '1');
  if (prefs.dealersOnly) params.set('st', 'DEALER');
  // `fe` se repite una vez por equipamiento; mobile.de los cruza con AND.
  for (const f of prefs.features ?? []) {
    if (f && !PSEUDO_FEATURES.has(f)) params.append('fe', f);
  }
  if (prefs.minCv) {
    // The customer picks a concrete motorization (e.g. the 245 CV GTI), so target
    // a band around it, NOT a floor — a floor (`kw:`) returns that power AND every
    // more-powerful engine, which reads as "everything except the one I chose".
    // ±10 CV mirrors the per-engine sourcing band.
    const kwMin = Math.round((prefs.minCv - 10) * 0.7355); // PS/CV -> kW
    const kwMax = Math.round((prefs.minCv + 10) * 0.7355);
    params.set('pw', `${kwMin}:${kwMax}`);
  }

  // Consumer front-end (www.mobile.de/es) rather than the legacy suchen.mobile.de:
  // the legacy host bot-blocks when you click through to a listing detail. The
  // Spanish path segment "vehículos" must stay percent-encoded. All the query
  // params below are accepted verbatim by the consumer SPA.
  return `https://www.mobile.de/es/veh%C3%ADculos/buscar.html?${params.toString()}`;
}
