'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Car, CheckCircle2, Loader2, MessageSquare, ArrowRight, ChevronLeft, ChevronRight,
  Plus, X, Pencil,
} from 'lucide-react';
import {
  MAKES, FUELS, TRANSMISSIONS, BODY_TYPES, COLORS,
  INTERIOR_TYPES, DOOR_OPTIONS, SEAT_OPTIONS, EMISSION_CLASSES,
  FEATURE_GROUPS, FEATURE_LABELS, PSEUDO_FEATURES,
  type MakeOption, type ModelOption,
} from '@/lib/mobile-de-search';
import { generationsFor, genSearchRange, type Generation } from '@/lib/dealer/generations';

/** Una designación de motor del dataset EEA (320d, 1.6 TDI) con sus CV reales. */
interface EngineDesignation {
  designation: string;
  fuel: string;
  cvs: number[];
}

/**
 * Puerta A de la captación — «ya sé qué coche quiero».
 *
 * UN solo formulario para las DOS entradas: el enlace público `/q/{slug}` que
 * rellena el cliente, y el «Nueva operación» que rellena el dealer desde la app
 * (`NewOperationModal`). Con `slug` guarda contra el endpoint público; con
 * `onSubmit` deja que el padre (autenticado) guarde y navegue.
 *
 * FLUJO POR COCHE (rediseño 2026-07-27). Antes las specs (presupuesto, motor,
 * extras) eran COMPARTIDAS entre todos los modelos elegidos, lo que rompía el
 * paso del motor en cuanto había dos coches: un Golf de 150 CV no es el mismo
 * motor que un Tiguan de 150 CV. Ahora cada coche se rellena ENTERO y de forma
 * secuencial —marca → modelo → presupuesto → motor → extras—, y al acabar un hub
 * ofrece «añadir otro vehículo» para repetir. Los pasos de una sola opción
 * (marca, combustible, cambio, tracción, motor) AVANZAN al pulsar, sin botón
 * «Siguiente»; los de texto o multi-selección conservan un «Continuar».
 */

interface DealerPublic {
  business_name: string;
  logo_url: string | null;
  whatsapp: string | null;
  phone: string | null;
}

/** Lo que el formulario ha recogido, listo para guardar. */
export interface CapturePayload {
  client_name: string;
  client_phone?: string;
  vehicles: Record<string, unknown>[];
  extras?: string[];
  notes?: string;
  /** Alta interna «para stock»: operación sin cliente, para el concesionario. */
  is_stock?: boolean;
}

interface QuestionnaireV2Props {
  /** Captación pública: el slug del dealer. Se omite en el alta interna. */
  slug?: string;
  /** Alta interna: guárdalo tú (autenticado). El padre navega tras el éxito. */
  onSubmit?: (payload: CapturePayload) => Promise<void>;
  /** Muestra la X de cerrar (uso en modal). */
  onClose?: () => void;
  submitLabel?: string;
}

const MAX_CARS = 4; // espejo de MAX_VEHICLES en lib/dealer-vehicles

// Solo techo: nadie pone un presupuesto mínimo. Cada chip fija el máximo.
const BUDGET_BANDS: { label: string; max: number }[] = [
  { label: '15k', max: 15000 },
  { label: '20k', max: 20000 },
  { label: '26k', max: 26000 },
  { label: '35k', max: 35000 },
  { label: '50k', max: 50000 },
  { label: '80k', max: 80000 },
];
const KM_CHIPS = [50000, 100000, 120000, 150000, 200000];

const TIMEFRAMES = [
  { value: 'ya', label: 'Ya · este mes' },
  { value: '1-3-meses', label: '1–3 meses' },
  { value: 'sin-prisa', label: 'Sin prisa' },
  { value: 'mirando', label: 'Solo mirando' },
];
const PAYMENTS = [
  { value: 'contado', label: 'Al contado' },
  { value: 'financiado', label: 'Financiado' },
  { value: 'no-lo-se', label: 'Aún no lo sé' },
];
const TRADE_INS = [
  { value: 'si', label: 'Sí, tasádmelo' },
  { value: 'no', label: 'No' },
  { value: 'sin-coche', label: 'No tengo coche' },
];

const INPUT =
  'w-full rounded-[10px] border border-peri/50 bg-white px-3.5 py-3 text-[15px] text-navy placeholder:text-ink/45 outline-none transition-colors focus:border-mid focus:ring-2 focus:ring-mid/20';
const LABEL =
  'mb-1.5 block [font-family:var(--font-mono)] text-[10px] font-bold uppercase tracking-[0.14em] text-mid';
const CHIP_BASE =
  'min-h-10 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors duration-150';
const CHIP_ON = 'border-navy bg-navy text-white';
const CHIP_OFF = 'border-peri/60 bg-paper text-ink hover:border-mid hover:text-navy';
const chip = (on: boolean) => `${CHIP_BASE} ${on ? CHIP_ON : CHIP_OFF}`;

const OPT_BASE =
  'rounded-[10px] border p-3.5 text-[14px] font-semibold transition-colors duration-150 text-center';
const OPT_ON = 'border-navy bg-navy text-white';
const OPT_OFF = 'border-peri/50 bg-white text-navy hover:border-mid';
const OPT_MUTED = 'border-peri/50 bg-paper text-ink hover:border-mid';
const opt = (on: boolean, muted = false) => `${OPT_BASE} ${on ? OPT_ON : muted ? OPT_MUTED : OPT_OFF}`;

const fmtNum = (n: number | null) => (n == null ? '' : n.toLocaleString('es-ES'));
const parseNum = (s: string): number | null => {
  const d = s.replace(/\D/g, '');
  return d ? parseInt(d, 10) : null;
};

/** Un coche con TODA su ficha. Cada coche de la operación lleva la suya. */
interface DraftCar {
  make: MakeOption | null;
  model: ModelOption | null;
  /** Generación/chasis elegida (E46, F30, Golf 7). Fija el rango de años. */
  generation: string | null;
  /** Designaciones de motor elegidas (320d, 1.6 TDI, 428i). El cliente puede
   *  marcar varias del mismo modelo; encabezan la recomendación con su veredicto. */
  engines: string[];
  variant: string;
  minPrice: number | null;
  maxPrice: number | null;
  maxKm: number | null;
  minYear: number | null;
  maxYear: number | null;
  fuel: string | null;
  transmission: string | null;
  driveType: string | null;
  minCv: number | null;
  bodyType: string | null;
  seats: number | null;
  doors: string | null;
  interiorType: string | null;
  emissionClass: string | null;
  color: string | null;
  wanted: string[];
  musts: string[];
}

const emptyDraft = (): DraftCar => ({
  make: null, model: null, generation: null, engines: [], variant: '',
  minPrice: null, maxPrice: null, maxKm: null, minYear: null, maxYear: null,
  fuel: null, transmission: null, driveType: null, minCv: null,
  bodyType: null, seats: null, doors: null, interiorType: null, emissionClass: null,
  color: null, wanted: [], musts: [],
});

const draftMeaningful = (d: DraftCar): boolean =>
  !!(d.make || d.bodyType || d.generation || d.engines.length || d.minPrice || d.maxPrice ||
    d.maxKm || d.minYear || d.maxYear || d.fuel || d.transmission || d.minCv ||
    d.driveType || d.seats || d.doors || d.interiorType || d.emissionClass ||
    d.color || d.wanted.length);

