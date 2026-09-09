'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Car, Loader2, MessageSquare, ArrowRight, ChevronLeft, ChevronRight,
  Check, X, Search, Sparkles, Lock, Clock, Gift, UserRoundCheck,
  Building2, Route, Shuffle, Briefcase, Mountain, Baby, Bike, Dog,
  Wrench, Caravan, PackageX, Plug, ParkingCircle, MoveHorizontal, Signpost,
} from 'lucide-react';
import type {
  AdvisorAnswers, AdvisorProfile, Usage, KmBand, Occupants, ChildSeats,
  Cargo, Parking, Priority,
} from '@/lib/dealer/advisor-rules';

/**
 * Puerta B de la captación — el asesor de 7 preguntas.
 * Diseño en docs/mockups/dealer-captacion-dos-puertas.html (sección 04).
 *
 * Decisiones que sostienen el flujo:
 *  · NINGUNA pregunta menciona carrocería ni combustible. Se pregunta por la
 *    vida del cliente; el coche lo deduce lib/dealer/advisor-rules. Preguntarle
 *    «¿SUV o familiar?» a quien no sabe qué coche quiere no resuelve nada.
 *  · El CONTACTO va en el paso 8, no en el 1. Pedirlo antes de que el cliente
 *    sepa si esto le sirve mata la conversión; aquí ya ha invertido 7 respuestas
 *    y ve su resultado borroso detrás del formulario.
 *  · Al enviar el contacto la operación YA SE CREA. El resultado es la
 *    recompensa del cliente, no el requisito del negocio: si cierra la pestaña
 *    en la última pantalla, el dealer conserva el lead.
 */

interface DealerPublic {
  business_name: string;
  logo_url: string | null;
  whatsapp: string | null;
  phone: string | null;
}

interface AdvisorModel {
  nombre: string;
  precio_desde: number;
  precio_hasta: number;
  anos: string;
  porque: string;
}

const INPUT =
  'w-full rounded-[10px] border border-peri/50 bg-white px-3.5 py-3 text-[15px] text-navy placeholder:text-ink/45 outline-none transition-colors focus:border-mid focus:ring-2 focus:ring-mid/20';
const LABEL =
  'mb-1.5 block [font-family:var(--font-mono)] text-[10px] font-bold uppercase tracking-[0.14em] text-mid';
const CHIP_BASE =
  'min-h-10 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors duration-150';
const chip = (on: boolean) =>
  `${CHIP_BASE} ${on ? 'border-navy bg-navy text-white' : 'border-peri/60 bg-paper text-ink hover:border-mid hover:text-navy'}`;

const fmt = (n: number) => n.toLocaleString('es-ES');

/** Tarjeta de opción con icono, el patrón visual de todo el asesor. */
function Opt({
  on, icon: Icon, title, desc, onClick,
}: {
  on: boolean;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  title: string;
  desc?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-start gap-3 rounded-[11px] border p-3 text-left transition-colors duration-150 ${
        on ? 'border-navy bg-navy' : 'border-peri/50 bg-white hover:border-mid'
      }`}
    >
      {Icon && (
        <span
          className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg ${
            on ? 'bg-white/16 text-white' : 'bg-peri/22 text-navy'
          }`}
        >
          <Icon size={16} />
        </span>
      )}
      <span className="min-w-0">
        <span className={`block text-[13.8px] font-semibold leading-tight ${on ? 'text-white' : 'text-navy'}`}>
          {title}
        </span>
        {desc && (
          <span className={`mt-0.5 block text-[11.5px] leading-snug ${on ? 'text-white/72' : 'text-ink'}`}>
            {desc}
          </span>
        )}
      </span>
    </button>
  );
}