function BrandCombobox<T extends { id: number; label: string }>({
  id, options, value, placeholder, disabled, onSelect, allowAny = true,
}: {
  id: string;
  options: T[];
  value: T | null;
  placeholder: string;
  disabled?: boolean;
  onSelect: (option: T | null) => void;
  allowAny?: boolean;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const shown = query ?? value?.label ?? '';
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const filtered = query
    ? (() => {
        const q = norm(query);
        const starts = options.filter((o) => norm(o.label).startsWith(q));
        const contains = options.filter((o) => !norm(o.label).startsWith(q) && norm(o.label).includes(q));
        return [...starts, ...contains];
      })()
    : options;

  const commit = (option: T | null) => {
    onSelect(option);
    setQuery(null);
    setOpen(false);
  };

  // Al salir del campo sin elegir de la lista, si lo tecleado identifica una
  // opción sin ambigüedad se da por buena (no se pierde en silencio).
  const commitOnBlur = () => {
    if (query?.trim()) {
      const q = norm(query);
      const exact = options.find((o) => norm(o.label) === q);
      const only = filtered.length === 1 ? filtered[0] : null;
      const best = exact ?? only;
      if (best) { commit(best); return; }
    }
    setOpen(false);
    setQuery(null);
  };

  return (
    <div>
      <input
        id={id}
        className={`${INPUT} disabled:cursor-not-allowed disabled:opacity-50`}
        placeholder={placeholder}
        disabled={disabled}
        value={shown}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onBlur={() => setTimeout(commitOnBlur, 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (query && filtered.length > 0) commit(filtered[0]);
            else setOpen(false);
          }
          if (e.key === 'Escape') { setOpen(false); setQuery(null); }
        }}
      />
      {/* La lista va EN FLUJO, no flotando: flotando tapaba el campo de abajo y
          el clic caía sobre la primera opción sin querer. */}
      {open && !disabled && (
        <div className="mt-1 max-h-[240px] w-full overflow-y-auto rounded-[10px] border border-peri/50 bg-white shadow-[0_12px_32px_rgba(4,33,82,0.12)]">
          {allowAny && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); commit(null); }}
              className={`block w-full px-3.5 py-2.5 text-left text-[14px] transition-colors hover:bg-paper ${!value ? 'font-semibold text-navy' : 'text-ink'}`}
            >
              Me da igual
            </button>
          )}
          {filtered.map((o) => (
            <button
              key={o.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); commit(o); }}
              className={`block w-full px-3.5 py-2.5 text-left text-[14px] transition-colors hover:bg-paper ${value?.id === o.id ? 'font-semibold text-navy' : 'text-navy'}`}
            >
              {o.label}
            </button>
          ))}
          {query && filtered.length === 0 && (
            <p className="px-3.5 py-2.5 text-[13px] text-ink">Sin resultados para «{query}»</p>
          )}
        </div>
      )}
    </div>
  );
}

// Un coche se rellena en este orden. Los pasos de una sola opción avanzan al
// pulsar (marca, combustible, cambio, tracción, cv); el resto lleva «Continuar».
type Step =
  | 'tipo' | 'contacto'
  | 'marca' | 'modelo' | 'generacion' | 'presupuesto' | 'combustible' | 'cambio'
  | 'cv' | 'carroceria' | 'equipamiento' | 'imprescindibles'
  | 'mas' | 'plazo' | 'resumen';

// Los pasos que forman la ficha de UN coche, en orden:
// marca → modelo → versión(generación) → presupuesto → combustible → cambio →
// motor(designación) → carrocería → equipamiento → imprescindibles.
// La tracción NO se pregunta a propósito: es un filtro duro y hay modelos que
// solo existen en una (un Polo no viene en trasera), así que pedirla vaciaría la
// búsqueda — el mismo problema que el color.
const CAR_STEPS: Step[] = [
  'marca', 'modelo', 'generacion', 'presupuesto', 'combustible', 'cambio',
  'cv', 'carroceria', 'equipamiento', 'imprescindibles',
];
// Al pulsar una opción en estos, se avanza solo.
const AUTO_STEPS = new Set<Step>(['marca', 'generacion', 'combustible', 'cambio', 'cv']);

const STEP_TITLES: Partial<Record<Step, { title: string; sub?: string }>> = {
  tipo: {
    title: '¿PARA QUIÉN ES?',
    sub: 'Una operación para un cliente concreto, o un coche para tu propio stock.',
  },
  contacto: {
    title: 'DINOS QUÉ COCHE QUIERES',
    sub: 'Te lo buscamos en toda Europa y te lo traemos con informe incluido. Primero, ¿cómo te llamamos?',
  },
  marca: { title: '¿QUÉ MARCA?', sub: 'Escribe para buscar, o «me da igual»' },
  modelo: { title: '¿QUÉ MODELO?' },
  generacion: { title: '¿QUÉ GENERACIÓN?', sub: 'La versión del modelo — elige la que buscas' },
  presupuesto: { title: 'PRESUPUESTO Y AÑOS', sub: 'Un rango encuentra más opciones que un techo seco' },
  combustible: { title: '¿COMBUSTIBLE?' },
  cambio: { title: '¿CAMBIO?' },
  cv: { title: '¿QUÉ MOTOR?' }, // el subtítulo se calcula
  carroceria: { title: 'CARROCERÍA E INTERIOR', sub: 'Todo opcional — solo lo que te importe' },
  equipamiento: { title: 'EQUIPAMIENTO', sub: 'Marca todo lo que te gustaría que llevara' },
  imprescindibles: { title: '¿QUÉ ES INNEGOCIABLE?', sub: 'De lo que has marcado, ¿sin qué NO lo comprarías?' },
  mas: { title: '¿ALGÚN COCHE MÁS?', sub: 'Añade otro modelo que también te valdría, o continúa' },
  plazo: { title: '¿PARA CUÁNDO?', sub: 'Así sabemos con qué urgencia buscarte opciones' },
  resumen: { title: 'REVISA Y ENVÍA', sub: 'Esto es exactamente lo que vamos a buscar' },
};