const USAGES: { value: Usage; icon: any; title: string; desc: string }[] = [
  { value: 'ciudad', icon: Building2, title: 'Ciudad, a diario', desc: 'Trayectos cortos, atascos, aparcar' },
  { value: 'carretera', icon: Route, title: 'Carretera todos los días', desc: 'Voy y vengo al trabajo lejos' },
  { value: 'mixto', icon: Shuffle, title: 'Un poco de todo', desc: 'Ciudad entre semana, viajes el finde' },
  { value: 'trabajo', icon: Briefcase, title: 'Para trabajar', desc: 'Cargo material o herramienta' },
  { value: 'finde', icon: Mountain, title: 'Segundo coche / finde', desc: 'Poco uso, escapadas' },
];

const KMS: { value: KmBand; title: string; desc: string }[] = [
  { value: 'menos-10k', title: 'Menos de 10.000', desc: 'Uso ocasional, casi todo ciudad' },
  { value: '10-20k', title: '10.000 – 20.000', desc: 'Lo normal en España' },
  { value: '20-30k', title: '20.000 – 30.000', desc: 'Bastante carretera' },
  { value: 'mas-30k', title: 'Más de 30.000', desc: 'Vivo en el coche' },
];

const OCCUPANTS: { value: Occupants; big: string; desc: string }[] = [
  { value: '1-2', big: '1–2', desc: 'Yo y poco más' },
  { value: '3-4', big: '3–4', desc: 'Pareja e hijos' },
  { value: '5', big: '5', desc: 'Familia completa' },
  { value: '6-7', big: '6–7', desc: 'Necesito 7 plazas' },
];

const CARGOS: { value: Cargo; icon: any; title: string; desc?: string }[] = [
  { value: 'nada', icon: PackageX, title: 'Nada especial', desc: 'La compra y poco más' },
  { value: 'carrito', icon: Baby, title: 'Carrito de bebé + compra' },
  { value: 'deporte', icon: Bike, title: 'Bicis, esquís, material deportivo' },
  { value: 'perro', icon: Dog, title: 'Un perro grande' },
  { value: 'trabajo', icon: Wrench, title: 'Material de trabajo' },
  { value: 'remolque', icon: Caravan, title: 'Remolque o caravana' },
];

const PARKINGS: { value: Parking; icon: any; title: string; desc?: string }[] = [
  { value: 'garaje-enchufe', icon: Plug, title: 'Garaje propio con enchufe', desc: 'O podría ponerlo' },
  { value: 'garaje-sin-enchufe', icon: ParkingCircle, title: 'Garaje, pero sin enchufe' },
  { value: 'calle-apretada', icon: MoveHorizontal, title: 'En la calle, y es apretada', desc: 'Sitios justos, calles estrechas' },
  { value: 'calle-facil', icon: Signpost, title: 'En la calle, sin problema' },
];

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'consumo', label: 'Gastar poco en gasolina' },
  { value: 'espacio', label: 'Que sea espacioso' },
  { value: 'precio', label: 'El precio más bajo' },
  { value: 'fiabilidad', label: 'Que no dé problemas' },
  { value: 'potencia', label: 'Que vaya bien de potencia' },
  { value: 'tecnologia', label: 'Tecnología y confort' },
  { value: 'valor-residual', label: 'Que no pierda valor' },
  { value: 'diseno', label: 'Que sea bonito' },
];

const BUDGETS: { label: string; min: number | null; max: number | null }[] = [
  { label: 'Menos de 10k', min: null, max: 10000 },
  { label: '10–15k', min: 10000, max: 15000 },
  { label: '15–22k', min: 15000, max: 22000 },
  { label: '22–30k', min: 22000, max: 30000 },
  { label: '30–45k', min: 30000, max: 45000 },
  { label: '45k+', min: 45000, max: null },
];

type Step = 'intro' | 'uso' | 'km' | 'plazas' | 'carga' | 'aparcar' | 'dinero' | 'prioridad' | 'contacto' | 'calculando' | 'resultado';

const QUESTION_STEPS: Step[] = ['uso', 'km', 'plazas', 'carga', 'aparcar', 'dinero', 'prioridad'];

export default function AdvisorFlow({ slug }: { slug: string }) {
  const [dealer, setDealer] = useState<DealerPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [step, setStep] = useState<Step>('intro');
  const [error, setError] = useState('');

  // Respuestas
  const [usage, setUsage] = useState<Usage | null>(null);
  const [km, setKm] = useState<KmBand | null>(null);
  const [occupants, setOccupants] = useState<Occupants | null>(null);
  const [childSeats, setChildSeats] = useState<ChildSeats>('no');
  const [cargo, setCargo] = useState<Cargo[]>([]);
  const [parking, setParking] = useState<Parking | null>(null);
  const [budget, setBudget] = useState<{ min: number | null; max: number | null } | null>(null);
  const [payment, setPayment] = useState<AdvisorAnswers['payment']>(null);
  const [tradeIn, setTradeIn] = useState<AdvisorAnswers['tradeIn']>(null);
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [timeframe, setTimeframe] = useState<AdvisorAnswers['timeframe']>(null);

  // Contacto + resultado
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [profile, setProfile] = useState<AdvisorProfile | null>(null);
  const [models, setModels] = useState<AdvisorModel[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/dealer/profile/public?slug=${slug}`)
      .then((r) => {
        if (!r.ok) throw new Error('not found');
        return r.json();
      })
      .then((d) => setDealer(d.dealer))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  const qIndex = QUESTION_STEPS.indexOf(step);
  const isQuestion = qIndex >= 0;

  const go = (s: Step) => { setStep(s); window.scrollTo({ top: 0 }); };
  const next = () => { if (qIndex >= 0 && qIndex < QUESTION_STEPS.length - 1) go(QUESTION_STEPS[qIndex + 1]); else if (step === 'prioridad') go('contacto'); };
  const back = () => {
    if (step === 'contacto') return go('prioridad');
    if (qIndex > 0) return go(QUESTION_STEPS[qIndex - 1]);
    if (qIndex === 0) return go('intro');
  };

  // Auto-avance en las preguntas de opción única: se ve la selección y salta.
  const pickAndGo = (apply: () => void) => {
    apply();
    setTimeout(next, 190);
  };

  const toggleCargo = (c: Cargo) =>
    setCargo((xs) => {
      // "Nada especial" es excluyente: marcarlo limpia el resto y viceversa.
      if (c === 'nada') return xs.includes('nada') ? [] : ['nada'];
      const without = xs.filter((x) => x !== 'nada');
      return without.includes(c) ? without.filter((x) => x !== c) : [...without, c];
    });

  const togglePriority = (p: Priority) =>
    setPriorities((xs) => {
      if (xs.includes(p)) return xs.filter((x) => x !== p);
      if (xs.length >= 2) return [xs[1], p]; // sustituye la más antigua
      return [...xs, p];
    });

  const phoneValid = clientPhone.replace(/\D/g, '').length >= 6;
  const canSubmit = !!clientName.trim() && phoneValid;

  const canAdvance =
    step === 'uso' ? !!usage
    : step === 'km' ? !!km
    : step === 'plazas' ? !!occupants
    : step === 'aparcar' ? !!parking
    : true;

  async function submit() {
    if (!canSubmit) return;
    setError('');
    go('calculando');

    const answers: AdvisorAnswers = {
      usage: usage!, km: km!, occupants: occupants!, childSeats,
      cargo, parking: parking!,
      minPrice: budget?.min ?? null,
      maxPrice: budget?.max ?? null,
      payment, tradeIn, priorities, timeframe,
    };

    try {
      const res = await fetch('/api/dealer/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          client_name: clientName.trim(),
          client_phone: clientPhone.trim(),
          answers,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'No se pudo calcular tu resultado. Inténtalo de nuevo.');
        go('contacto');
        return;
      }
      setProfile(data.profile);
      setModels(Array.isArray(data.models) ? data.models : []);
      setRequestId(data.request_id ?? null);
      go('resultado');
    } catch {
      setError('No se pudo enviar. Revisa tu conexión e inténtalo de nuevo.');
      go('contacto');
    }
  }

  async function confirmInterest() {
    if (confirmed || !requestId) return;
    setConfirmed(true);
    try {
      await fetch('/api/dealer/advisor/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, request_id: requestId }),
      });
    } catch {
      // La operación ya está creada; que esto falle no le quita nada al cliente.
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

  const header = (
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

  const H1 = ({ children }: { children: React.ReactNode }) => (
    <h1 className="[font-family:var(--font-display-alt)] text-center text-[clamp(30px,8vw,42px)] leading-[0.95] tracking-[0.02em] text-navy">
      {children}
    </h1>
  );
  const Sub = ({ children }: { children: React.ReactNode }) => (
    <p className="mx-auto mt-2.5 max-w-[400px] text-center text-[13.5px] leading-[1.6] text-ink">{children}</p>
  );

  return (
    <div className="flex min-h-screen flex-col bg-paper text-navy [font-family:var(--font-body)]">
      <div className="px-4 pt-8">{header}</div>

      {isQuestion && (
        <div className="mx-auto mt-6 w-full max-w-[520px] px-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-peri/30">
            <div
              className="h-full rounded-full bg-navy transition-[width] duration-300"
              style={{ width: `${((qIndex + 1) / QUESTION_STEPS.length) * 100}%` }}
            />
          </div>
          <p className="mt-1.5 text-right [font-family:var(--font-mono)] text-[10px] uppercase tracking-[0.1em] text-mid">
            {qIndex + 1} / {QUESTION_STEPS.length}
          </p>
        </div>
      )}

      <main className="flex flex-1 flex-col items-center px-4 py-6 sm:py-8">
        <div className="w-full max-w-[520px]">

          {step === 'intro' && (
            <div className="flex flex-col justify-center py-6">
              <H1>NO SABES QUÉ<br />COCHE COMPRAR.<br />NORMAL.</H1>
              <Sub>
                Contéstanos 7 preguntas sobre tu día a día — nada técnico — y te decimos qué tipo de
                coche te encaja y tres modelos concretos.
              </Sub>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <span className={chip(false)}><Clock size={13} className="mr-1 inline" /> 60 segundos</span>
                <span className={chip(false)}><UserRoundCheck size={13} className="mr-1 inline" /> Sin registro</span>
                <span className={chip(false)}><Gift size={13} className="mr-1 inline" /> Gratis</span>
              </div>
              <p className="mt-7 text-center text-[12px] text-ink">
                ¿Ya sabes qué modelo quieres?{' '}
                <Link href={`/q/${slug}`} className="font-semibold text-navy underline underline-offset-2">
                  Ve directo al formulario →
                </Link>
              </p>
            </div>
          )}

          {step === 'uso' && (
            <>
              <H1>¿PARA QUÉ LO VAS A USAR?</H1>
              <Sub>Lo que hagas la mayoría de los días</Sub>
              <div className="mt-6 grid gap-2.5">
                {USAGES.map((u) => (
                  <Opt key={u.value} on={usage === u.value} icon={u.icon} title={u.title} desc={u.desc}
                    onClick={() => pickAndGo(() => setUsage(u.value))} />
                ))}
              </div>
            </>
          )}

          {step === 'km' && (
            <>
              <H1>¿CUÁNTOS KILÓMETROS<br />HACES AL AÑO?</H1>
              <Sub>A ojo vale. Si no lo sabes, piensa cuánto conduces al día.</Sub>
              <div className="mt-6 grid gap-2.5">
                {KMS.map((k) => (
                  <Opt key={k.value} on={km === k.value} title={k.title} desc={k.desc}
                    onClick={() => pickAndGo(() => setKm(k.value))} />
                ))}
              </div>
              <p className="mt-5 text-center text-[11.5px] text-ink/75">
                La media en España son 12.000 km/año.
              </p>
            </>
          )}

          {step === 'plazas' && (
            <>
              <H1>¿CUÁNTOS VAIS<br />NORMALMENTE?</H1>
              <Sub>Sin contar el día que llevas a media familia</Sub>
              <div className="mt-6 grid grid-cols-2 gap-2.5">
                {OCCUPANTS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setOccupants(o.value)}
                    className={`rounded-[11px] border p-3.5 text-center transition-colors duration-150 ${
                      occupants === o.value ? 'border-navy bg-navy' : 'border-peri/50 bg-white hover:border-mid'
                    }`}
                  >
                    <span className={`block [font-family:var(--font-display-alt)] text-[26px] leading-none tracking-[0.02em] ${occupants === o.value ? 'text-white' : 'text-navy'}`}>
                      {o.big}
                    </span>
                    <span className={`mt-1 block text-[11.5px] ${occupants === o.value ? 'text-white/72' : 'text-ink'}`}>
                      {o.desc}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-6">
                <span className={LABEL}>¿Sillitas de niño?</span>
                <div className="flex flex-wrap gap-2">
                  {([['no', 'No'], ['una', 'Una'], ['dos-o-mas', 'Dos o más']] as [ChildSeats, string][]).map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setChildSeats(v)} className={chip(childSeats === v)}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 'carga' && (
            <>
              <H1>¿QUÉ SUELES<br />METER DENTRO?</H1>
              <Sub>Marca todo lo que te pase de verdad</Sub>
              <div className="mt-6 grid gap-2.5">
                {CARGOS.map((c) => (
                  <Opt key={c.value} on={cargo.includes(c.value)} icon={c.icon} title={c.title} desc={c.desc}
                    onClick={() => toggleCargo(c.value)} />
                ))}
              </div>
            </>
          )}

          {step === 'aparcar' && (
            <>
              <H1>¿DÓNDE LO APARCAS?</H1>
              <Sub>Decide dos cosas: el tamaño que te cabe y si un eléctrico tiene sentido para ti</Sub>
              <div className="mt-6 grid gap-2.5">
                {PARKINGS.map((p) => (
                  <Opt key={p.value} on={parking === p.value} icon={p.icon} title={p.title} desc={p.desc}
                    onClick={() => pickAndGo(() => setParking(p.value))} />
                ))}
              </div>
            </>
          )}

          {step === 'dinero' && (
            <>
              <H1>¿CUÁNTO TE QUIERES<br />GASTAR?</H1>
              <Sub>Un rango orientativo. Podemos ajustarlo después.</Sub>

              <div className="mt-6 rounded-[14px] border border-peri/50 bg-gradient-to-b from-peri/14 to-transparent p-4 text-center">
                <span className="[font-family:var(--font-mono)] text-[9px] font-bold uppercase tracking-[0.16em] text-mid">
                  Tu rango
                </span>
                <p className="mt-1.5 [font-family:var(--font-display-alt)] text-[34px] leading-none tracking-[0.02em] text-navy">
                  {budget
                    ? budget.min != null && budget.max != null
                      ? `${fmt(budget.min)} – ${fmt(budget.max)} €`
                      : budget.max != null ? `hasta ${fmt(budget.max)} €` : `${fmt(budget.min!)} € o más`
                    : 'Sin definir'}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {BUDGETS.map((b) => (
                  <button
                    key={b.label}
                    type="button"
                    onClick={() => setBudget(budget?.min === b.min && budget?.max === b.max ? null : { min: b.min, max: b.max })}
                    className={chip(budget?.min === b.min && budget?.max === b.max)}
                  >
                    {b.label}
                  </button>
                ))}
              </div>

              <div className="mt-6">
                <span className={LABEL}>¿Contado o financiado?</span>
                <div className="flex flex-wrap gap-2">
                  {([['contado', 'Contado'], ['financiado', 'Financiado'], ['no-lo-se', 'Aún no lo sé']] as const).map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setPayment(payment === v ? null : v)} className={chip(payment === v)}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5">
                <span className={LABEL}>¿Entregarías tu coche actual?</span>
                <div className="flex flex-wrap gap-2">
                  {([['si', 'Sí, a tasar'], ['no', 'No'], ['sin-coche', 'No tengo coche']] as const).map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setTradeIn(tradeIn === v ? null : v)} className={chip(tradeIn === v)}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 'prioridad' && (
            <>
              <H1>¿QUÉ ES LO QUE MÁS<br />TE IMPORTA?</H1>
              <Sub>Elige solo dos — obligarte a elegir es lo que hace bueno el resultado</Sub>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {PRIORITIES.map((p) => (
                  <button key={p.value} type="button" onClick={() => togglePriority(p.value)} className={chip(priorities.includes(p.value))}>
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="mt-5 text-center text-[11.5px] text-ink/75">
                {priorities.length} de 2 seleccionados
              </p>
            </>
          )}

          {step === 'contacto' && (
            <div className="flex flex-col justify-center">
              <div className="mb-1 text-center"><Sparkles size={28} className="inline text-verdict" /></div>
              <H1>TU RESULTADO<br />ESTÁ LISTO</H1>
              <Sub>Dinos cómo te lo enviamos y lo ves ahora mismo</Sub>

              <div className="mt-5 flex flex-col gap-3.5">
                <div>
                  <label className={LABEL} htmlFor="adv-nombre">Tu nombre *</label>
                  <input id="adv-nombre" className={INPUT} placeholder="Nombre" autoComplete="name"
                    value={clientName} onChange={(e) => setClientName(e.target.value)} autoFocus />
                </div>
                <div>
                  <label className={LABEL} htmlFor="adv-tel">Teléfono / WhatsApp *</label>
                  <input id="adv-tel" type="tel" className={INPUT} placeholder="+34 600 000 000" autoComplete="tel"
                    value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} />
                </div>
                <div>
                  <span className={LABEL}>¿Para cuándo lo querrías? <span className="normal-case tracking-normal text-ink/60">(opcional)</span></span>
                  <div className="flex flex-wrap gap-2">
                    {([['ya', 'Ya'], ['1-3-meses', '1–3 meses'], ['sin-prisa', 'Sin prisa']] as const).map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setTimeframe(timeframe === v ? null : v)} className={chip(timeframe === v)}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Teaser: el premio se ve, no se promete. */}
              <div className="relative mt-5 overflow-hidden rounded-[13px] border border-peri/45 bg-white">
                <div className="select-none p-3.5 blur-[7px]" aria-hidden>
                  <p className="text-center [font-family:var(--font-mono)] text-[9px] uppercase tracking-[0.16em] text-verdict-deep">
                    Tu coche ideal
                  </p>
                  <p className="mt-1 text-center [font-family:var(--font-display-alt)] text-[24px] leading-none text-navy">
                    SUV COMPACTO DIÉSEL
                  </p>
                  <div className="mt-2 flex justify-center gap-1.5">
                    {['Modelo uno', 'Modelo dos', 'Modelo tres'].map((m) => (
                      <span key={m} className="rounded-full bg-navy px-3 py-1 text-[11px] text-white">{m}</span>
                    ))}
                  </div>
                </div>
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gradient-to-b from-paper/10 to-paper/70">
                  <Lock size={19} className="text-navy" />
                  <span className="[font-family:var(--font-mono)] text-[9px] font-bold uppercase tracking-[0.12em] text-navy">
                    A un paso
                  </span>
                </div>
              </div>

              <p className="mt-3 text-center text-[11px] leading-relaxed text-ink/75">
                {dealer?.business_name} te escribirá solo para ayudarte con la búsqueda. Nada de spam.
              </p>
            </div>
          )}

          {step === 'calculando' && (
            <div className="flex flex-col items-center justify-center py-10">
              <div className="mb-5 h-10 w-10 animate-spin rounded-full border-[3px] border-peri/40 border-t-navy" />
              <H1>CALCULANDO<br />TU RESULTADO</H1>
              <div className="mt-5 flex w-full max-w-[280px] flex-col gap-2.5">
                <CalcLine done>Analizado tu uso y tus kilómetros</CalcLine>
                <CalcLine done>Cruzados maletero, plazas y aparcamiento</CalcLine>
                <CalcLine>Eligiendo 3 modelos en tu presupuesto…</CalcLine>
              </div>
            </div>
          )}

          {step === 'resultado' && profile && (
            <div>
              <div className="rounded-[14px] border border-verdict/30 bg-gradient-to-b from-verdict/9 to-transparent p-4 text-center">
                <span className="[font-family:var(--font-mono)] text-[9px] font-bold uppercase tracking-[0.16em] text-verdict-deep">
                  Tu coche ideal
                </span>
                <p className="mt-1.5 [font-family:var(--font-display-alt)] text-[32px] uppercase leading-[0.98] tracking-[0.02em] text-navy">
                  {profile.headline}
                </p>
                <div className="mt-3.5 grid grid-cols-2 gap-1.5">
                  <Spec k="Carrocería" v={profile.bodyLabel} />
                  <Spec k="Combustible" v={profile.fuelLabel} />
                  <Spec k="Plazas" v={String(profile.seats)} />
                  <Spec
                    k="Presupuesto"
                    v={profile.maxPrice
                      ? `${profile.minPrice ? `${fmt(profile.minPrice)}–` : 'hasta '}${fmt(profile.maxPrice)} €`
                      : 'Abierto'}
                  />
                </div>
              </div>

              <div className="mt-4 grid gap-2">
                {profile.reasons.map((r, i) => (
                  <div key={i} className="flex gap-2 text-[12.3px] leading-[1.45] text-ink">
                    <Check size={15} className="mt-0.5 shrink-0 text-verdict" />
                    <span>{r}</span>
                  </div>
                ))}
                {profile.ruledOut.map((r, i) => (
                  <div key={`x${i}`} className="flex gap-2 text-[12.3px] leading-[1.45] text-ink">
                    <X size={15} className="mt-0.5 shrink-0 text-amber-600" />
                    <span>{r}</span>
                  </div>
                ))}
              </div>

              {models.length > 0 ? (
                <div className="mt-6">
                  <span className={LABEL}>Tres que te encajan</span>
                  {models.map((m) => (
                    <div key={m.nombre} className="mt-2 flex gap-3 rounded-[11px] border border-peri/45 bg-white p-2.5">
                      <span className="flex h-[44px] w-[56px] shrink-0 items-center justify-center rounded-[7px] bg-peri/25 text-mid">
                        <Car size={20} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13.5px] font-bold leading-tight text-navy">{m.nombre}</p>
                        {(m.precio_desde > 0 || m.anos) && (
                          <p className="mt-0.5 [font-family:var(--font-mono)] text-[10.5px] font-bold text-verdict-deep">
                            {m.precio_desde > 0 && `${fmt(m.precio_desde)} – ${fmt(m.precio_hasta)} €`}
                            {m.precio_desde > 0 && m.anos && ' · '}
                            {m.anos}
                          </p>
                        )}
                        <p className="mt-1 text-[11.3px] leading-snug text-ink">{m.porque}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-6 rounded-[11px] border border-peri/45 bg-white px-4 py-3 text-[12.5px] leading-relaxed text-ink">
                  {dealer?.business_name} te propondrá modelos concretos que encajen en este perfil cuando
                  te contacte.
                </p>
              )}

              <p className="mt-4 text-center text-[10.5px] leading-relaxed text-ink/70">
                Orientativo. {dealer?.business_name} lo afinará contigo antes de buscar nada.
              </p>
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-[10px] bg-red-50 px-3 py-2 text-[13px] font-medium text-red-600">
              {error}
            </p>
          )}
        </div>
      </main>

      {step !== 'calculando' && (
        <div className="sticky bottom-0 border-t border-peri/40 bg-paper/95 px-4 py-4 backdrop-blur-sm">
          <div className="mx-auto max-w-[520px]">
            {step === 'intro' && (
              <button type="button" onClick={() => go('uso')} className={PRIMARY}>
                Empezar <ArrowRight size={17} />
              </button>
            )}

            {isQuestion && (
              <div className="flex gap-3">
                <button type="button" onClick={back} aria-label="Atrás"
                  className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-[10px] border border-peri/60 bg-white px-4 text-navy transition-colors hover:border-mid">
                  <ChevronLeft size={19} />
                </button>
                <button type="button" onClick={next} disabled={!canAdvance} className={`${PRIMARY} flex-1`}>
                  {step === 'prioridad' ? 'Ver mi resultado' : 'Siguiente'} <ChevronRight size={17} />
                </button>
              </div>
            )}

            {step === 'contacto' && (
              <div className="flex gap-3">
                <button type="button" onClick={back} aria-label="Atrás"
                  className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-[10px] border border-peri/60 bg-white px-4 text-navy transition-colors hover:border-mid">
                  <ChevronLeft size={19} />
                </button>
                <button type="button" onClick={submit} disabled={!canSubmit} className={`${PRIMARY} ${GREEN} flex-1`}>
                  Ver mi coche ideal <ArrowRight size={17} />
                </button>
              </div>
            )}

            {step === 'resultado' && (
              <>
                <button type="button" onClick={confirmInterest} disabled={confirmed} className={`${PRIMARY} ${GREEN}`}>
                  {confirmed ? (
                    <><Check size={17} /> Hecho — te contactamos enseguida</>
                  ) : (
                    <><Search size={17} /> Que me busquen estas opciones</>
                  )}
                </button>
                {dealer?.whatsapp && (
                  <a
                    href={`https://wa.me/${dealer.whatsapp.replace(/\s+/g, '')}?text=${encodeURIComponent(`Hola, acabo de hacer el test de coche ideal. Soy ${clientName} y me sale: ${profile?.headline ?? ''}.`)}`}
                    target="_blank"
                    rel="noopener"
                    className="mt-2 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-peri/60 bg-white px-6 text-[15px] font-bold text-navy no-underline transition-colors hover:border-mid"
                  >
                    <MessageSquare size={17} /> Hablar con {dealer.business_name}
                  </a>
                )}
              </>
            )}

            <p className="mt-2.5 text-center [font-family:var(--font-mono)] text-[9px] uppercase tracking-[0.1em] text-mid">
              Gratis · Sin compromiso · Impulsado por CarMentor Dealer
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

const PRIMARY =
  'inline-flex min-h-12 w-full items-center justify-center gap-1.5 rounded-[10px] bg-navy px-6 py-3 text-[15px] font-bold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-mid disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0';
const GREEN = '!bg-verdict hover:!bg-verdict-deep';

function Spec({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-[9px] border border-peri/45 bg-white p-2 text-left">
      <p className="[font-family:var(--font-mono)] text-[8.5px] uppercase tracking-[0.12em] text-mid">{k}</p>
      <p className="mt-0.5 text-[13px] font-bold text-navy">{v}</p>
    </div>
  );
}

function CalcLine({ children, done = false }: { children: React.ReactNode; done?: boolean }) {
  return (
    <div className={`flex items-start gap-2 text-[13px] leading-[1.45] ${done ? 'text-ink' : 'text-ink/55'}`}>
      {done
        ? <Check size={15} className="mt-0.5 shrink-0 text-verdict" />
        : <Loader2 size={15} className="mt-0.5 shrink-0 animate-spin text-mid" />}
      <span>{children}</span>
    </div>
  );
}