export default function QuestionnaireV2({
  slug, onSubmit, onClose, submitLabel = 'Enviar solicitud',
}: QuestionnaireV2Props) {
  const inApp = !!onSubmit;
  const [dealer, setDealer] = useState<DealerPublic | null>(null);
  const [loading, setLoading] = useState(!!slug);
  const [notFound, setNotFound] = useState(false);

  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  // El alta interna empieza eligiendo cliente vs. stock; la pública salta directa
  // a los datos de contacto del cliente.
  const [step, setStep] = useState<Step>(inApp ? 'tipo' : 'contacto');
  const [history, setHistory] = useState<Step[]>([]);

  // "Para stock": operación sin cliente, para el propio concesionario (solo in-app).
  const [isStock, setIsStock] = useState(false);

  // Contacto (una sola vez)
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');

  // Coches: los ya confirmados + el que se está rellenando ahora (draft).
  const [vehicles, setVehicles] = useState<DraftCar[]>([]);
  const [draft, setDraft] = useState<DraftCar>(emptyDraft());
  const upd = (patch: Partial<DraftCar>) => setDraft((d) => ({ ...d, ...patch }));
  // El coche en curso (draft) es SIEMPRE el último de la operación —es como lo
  // pinta el hub—, así que reeditar uno lo saca de la lista y, al confirmarlo,
  // vuelve al final. No se guarda «qué hueco ocupaba»: ese índice quedaba obsoleto
  // en cuanto el coche salía de `vehicles` y acababa pisando a OTRO coche.

  // Designaciones de motor del dataset EEA (320d, 1.6 TDI) para el coche en curso.
  const [designations, setDesignations] = useState<EngineDesignation[]>([]);
  const [enginesLoading, setEnginesLoading] = useState(false);

  // Nivel operación (una sola vez, al final)
  const [timeframe, setTimeframe] = useState<string | null>(null);
  const [payment, setPayment] = useState<string | null>(null);
  const [tradeIn, setTradeIn] = useState<string | null>(null);
  const [tradeInCar, setTradeInCar] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/dealer/profile/public?slug=${slug}`)
      .then((r) => { if (!r.ok) throw new Error('not found'); return r.json(); })
      .then((data) => setDealer(data.dealer))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  // Designaciones de motor del coche en curso: marca+modelo, acotadas por la franja
  // de años de la generación elegida y el combustible. Se muestran «320d (184 CV)».
  const powerMake = draft.make?.label;
  const powerModel = draft.model?.label;
  useEffect(() => {
    if (!powerMake || !powerModel) { setDesignations([]); return; }
    let cancelled = false;
    setEnginesLoading(true);
    const qs =
      (draft.minYear != null ? `&yearFrom=${draft.minYear}` : '') +
      (draft.maxYear != null ? `&yearTo=${draft.maxYear}` : '') +
      (draft.fuel ? `&fuel=${draft.fuel}` : '');
    fetch(`/api/dealer/model-engines?make=${encodeURIComponent(powerMake)}&model=${encodeURIComponent(powerModel)}${qs}`)
      .then((r) => (r.ok ? r.json() : { engines: [] }))
      .then((d) => { if (!cancelled) setDesignations(Array.isArray(d.engines) ? d.engines : []); })
      .catch(() => { if (!cancelled) setDesignations([]); })
      .finally(() => { if (!cancelled) setEnginesLoading(false); });
    return () => { cancelled = true; };
  }, [powerMake, powerModel, draft.minYear, draft.maxYear, draft.fuel]);

  // Cambiar de combustible invalida el motor elegido (un 320d no existe en
  // gasolina), así que se limpia al cambiar.
  const pickFuel = (next: string | null) => {
    pick({ fuel: next, engines: [] });
  };

  const mustable = draft.wanted.filter((f) => !PSEUDO_FEATURES.has(f));
  const modelGenerations: Generation[] = generationsFor(draft.make?.label, draft.model?.label);

  // ¿Se muestra este paso de coche? modelo solo con marca; generación solo si el
  // modelo tiene curadas; cv (motor) necesita modelo concreto; imprescindibles,
  // equipamiento marcado.
  //
  // OJO: se calcula SOBRE UN COCHE CONCRETO (`d`), no sobre `draft`. Los pasos de
  // auto-avance deciden el siguiente paso dentro de un setTimeout y esa clausura
  // todavía ve el draft ANTERIOR al patch. Con el draft viejo, elegir marca se
  // saltaba el paso de modelo (la clausura veía make=null) y el chip de
  // carrocería —que borra la marca— aterrizaba en un modelo irrellenable.
  const stepVisibleFor = (s: Step, d: DraftCar): boolean => {
    // Sin marca no hay modelo que elegir: el cliente ya ha dicho «me da igual la
    // marca, buscadme cualquier SUV». Preguntarle el modelo era un callejón sin
    // salida — el combo salía deshabilitado y «Continuar» no se activaba nunca.
    if (s === 'modelo') return !!d.make;
    if (s === 'generacion') return generationsFor(d.make?.label, d.model?.label).length > 0;
    if (s === 'cv') return !!d.model;
    if (s === 'imprescindibles') return d.wanted.some((f) => !PSEUDO_FEATURES.has(f));
    return true;
  };
  const carStepVisible = (s: Step) => stepVisibleFor(s, draft);

  // El siguiente paso desde el actual (salta los que no aplican; al acabar la
  // ficha del coche, va al hub).
  const stepAfterFor = (s: Step, d: DraftCar): Step => {
    if (s === 'contacto') return 'marca';
    const i = CAR_STEPS.indexOf(s);
    if (i >= 0) {
      for (let j = i + 1; j < CAR_STEPS.length; j++) {
        if (stepVisibleFor(CAR_STEPS[j], d)) return CAR_STEPS[j];
      }
      return 'mas';
    }
    // El stock no tiene cliente: los pasos de plazo/pago/entrega no aplican.
    if (s === 'mas') return isStock ? 'resumen' : 'plazo';
    if (s === 'plazo') return 'resumen';
    return 'resumen';
  };
  const stepAfter = (s: Step) => stepAfterFor(s, draft);

  const go = (next: Step) => {
    setHistory((h) => [...h, step]);
    setStep(next);
    window.scrollTo({ top: 0 });
  };
  const goNext = () => go(stepAfter(step));
  const goBack = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const nh = [...h];
      const prev = nh.pop()!;
      setStep(prev);
      window.scrollTo({ top: 0 });
      return nh;
    });
  };
  // Elegir opción en un paso de auto-avance: aplica y avanza tras un instante
  // para que se vea el resaltado. El siguiente paso se calcula con el coche YA
  // parcheado — dentro del setTimeout, `draft` sigue siendo el de este render.
  const pick = (patch: Partial<DraftCar>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setTimeout(() => go(stepAfterFor(step, next)), 140);
  };

  // Cambiar de marca invalida lo que colgaba de ella: modelo, generación, motores
  // y la franja de años que salía de la generación (si no, un «BMW Serie 3 F30»
  // reeditado a Audi se quedaba como «Audi F30» con los años del F30). Volver a
  // marcar la MISMA marca no toca nada.
  const pickMake = (m: MakeOption | null) => {
    if ((m?.id ?? null) === (draft.make?.id ?? null)) { pick({ make: m }); return; }
    pick({ make: m, model: null, generation: null, engines: [], minYear: null, maxYear: null });
  };

  // Atajo «sin marca en mente»: el tipo de carrocería PASA A SER la identidad del
  // coche, así que se borra la marca y todo lo suyo, y el flujo salta el paso de
  // modelo para seguir con presupuesto (ver stepVisibleFor).
  const pickBodyType = (value: string) => {
    pick({
      make: null, model: null, generation: null, engines: [], minYear: null, maxYear: null,
      bodyType: draft.bodyType === value ? null : value,
    });
  };

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear - 1999 }, (_, i) => currentYear - i);

  const pickBand = (b: (typeof BUDGET_BANDS)[number]) => {
    upd({ maxPrice: draft.maxPrice === b.max ? null : b.max });
  };

  const toggleWanted = (f: string) =>
    setDraft((d) => {
      if (d.wanted.includes(f)) {
        return { ...d, wanted: d.wanted.filter((x) => x !== f), musts: d.musts.filter((m) => m !== f) };
      }
      return { ...d, wanted: [...d.wanted, f] };
    });
  const toggleMust = (f: string) =>
    setDraft((d) => ({ ...d, musts: d.musts.includes(f) ? d.musts.filter((m) => m !== f) : [...d.musts, f] }));
  // Motor: multi-selección (el cliente puede querer varios del mismo modelo). No
  // auto-avanza — se marcan los que quiera y luego «Continuar».
  const toggleEngine = (designation: string) =>
    setDraft((d) => ({
      ...d,
      engines: d.engines.includes(designation)
        ? d.engines.filter((x) => x !== designation)
        : [...d.engines, designation],
    }));

  const bodyLabel = (c: DraftCar): string | null =>
    (c.bodyType ? BODY_TYPES.find((b) => b.value === c.bodyType)?.label : null) ?? null;

  const carLabel = (c: DraftCar) => {
    const named = [c.make?.label, c.model?.label, c.generation, c.engines.join(' / ') || null]
      .filter(Boolean).join(' ');
    if (named) return named;
    // Sin marca, el tipo de carrocería ES la identidad del coche: «Cualquier SUV»
    // dice mucho más que un «Cualquier coche» que borraba lo único que eligió.
    const body = bodyLabel(c);
    return body ? `Cualquier ${body}` : 'Cualquier coche';
  };

  const carSpecLine = (c: DraftCar): string => {
    const p: string[] = [];
    // Con marca, la carrocería es un filtro más; sin marca ya encabeza la etiqueta.
    if (c.bodyType && c.make) p.push(bodyLabel(c) ?? '');
    if (c.maxPrice != null) p.push(`<${fmtNum(c.maxPrice)} €`);
    if (c.maxKm != null) p.push(`${(c.maxKm / 1000).toFixed(0)}k km`);
    // Con generación elegida, los años ya se ven en la etiqueta; solo se muestran
    // aquí cuando el cliente los puso a mano (modelo sin generación curada).
    if (!c.generation) {
      const yl = c.minYear != null && c.maxYear != null ? `${c.minYear}–${c.maxYear}`
        : c.minYear != null ? `desde ${c.minYear}` : c.maxYear != null ? `hasta ${c.maxYear}` : null;
      if (yl) p.push(yl);
    }
    if (c.fuel) p.push(FUELS.find((f) => f.value === c.fuel)?.label ?? '');
    if (c.transmission) p.push(TRANSMISSIONS.find((t) => t.value === c.transmission)?.label ?? '');
    return p.filter(Boolean).join(' · ') || 'Sin filtros';
  };

  // Los coches para el resumen/hub: confirmados + el draft si tiene contenido.
  const allCars = [...vehicles, ...(draftMeaningful(draft) ? [draft] : [])];

  const featureLabel = (f: string) => FEATURE_LABELS[f] ?? f;
  const niceToHave = draft.wanted.filter((f) => !draft.musts.includes(f));

  // Confirmar el coche en curso y empezar otro desde cero.
  const addAnother = () => {
    if (draftMeaningful(draft) && vehicles.length < MAX_CARS) {
      setVehicles((v) => [...v, draft]);
    }
    setDraft(emptyDraft());
    go('marca');
  };
  // Reeditar un coche ya confirmado: lo saca de la lista al draft y vuelve a marca.
  const editCar = (i: number) => {
    // El coche en curso se guarda ANTES (al final, donde el hub lo pinta): si no,
    // pulsar «editar» sobre un segundo coche perdía en silencio el que estabas
    // editando.
    const base = draftMeaningful(draft) ? [...vehicles, draft] : vehicles;
    const target = base[i];
    if (!target) return;
    setVehicles(base.filter((_, idx) => idx !== i));
    setDraft(target);
    go('marca');
  };
  const removeCar = (i: number) => setVehicles((v) => v.filter((_, idx) => idx !== i));

  async function handleSubmit() {
    if (status === 'sending') return;
    setError('');

    // Se confirma el draft en curso (si tiene contenido) junto a los ya guardados.
    const cars = [...vehicles, ...(draftMeaningful(draft) ? [draft] : [])];

    const toVehicle = (c: DraftCar): Record<string, unknown> => {
      const musts = c.musts.filter((f) => !PSEUDO_FEATURES.has(f));
      const nice = c.wanted.filter((f) => !musts.includes(f));
      return {
        make: c.make?.label,
        make_id: c.make?.id,
        model: c.model?.label,
        model_id: c.model?.id,
        model_ms: c.model?.ms,
        // Las designaciones de motor (320d, 1.6 TDI, 428i) viajan como DATO propio
        // (encabezan la recomendación con su veredicto). `variant` queda para el
        // acabado (GTI, R-Line…), que sí es un texto de búsqueda.
        engines: (() => {
          const list = c.engines.map((s) => s.trim()).filter(Boolean);
          return list.length ? list : undefined;
        })(),
        variant: c.variant.trim() || undefined,
        min_price: c.minPrice,
        max_price: c.maxPrice,
        max_km: c.maxKm,
        min_year: c.minYear,
        max_year: c.maxYear,
        // El código de chasis, no solo el rango de años que sale de él: es lo
        // que deja al análisis usar la elección del cliente como verdad en vez
        // de re-adivinar la generación por el año (ver Vehicle.generation).
        generation: c.generation || undefined,
        fuel: c.fuel,
        transmission: c.transmission,
        min_cv: c.minCv,
        drive_type: c.driveType,
        interior_type: c.interiorType,
        doors: c.doors,
        seats: c.seats,
        emission_class: c.emissionClass,
        color: c.color,
        body_type: c.bodyType || undefined,
        features: musts.length ? musts : null,
        nice_to_have: nice.length ? nice : null,
      };
    };
    const vehiclesPayload = cars.map(toVehicle);

    // Etiquetas legibles + notas de nivel operación.
    const allWanted = Array.from(new Set(cars.flatMap((c) => c.wanted)));
    const allMusts = new Set(cars.flatMap((c) => c.musts));
    const noteLines = [
      timeframe && `Plazo: ${TIMEFRAMES.find((t) => t.value === timeframe)?.label}`,
      payment && `Pago: ${PAYMENTS.find((p) => p.value === payment)?.label}`,
      tradeIn === 'si'
        ? `Entrega su coche a tasar${tradeInCar.trim() ? `: ${tradeInCar.trim()}` : ''}`
        : tradeIn && `Coche a entregar: ${TRADE_INS.find((t) => t.value === tradeIn)?.label}`,
      notes.trim(),
    ].filter(Boolean);

    // Para stock no hay cliente: el "nombre" es una etiqueta legible del coche.
    const stockLabel = cars.length ? carLabel(cars[0]) : 'Coche de stock';

    const payload: CapturePayload = {
      client_name: isStock ? stockLabel : clientName.trim(),
      client_phone: isStock ? undefined : (clientPhone.trim() || undefined),
      is_stock: isStock || undefined,
      vehicles: cars.length ? vehiclesPayload : [],
      extras: allWanted.length
        ? allWanted.map((f) => `${FEATURE_LABELS[f] ?? f}${allMusts.has(f) ? ' (imprescindible)' : ''}`)
        : undefined,
      notes: noteLines.length ? noteLines.join('\n') : undefined,
    };

    setStatus('sending');

    if (onSubmit) {
      try {
        await onSubmit(payload);
        setStatus('done');
      } catch (e) {
        setError(e instanceof Error && e.message ? e.message : 'No se pudo crear la operación.');
        setStatus('error');
      }
      return;
    }

    try {
      const res = await fetch('/api/dealer/questionnaire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, ...payload }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || 'No se pudo enviar. Inténtalo de nuevo.');
        setStatus('error');
        return;
      }
      setStatus('done');
    } catch {
      setError('No se pudo enviar. Revisa tu conexión e inténtalo de nuevo.');
      setStatus('error');
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <Loader2 className="h-8 w-8 animate-spin text-mid" />
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-ink">
        Página no encontrada
      </div>
    );
  }

  const dealerHeader = (
    <div className="flex items-center justify-center gap-3">
      {dealer?.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dealer.logo_url} alt="" className="h-10 w-10 rounded-lg object-cover" />
      ) : (
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy text-peri">
          <Car className="h-5 w-5" />
        </div>
      )}
      <span className="text-lg font-bold tracking-tight text-navy">{dealer?.business_name}</span>
    </div>
  );

  if (status === 'done' && inApp) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <Loader2 className="h-8 w-8 animate-spin text-mid" />
      </div>
    );
  }
  if (status === 'done') {
    const what = allCars.length
      ? allCars.map((c) => c.model?.label || c.make?.label || bodyLabel(c) || 'tu coche').join(' o ')
      : 'tu coche';
    return (
      <div className="flex min-h-screen flex-col bg-paper text-navy [font-family:var(--font-body)]">
        <div className="px-4 pt-8">{dealerHeader}</div>
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="w-full max-w-[440px] rounded-[16px] border border-verdict/30 bg-white p-8 text-center shadow-[0_20px_50px_rgba(4,33,82,0.08)]">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-verdict/12 text-verdict">
              <CheckCircle2 size={30} />
            </div>
            <h2 className="[font-family:var(--font-display-alt)] text-[34px] tracking-[0.02em] text-navy">
              ¡RECIBIDO!
            </h2>
            <p className="mx-auto mt-2 max-w-[330px] text-[14px] leading-[1.6] text-ink">
              {dealer?.business_name} ya está buscando <b>{what}</b>. Te escribimos en menos de 24 h.
            </p>
            {dealer?.whatsapp && (
              <a
                href={`https://wa.me/${dealer.whatsapp.replace(/\s+/g, '')}?text=${encodeURIComponent(`Hola, acabo de enviar mis preferencias de coche por el formulario web. Soy ${clientName}.`)}`}
                target="_blank"
                rel="noopener"
                className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-[10px] bg-verdict px-6 py-3 text-[15px] font-bold text-white no-underline transition-all duration-200 hover:-translate-y-0.5 hover:bg-verdict-deep"
              >
                <MessageSquare size={17} /> Hablar por WhatsApp
              </a>
            )}
          </div>
        </div>
        <PoweredBy />
      </div>
    );
  }

  const head = STEP_TITLES[step];
  const carIndex = vehicles.length + 1; // el draft es siempre el último coche
  const inCarFlow = CAR_STEPS.includes(step);
  const carStepPos = CAR_STEPS.filter(carStepVisible).indexOf(step);
  const carStepTotal = CAR_STEPS.filter(carStepVisible).length;

  // El botón principal: en pasos de auto-avance no hay (se avanza al pulsar), ni
  // en 'tipo' (sus dos opciones viven en el cuerpo y avanzan solas).
  const showPrimary = !AUTO_STEPS.has(step) && step !== 'tipo';
  const primaryLabel =
    step === 'resumen' ? submitLabel
    : step === 'plazo' ? 'Revisar'
    // Sin modelo el botón NO se bloquea (el combo ofrece «me da igual»): dice a
    // qué se avanza, para que nadie continúe creyendo que ha filtrado.
    : step === 'modelo' ? (draft.model ? 'Continuar' : `Cualquier ${draft.make?.label ?? 'modelo'}`)
    : 'Continuar';

  const canProceed =
    step === 'contacto' ? !!clientName.trim() && clientPhone.replace(/\D/g, '').length >= 6
    : true;

  return (
    <div className="relative flex min-h-screen flex-col bg-paper text-navy [font-family:var(--font-body)]">
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink transition-colors hover:bg-peri/25 hover:text-navy"
        >
          <X size={20} />
        </button>
      )}

      {dealer && <div className="px-4 pt-8">{dealerHeader}</div>}

      {/* Progreso: dentro de la ficha de un coche, la posición en esa ficha. */}
      <div className={`mx-auto w-full max-w-[520px] px-4 ${dealer ? 'mt-6' : 'mt-10'}`}>
        <div className="h-1.5 overflow-hidden rounded-full bg-peri/30">
          <div
            className="h-full rounded-full bg-navy transition-[width] duration-300"
            style={{ width: inCarFlow ? `${((carStepPos + 1) / carStepTotal) * 100}%` : step === 'resumen' ? '100%' : '92%' }}
          />
        </div>
        {inCarFlow && (
          <p className="mt-1.5 text-right [font-family:var(--font-mono)] text-[10px] uppercase tracking-[0.1em] text-mid">
            Coche {carIndex}{allCars.length > 1 || vehicles.length > 0 ? ` de ${Math.max(allCars.length, carIndex)}` : ''} · {carStepPos + 1}/{carStepTotal}
          </p>
        )}
      </div>

      <main className="flex flex-1 flex-col items-center px-4 py-6 sm:py-8">
        <div className="w-full max-w-[520px]">
          {head && (
            <div className="mb-6 text-center">
              <h1 className="[font-family:var(--font-display-alt)] text-[clamp(30px,7.5vw,44px)] leading-[0.95] tracking-[0.02em] text-navy">
                {head.title}
              </h1>
              {head.sub && (
                <p className="mx-auto mt-2 max-w-[400px] text-[14px] leading-[1.6] text-ink">{head.sub}</p>
              )}
              {inCarFlow && (carIndex > 1 || vehicles.length > 0) && (draft.make || draft.bodyType) && (
                <p className="mt-1.5 [font-family:var(--font-mono)] text-[11px] uppercase tracking-[0.1em] text-mid">
                  {carLabel(draft)}
                </p>
              )}
            </div>
          )}

          {/* ---- Tipo: cliente vs. stock (solo alta interna) ---- */}
          {step === 'tipo' && (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => { setIsStock(false); go('contacto'); }}
                className={`${opt(false)} flex items-center gap-3 !text-left !p-4`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-navy/8 text-navy"><MessageSquare size={18} /></span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-bold text-navy">Para un cliente</span>
                  <span className="block text-[12.5px] font-normal text-ink">Le buscas el coche y le pasas presupuesto.</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => { setIsStock(true); go('marca'); }}
                className={`${opt(false)} flex items-center gap-3 !text-left !p-4`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-navy/8 text-navy"><Car size={18} /></span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-bold text-navy">Para stock</span>
                  <span className="block text-[12.5px] font-normal text-ink">Un coche para tu concesionario, sin cliente todavía.</span>
                </span>
              </button>
            </div>
          )}

          {/* ---- Contacto ---- */}
          {step === 'contacto' && (
            <div className="flex flex-col gap-4">
              <div>
                <label className={LABEL} htmlFor="q2-nombre">Tu nombre *</label>
                <input
                  id="q2-nombre" required className={INPUT}
                  placeholder="Nombre y apellido" autoComplete="name"
                  value={clientName} onChange={(e) => setClientName(e.target.value)} autoFocus
                />
              </div>
              <div>
                <label className={LABEL} htmlFor="q2-telefono">Teléfono / WhatsApp *</label>
                <input
                  id="q2-telefono" type="tel" required className={INPUT}
                  placeholder="+34 600 000 000" autoComplete="tel"
                  value={clientPhone} onChange={(e) => setClientPhone(e.target.value)}
                />
                {clientPhone.length > 0 && clientPhone.replace(/\D/g, '').length < 6 && (
                  <p className="mt-1.5 text-[12px] text-ink">Escribe un teléfono válido para que podamos contactarte.</p>
                )}
              </div>
              {slug && (
                <p className="text-center text-[12px] text-ink">
                  ¿No lo tienes tan claro?{' '}
                  <Link href={`/a/${slug}`} className="font-semibold text-navy underline underline-offset-2">
                    Hazme las 7 preguntas →
                  </Link>
                </p>
              )}
            </div>
          )}

          {/* ---- Marca (auto-avance) ---- */}
          {step === 'marca' && (
            <div className="flex flex-col gap-4">
              <BrandCombobox
                id="q2-marca" options={MAKES} value={draft.make}
                placeholder="Escribe para buscar… (o «me da igual»)"
                onSelect={pickMake}
              />
              <div>
                <label className={LABEL}>
                  ¿Sin marca en mente? Dinos el tipo{' '}
                  <span className="normal-case tracking-normal text-ink/60">(opcional)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {BODY_TYPES.map((b) => (
                    <button
                      key={b.value} type="button"
                      onClick={() => pickBodyType(b.value)}
                      className={chip(draft.bodyType === b.value)}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ---- Modelo ---- */}
          {step === 'modelo' && (
            <div className="flex flex-col gap-4">
              <div>
                <label className={LABEL} htmlFor="q2-modelo">Modelo de {draft.make?.label}</label>
                {/* Este paso solo se ve con marca elegida (ver stepVisibleFor), así
                    que ni combo deshabilitado ni «elige marca primero». */}
                <BrandCombobox
                  id="q2-modelo" options={draft.make?.models ?? []} value={draft.model}
                  placeholder="Escribe para buscar… (o «me da igual»)"
                  onSelect={(m) => upd({ model: m, generation: null, engines: [], minYear: null, maxYear: null })}
                />
              </div>
              {!draft.model && (
                <p className="text-[12.5px] leading-[1.6] text-ink">
                  ¿No tienes un modelo concreto? Continúa y buscamos{' '}
                  <b className="text-navy">cualquier {draft.make?.label}</b> que encaje con el resto.
                </p>
              )}
            </div>
          )}

          {/* ---- Generación (versión) — auto-avance ---- */}
          {step === 'generacion' && (
            <div className="flex flex-col gap-2.5">
              {modelGenerations.map((g) => {
                // Rango sin solape con la generación siguiente (evita mezclar
                // E90 y F30 en 2012), tanto para buscar como para pedir los motores.
                const r = genSearchRange(modelGenerations, g);
                return (
                  <button
                    key={g.code}
                    type="button"
                    onClick={() => pick({
                      generation: g.code, engines: [],
                      minYear: r.from, maxYear: r.to,
                    })}
                    className={`${opt(draft.generation === g.code)} flex items-center justify-between !text-left`}
                  >
                    <span className="font-semibold">{g.code}</span>
                    <span className="text-[12px] opacity-70">{g.to ? `${g.from}–${g.to}` : `${g.from}+`}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => pick({ generation: null, minYear: null, maxYear: null })}
                className={`${opt(draft.generation === null, true)} w-full`}
              >
                No estoy seguro / me da igual
              </button>
            </div>
          )}

          {/* ---- Presupuesto y años ---- */}
          {step === 'presupuesto' && (
            <div className="flex flex-col gap-5">
              <div>
                <label className={LABEL} htmlFor="q2-precio-max">Presupuesto máximo</label>
                <div className="relative">
                  <input id="q2-precio-max" inputMode="numeric" className={`${INPUT} pr-8`}
                    placeholder="Sin límite" value={fmtNum(draft.maxPrice)}
                    onChange={(e) => upd({ maxPrice: parseNum(e.target.value) })} />
                  {draft.maxPrice != null && (
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] text-ink/60">€</span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {BUDGET_BANDS.map((b) => (
                    <button key={b.label} type="button" onClick={() => pickBand(b)}
                      className={`${chip(draft.maxPrice === b.max)} !min-h-8 !px-2.5 !py-1 !text-[12px]`}>
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={LABEL} htmlFor="q2-km">Kilómetros máximo</label>
                <div className="relative">
                  <input id="q2-km" inputMode="numeric" className={`${INPUT} pr-11`}
                    placeholder="Cualquiera" value={fmtNum(draft.maxKm)}
                    onChange={(e) => upd({ maxKm: parseNum(e.target.value) })} />
                  {draft.maxKm != null && (
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] text-ink/60">km</span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {KM_CHIPS.map((v) => (
                    <button key={v} type="button" onClick={() => upd({ maxKm: draft.maxKm === v ? null : v })}
                      className={`${chip(draft.maxKm === v)} !min-h-8 !px-2.5 !py-1 !text-[12px]`}>
                      {v / 1000}k km
                    </button>
                  ))}
                </div>
              </div>

              {/* El año solo se pregunta si NO se eligió generación (que ya lo fija).
                  Con generación, se muestra como recordatorio en vez de pedirlo. */}
              {draft.generation ? (
                <p className="rounded-[10px] border border-peri/40 bg-white px-3.5 py-2.5 text-[12.5px] text-ink">
                  Generación <b className="text-navy">{draft.generation}</b>
                </p>
              ) : (
                <div>
                  <label className={LABEL}>Año de matriculación</label>
                  <div className="flex gap-2.5">
                    <select id="q2-anno" aria-label="Año desde" className={INPUT}
                      value={draft.minYear ?? ''}
                      onChange={(e) => upd({ minYear: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">Desde cualquiera</option>
                      {years.map((y) => <option key={y} value={y}>Desde {y}</option>)}
                    </select>
                    <select id="q2-anno-max" aria-label="Año hasta" className={INPUT}
                      value={draft.maxYear ?? ''}
                      onChange={(e) => upd({ maxYear: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">Hasta cualquiera</option>
                      {years.map((y) => <option key={y} value={y}>Hasta {y}</option>)}
                    </select>
                  </div>
                  {draft.minYear != null && draft.maxYear != null && draft.minYear > draft.maxYear && (
                    <p className="mt-1.5 text-[12px] text-red-600">El año «desde» es posterior al «hasta» — revísalo.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ---- Combustible (auto-avance) ---- */}
          {step === 'combustible' && (
            <div className="flex flex-wrap justify-center gap-2">
              {FUELS.map((f) => (
                <button key={f.value} type="button" onClick={() => pickFuel(f.value)} className={chip(draft.fuel === f.value)}>
                  {f.label}
                </button>
              ))}
              <button type="button" onClick={() => pickFuel(null)} className={chip(draft.fuel === null)}>
                Me da igual
              </button>
            </div>
          )}

          {/* ---- Cambio (auto-avance) ---- */}
          {step === 'cambio' && (
            <div className="flex flex-wrap justify-center gap-2">
              {TRANSMISSIONS.map((t) => (
                <button key={t.value} type="button" onClick={() => pick({ transmission: t.value })} className={chip(draft.transmission === t.value)}>
                  {t.label}
                </button>
              ))}
              <button type="button" onClick={() => pick({ transmission: null })} className={chip(draft.transmission === null)}>
                Me da igual
              </button>
            </div>
          )}

          {/* ---- Motor = designación (320d, 1.6 TDI) con sus CV. Auto-avance. ---- */}
          {step === 'cv' && (
            <div className="flex flex-col gap-4">
              <p className="text-center text-[13.5px] leading-[1.55] text-ink">
                Motores del{' '}
                <span className="font-semibold text-navy">{powerMake} {powerModel}{draft.generation ? ` ${draft.generation}` : ''}</span>
                {' '}— elige el tuyo si lo sabes.
              </p>

              {enginesLoading && designations.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-10 text-[14px] text-ink">
                  <Loader2 size={17} className="animate-spin" /> Buscando los motores…
                </div>
              ) : designations.length > 0 ? (
                <>
                  <p className="text-center text-[12px] text-ink/60 -mt-1">Puedes marcar varios.</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {designations.map((e) => (
                      <button
                        key={e.designation}
                        type="button"
                        onClick={() => toggleEngine(e.designation)}
                        className={`${opt(draft.engines.includes(e.designation))} !p-3.5 flex flex-col items-center gap-0.5`}
                      >
                        <span className="text-[16px] font-bold">{e.designation}</span>
                        <span className="text-[11px] opacity-70">{e.cvs.join(' · ')} CV</span>
                      </button>
                    ))}
                  </div>
                  {draft.engines.length > 0 ? (
                    <button type="button" onClick={goNext} className={`${opt(false, true)} w-full !p-3.5`}>
                      Continuar con {draft.engines.length === 1 ? 'este motor' : `estos ${draft.engines.length} motores`}
                    </button>
                  ) : (
                    <button type="button" onClick={() => pick({ engines: [] })} className={`${opt(false, true)} w-full !p-3.5`}>
                      Me da igual el motor
                    </button>
                  )}
                </>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <p className="text-center text-[13px] leading-relaxed text-ink">
                    No tenemos los motores de este coche en la base{draft.generation ? ' (generación anterior a 2010)' : ''}. Si sabes cuál quieres, escríbelo:
                  </p>
                  <input
                    className={`${INPUT} text-center text-[18px]`}
                    placeholder="320d, 1.6 TDI, 2.0 TSI…" maxLength={40}
                    value={draft.engines[0] ?? ''}
                    onChange={(e) => upd({ engines: e.target.value.trim() ? [e.target.value] : [] })}
                  />
                  <button type="button" onClick={goNext} className={`${opt(false, true)} w-full !p-3`}>Continuar</button>
                </div>
              )}
            </div>
          )}

          {/* ---- Carrocería e interior ---- */}
          {step === 'carroceria' && (
            <div className="flex flex-col gap-5">
              {/* El paso se llama «carrocería» y no dejaba tocarla: el tipo solo se
                  podía elegir en el atajo de marca, y quien lo eligió allí no tenía
                  dónde cambiarlo sin volver atrás y perder el resto. */}
              <div>
                <label className={LABEL}>Tipo de coche</label>
                <div className="flex flex-wrap gap-2">
                  {BODY_TYPES.map((b) => (
                    <button key={b.value} type="button" onClick={() => upd({ bodyType: draft.bodyType === b.value ? null : b.value })} className={chip(draft.bodyType === b.value)}>
                      {b.label}
                    </button>
                  ))}
                  <button type="button" onClick={() => upd({ bodyType: null })} className={chip(draft.bodyType === null)}>Me da igual</button>
                </div>
              </div>
              <div>
                <label className={LABEL}>Plazas</label>
                <div className="flex flex-wrap gap-2">
                  {SEAT_OPTIONS.map((s) => (
                    <button key={s.value} type="button" onClick={() => upd({ seats: draft.seats === s.value ? null : s.value })} className={chip(draft.seats === s.value)}>
                      {s.label}
                    </button>
                  ))}
                  <button type="button" onClick={() => upd({ seats: null })} className={chip(draft.seats === null)}>Me da igual</button>
                </div>
              </div>
              <div>
                <label className={LABEL}>Puertas</label>
                <div className="flex flex-wrap gap-2">
                  {DOOR_OPTIONS.map((d) => (
                    <button key={d.value} type="button" onClick={() => upd({ doors: draft.doors === d.value ? null : d.value })} className={chip(draft.doors === d.value)}>
                      {d.label}
                    </button>
                  ))}
                  <button type="button" onClick={() => upd({ doors: null })} className={chip(draft.doors === null)}>Me da igual</button>
                </div>
              </div>
              <div>
                <label className={LABEL}>Tapicería</label>
                <div className="flex flex-wrap gap-2">
                  {INTERIOR_TYPES.map((t) => (
                    <button key={t.value} type="button" onClick={() => upd({ interiorType: draft.interiorType === t.value ? null : t.value })} className={chip(draft.interiorType === t.value)}>
                      {t.label}
                    </button>
                  ))}
                  <button type="button" onClick={() => upd({ interiorType: null })} className={chip(draft.interiorType === null)}>Me da igual</button>
                </div>
              </div>
              <div>
                <label className={LABEL}>Etiqueta medioambiental</label>
                <div className="flex flex-wrap gap-2">
                  {EMISSION_CLASSES.map((e) => (
                    <button key={e.value} type="button" onClick={() => upd({ emissionClass: draft.emissionClass === e.value ? null : e.value })} className={chip(draft.emissionClass === e.value)}>
                      {e.label}
                    </button>
                  ))}
                  <button type="button" onClick={() => upd({ emissionClass: null })} className={chip(draft.emissionClass === null)}>Me da igual</button>
                </div>
              </div>
              <div>
                <label className={LABEL}>Color preferido</label>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((c) => (
                    <button key={c.value} type="button" onClick={() => upd({ color: draft.color === c.value ? null : c.value })}
                      className={`${chip(draft.color === c.value)} inline-flex items-center gap-1.5`}>
                      <span className="h-3 w-3 rounded-full border border-black/15" style={{ backgroundColor: c.hex }} />
                      {c.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-ink/70">Lo tendremos en cuenta, pero no descartamos un buen coche por el color.</p>
              </div>
            </div>
          )}

          {/* ---- Equipamiento ---- */}
          {step === 'equipamiento' && (
            <div className="flex flex-col gap-5">
              {FEATURE_GROUPS.map((g) => (
                <div key={g.group}>
                  <label className={LABEL}>{g.group}</label>
                  <div className="flex flex-wrap gap-2">
                    {g.items.map((f) => (
                      <button key={f.value} type="button" onClick={() => toggleWanted(f.value)} className={chip(draft.wanted.includes(f.value))}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-[11.5px] leading-relaxed text-ink/70">
                Marca sin miedo: en el paso siguiente nos dices cuáles son innegociables. El resto solo sirve para elegir mejor.
              </p>
            </div>
          )}

          {/* ---- Imprescindibles ---- */}
          {step === 'imprescindibles' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                {mustable.map((f) => (
                  <button key={f} type="button" onClick={() => toggleMust(f)}
                    className={`${chip(draft.musts.includes(f))} inline-flex items-center gap-1.5`}>
                    {draft.musts.includes(f) && <CheckCircle2 size={14} />}
                    {featureLabel(f)}
                  </button>
                ))}
              </div>
              <div className="rounded-[12px] border border-peri/40 bg-white px-4 py-3">
                <p className="text-[13px] leading-[1.6] text-ink">
                  {draft.musts.length === 0 ? (
                    <>Ahora mismo <b className="text-navy">no filtramos por ningún extra</b>: te enseñaremos todos los coches que encajen y priorizaremos los que lleven lo que has marcado.</>
                  ) : (
                    <>Descartaremos cualquier coche sin <b className="text-navy">{draft.musts.map(featureLabel).join(', ')}</b>. {draft.musts.length >= 3 ? 'Son bastantes condiciones: es posible que salgan pocos coches.' : 'Con eso todavía tenemos margen.'}</>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* ---- Hub: ¿algún coche más? ---- */}
          {step === 'mas' && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                {allCars.map((c, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-[12px] border border-peri/40 bg-white px-4 py-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy/8 text-navy"><Car size={16} /></div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-navy">{carLabel(c)}</p>
                      <p className="truncate text-[12px] text-ink">{carSpecLine(c)}</p>
                    </div>
                    {i < vehicles.length && (
                      <>
                        <button type="button" onClick={() => editCar(i)} className="shrink-0 text-ink hover:text-navy" aria-label="Editar"><Pencil size={16} /></button>
                        <button type="button" onClick={() => removeCar(i)} className="shrink-0 text-ink hover:text-red-600" aria-label="Quitar"><X size={16} /></button>
                      </>
                    )}
                  </div>
                ))}
              </div>
              {allCars.length < MAX_CARS ? (
                <button type="button" onClick={addAnother}
                  className={`${opt(false, true)} inline-flex items-center justify-center gap-1.5`}>
                  <Plus size={16} /> Añadir otro coche que también me valdría
                </button>
              ) : (
                <p className="text-center text-[12px] text-ink/70">Has llegado al máximo de {MAX_CARS} coches.</p>
              )}
            </div>
          )}

          {/* ---- Plazo / pago / entrega ---- */}
          {step === 'plazo' && (
            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-2.5">
                {TIMEFRAMES.map((t) => (
                  <button key={t.value} type="button" onClick={() => setTimeframe(timeframe === t.value ? null : t.value)} className={opt(timeframe === t.value)}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div>
                <label className={LABEL}>¿Cómo lo pagarías?</label>
                <div className="flex flex-wrap gap-2">
                  {PAYMENTS.map((p) => (
                    <button key={p.value} type="button" onClick={() => setPayment(payment === p.value ? null : p.value)} className={chip(payment === p.value)}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={LABEL}>¿Entregarías tu coche actual?</label>
                <div className="flex flex-wrap gap-2">
                  {TRADE_INS.map((t) => (
                    <button key={t.value} type="button" onClick={() => setTradeIn(tradeIn === t.value ? null : t.value)} className={chip(tradeIn === t.value)}>
                      {t.label}
                    </button>
                  ))}
                </div>
                {tradeIn === 'si' && (
                  <>
                    <input className={`${INPUT} mt-2.5`} placeholder="BMW Serie 1 118d · 2017 · 98.000 km" maxLength={90}
                      value={tradeInCar} onChange={(e) => setTradeInCar(e.target.value)} />
                    <p className="mt-1.5 text-[11px] text-ink/70">Te decimos cuánto vale antes de que decidas nada.</p>
                  </>
                )}
              </div>
              <div>
                <label className={LABEL} htmlFor="q2-notas">
                  ¿Algo más? <span className="normal-case tracking-normal text-ink/60">(opcional)</span>
                </label>
                <textarea id="q2-notas" rows={3} className={`${INPUT} resize-none`}
                  placeholder="Cualquier detalle que nos ayude: uso, plazos…" maxLength={600}
                  value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </div>
          )}

          {/* ---- Resumen ---- */}
          {step === 'resumen' && (
            <div className="flex flex-col gap-3">
              {isStock ? (
                <div className="flex items-center gap-2.5 rounded-[12px] border border-navy/20 bg-navy/5 px-4 py-3">
                  <Car size={18} className="shrink-0 text-navy" />
                  <p className="text-[13.5px] font-semibold text-navy">Coche para tu stock — sin cliente</p>
                </div>
              ) : (
                <div className="divide-y divide-peri/30 overflow-hidden rounded-[12px] border border-peri/40 bg-white">
                  <SumRow label="Nombre" value={clientName || '—'} />
                  <SumRow label="Teléfono" value={clientPhone || '—'} />
                </div>
              )}

              {allCars.map((c, i) => (
                <div key={i} className="overflow-hidden rounded-[12px] border border-peri/40 bg-white px-4 py-3">
                  <p className="text-[14px] font-semibold text-navy">{carLabel(c)}</p>
                  <p className="mt-0.5 text-[12.5px] text-ink">{carSpecLine(c)}</p>
                  {c.musts.filter((f) => !PSEUDO_FEATURES.has(f)).length > 0 && (
                    <p className="mt-1 text-[12px] text-navy"><b>Innegociable:</b> {c.musts.filter((f) => !PSEUDO_FEATURES.has(f)).map(featureLabel).join(' · ')}</p>
                  )}
                  {c.wanted.filter((f) => !c.musts.includes(f)).length > 0 && (
                    <p className="mt-0.5 text-[12px] text-ink/80">Le gustaría: {c.wanted.filter((f) => !c.musts.includes(f)).map(featureLabel).join(' · ')}</p>
                  )}
                </div>
              ))}

              {(timeframe || payment || tradeIn) && (
                <div className="divide-y divide-peri/30 overflow-hidden rounded-[12px] border border-peri/40 bg-white">
                  {timeframe && <SumRow label="Plazo" value={TIMEFRAMES.find((t) => t.value === timeframe)?.label ?? ''} />}
                  {payment && <SumRow label="Pago" value={PAYMENTS.find((p) => p.value === payment)?.label ?? ''} />}
                  {tradeIn && <SumRow label="Entrego" value={tradeIn === 'si' ? (tradeInCar.trim() || 'Sí, a tasar') : TRADE_INS.find((t) => t.value === tradeIn)?.label ?? ''} />}
                </div>
              )}
              {notes.trim() && (
                <div className="rounded-[12px] border border-peri/40 bg-white px-4 py-3">
                  <p className={LABEL}>Notas</p>
                  <p className="text-[13px] leading-relaxed text-navy">{notes.trim()}</p>
                </div>
              )}
            </div>
          )}

          {status === 'error' && (
            <p className="mt-4 rounded-[10px] bg-red-50 px-3 py-2 text-[13px] font-medium text-red-600">{error}</p>
          )}
        </div>
      </main>

      {/* Navegación */}
      <div className="sticky bottom-0 border-t border-peri/40 bg-paper/95 px-4 py-4 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[520px] gap-3">
          {history.length > 0 && (
            <button type="button" onClick={goBack} aria-label="Atrás"
              className="inline-flex min-h-12 items-center justify-center rounded-[10px] border border-peri/60 bg-white px-4 text-navy transition-colors hover:border-mid">
              <ChevronLeft size={19} />
            </button>
          )}
          {/* En el hub, dos acciones ya viven en el cuerpo; el botón principal es «Continuar». */}
          {(showPrimary || step === 'mas') && (
            <div className="flex-1">
              {step === 'resumen' ? (
                <button type="button" onClick={handleSubmit} disabled={status === 'sending'}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-navy px-6 py-3 text-[15px] font-bold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-mid disabled:cursor-not-allowed disabled:opacity-60">
                  {status === 'sending' ? (<><Loader2 size={17} className="animate-spin" /> {inApp ? 'Creando…' : 'Enviando…'}</>) : (<>{submitLabel} <ArrowRight size={17} /></>)}
                </button>
              ) : step === 'mas' ? (
                <button type="button" onClick={() => go(isStock ? 'resumen' : 'plazo')}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-1.5 rounded-[10px] bg-navy px-6 py-3 text-[15px] font-bold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-mid">
                  Continuar <ChevronRight size={17} />
                </button>
              ) : (
                <button type="button" onClick={goNext} disabled={!canProceed}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-1.5 rounded-[10px] bg-navy px-6 py-3 text-[15px] font-bold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-mid disabled:cursor-not-allowed disabled:opacity-60">
                  {primaryLabel} <ChevronRight size={17} />
                </button>
              )}
            </div>
          )}
        </div>
        <p className="mt-2.5 text-center [font-family:var(--font-mono)] text-[9px] uppercase tracking-[0.1em] text-mid">
          {isStock ? 'Coche para tu stock — no lo ve ningún cliente'
            : inApp ? 'Esto es exactamente lo que ve tu cliente en tu enlace de captación'
            : 'Sin compromiso · Respuesta rápida · Impulsado por CarMentor Dealer'}
        </p>
      </div>
    </div>
  );
}

function SumRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5">
      <span className="shrink-0 [font-family:var(--font-mono)] text-[10px] font-bold uppercase tracking-[0.12em] text-mid">{label}</span>
      <span className="text-right text-[13.5px] font-medium text-navy">{value}</span>
    </div>
  );
}

function PoweredBy() {
  return (
    <footer className="px-6 pb-8 text-center [font-family:var(--font-mono)] text-[10px] uppercase tracking-[0.1em] text-mid">
      Impulsado por CarMentor Dealer
    </footer>
  );
}
