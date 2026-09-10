import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight,
  BarChart3,
  Gauge,
  FileText,
  ClipboardCheck,
  MapPin,
  Search,
  Euro,
  LayoutList,
  Camera,
  Check,
  Stamp,
  FileSignature,
} from 'lucide-react';
import ScrollReveal from '@/components/motion/ScrollReveal';
import StaggerChildren, { StaggerItem } from '@/components/motion/StaggerChildren';
import DealerInterestForm from '@/components/dealer/DealerInterestForm';
import DealerAtmosphere from '@/components/dealer/DealerAtmosphere';

const STAGES = [
  { label: 'Solicitud', sub: 'wishlist del cliente', money: false },
  { label: 'Búsqueda', sub: 'análisis IA', money: false },
  { label: 'Propuesta', sub: 'presupuesto', money: true },
  { label: 'Acuerdo', sub: 'precio + ETA', money: false },
  { label: 'Runner', sub: 'inspección + fotos', money: false },
  { label: 'Tránsito', sub: 'seguimiento', money: false },
  { label: 'Trámites', sub: '576 · IVTM · ficha', money: true },
  { label: 'Entrega', sub: 'margen real', money: true },
];

const PROBLEMS = [
  {
    n: '+2.000€',
    t: 'Un solo coche malo',
    d: 'Importar a ciegas desde mobile.de: un fallo de motor o un margen mal calculado se come el beneficio de varios coches.',
  },
  {
    n: 'Horas',
    t: 'Presupuestos a mano',
    d: 'Buscar, comparar mercado, cuadrar costes de importación y montar el presupuesto: un trabajo manual repetido en cada operación.',
  },
  {
    n: 'Sin guion',
    t: 'El chico que sube a por el coche',
    d: 'El runner viaja a Alemania sin checklist ni forma de dejar prueba de lo que vio antes de comprar.',
  },
];

const FEATURES = [
  {
    icon: BarChart3,
    hi: true,
    tag: 'clave',
    title: 'Análisis IA del anuncio',
    desc: 'Rentabilidad estimada, valor de mercado español real de coches.net y fiabilidad del modelo, en segundos, sobre cualquier link.',
  },
  {
    icon: Gauge,
    title: 'Motor recomendado por modelo',
    desc: 'Qué motorización comprar y cuál evitar, con el fallo típico de cada una. Afina la búsqueda al combustible correcto.',
  },
  {
    icon: FileText,
    title: 'Presupuesto de marca en PDF',
    desc: 'Tu logo, tus datos, costes de importación cuadrados: un presupuesto profesional listo para enviar en un clic.',
  },
  {
    icon: ClipboardCheck,
    hi: true,
    tag: 'diferencial',
    title: 'La revisión del runner',
    desc: 'Checklist IA por fases en el móvil, fotos de prueba, km reales, precio negociado y veredicto comprar / no comprar.',
  },
  {
    icon: Stamp,
    hi: true,
    tag: 'lo hacemos nosotros',
    title: 'Impuestos pagados por nuestro gestor',
    desc: 'Modelo 576 y IVTM presentados y pagados por nosotros, con el 576 estimado antes de encargarlo. Tú no pisas Hacienda ni el ayuntamiento.',
  },
  {
    icon: FileSignature,
    title: 'Ficha técnica reducida firmada',
    desc: 'Nuestro ingeniero la firma con las fotos que tu runner ya sacó en la inspección. Sin COC, sin una segunda visita al coche.',
  },
  {
    icon: MapPin,
    title: 'Seguimiento para el cliente',
    desc: '«Tu coche va de camino»: línea de tiempo, prueba de inspección con fotos y emails de marca en cada hito.',
  },
  {
    icon: Search,
    title: 'Banco de sourcing',
    desc: 'Analiza coches para stock sin cliente asociado. Guarda los buenos en tu watchlist y promuévelos a operación cuando toque.',
  },
  {
    icon: Euro,
    title: 'Precisión económica',
    desc: 'Compra en neto MwSt para importaciones deducibles y comparables solo de profesionales: el margen que ves es el que trades.',
  },
  {
    icon: LayoutList,
    title: 'Pipeline de operaciones',
    desc: 'Todos tus tratos en un tablero: la cola «te esperan» con la siguiente acción ya decidida y el margen del mes de un vistazo.',
  },
];

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div className="[font-family:var(--font-mono)] mb-3 text-[11px] uppercase tracking-[0.16em] text-mid">
      {children}
    </div>
  );
}

export default function DealerLandingPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden text-navy [font-family:var(--font-body)]">
      <DealerAtmosphere />

      {/* ---------- Topbar (borrowed from the consumer landing) ---------- */}
      <nav className="sticky top-0 z-50 border-b border-[#AABEF5]/40 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[56px] max-w-[1200px] items-center justify-between px-4 sm:h-[60px] sm:px-6">
          <Link href="/dealer" className="flex shrink-0 items-center gap-2 no-underline">
            <Image
              src="/logo_mentor.png"
              alt="CarMentor"
              width={32}
              height={32}
              className="object-contain"
            />
            <span className="text-[18px] font-bold tracking-[0.01em] text-navy sm:text-[22px]">
              CarMentor
            </span>
            <span className="rounded-md bg-navy px-1.5 py-0.5 [font-family:var(--font-mono)] text-[10px] font-bold uppercase tracking-[0.1em] text-peri">
              Dealer
            </span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/"
              className="hidden text-[13px] font-medium text-mid no-underline transition-colors duration-150 hover:text-navy sm:inline-flex"
            >
              Para particulares
            </Link>
            <Link
              href="/login?redirect=/dealer/operaciones"
              className="hidden rounded-lg px-3 py-2 text-[13px] font-medium text-mid no-underline transition-colors duration-150 hover:text-navy md:inline-flex"
            >
              Iniciar sesión
            </Link>
            <a
              href="#solicitar"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-navy px-4 py-2.5 text-[13px] font-bold text-white no-underline transition-all duration-200 hover:-translate-y-px hover:bg-mid"
            >
              Solicitar acceso
            </a>
          </div>
        </div>
      </nav>

      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden px-4 pt-16 pb-16 sm:px-6 sm:pt-24 sm:pb-24">
        <div className="relative z-10 mx-auto max-w-[900px] text-center">
          <ScrollReveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-peri/70 bg-white/80 px-3.5 py-1.5 [font-family:var(--font-mono)] text-[10px] font-bold uppercase tracking-[0.12em] text-mid shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-verdict" />
              Para compraventas que importan de Alemania
            </span>
          </ScrollReveal>
          <ScrollReveal delay={0.08}>
            <h1 className="[font-family:var(--font-display-alt)] mx-auto mt-6 max-w-[820px] text-[clamp(44px,11vw,84px)] leading-[0.9] tracking-[0.02em] text-navy">
              EL SISTEMA OPERATIVO DE TU
              <span className="block text-mid">COMPRAVENTA DE IMPORTACIÓN</span>
            </h1>
          </ScrollReveal>
          <ScrollReveal delay={0.16}>
            <p className="mx-auto mt-6 max-w-[620px] text-[15px] leading-[1.65] text-ink sm:text-[18px]">
              De la solicitud del cliente a las llaves en tu campa: una sola herramienta, guiada por
              IA, que conduce cada operación de Alemania a España de principio a fin — impuestos y
              ficha técnica incluidos, que los hacemos nosotros.
            </p>
          </ScrollReveal>
          <ScrollReveal delay={0.24}>
            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <a
                href="#solicitar"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[10px] bg-navy px-7 py-3.5 text-[15px] font-bold text-white shadow-[0_10px_28px_rgba(4,33,82,0.2)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-mid"
              >
                Solicitar acceso <ArrowRight size={17} />
              </a>
              <a
                href="#como-funciona"
                className="inline-flex min-h-12 items-center justify-center rounded-[10px] border border-peri/70 bg-white/75 px-7 py-3.5 text-[15px] font-semibold text-navy transition-all duration-200 hover:border-mid hover:bg-surface"
              >
                Ver cómo funciona
              </a>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ---------- Problem strip ---------- */}
      <section className="border-y border-peri/30 bg-paper/75 px-4 py-10 sm:px-6 sm:py-14">
        <div className="mx-auto grid max-w-[1100px] gap-8 sm:grid-cols-3">
          {PROBLEMS.map((p) => (
            <ScrollReveal key={p.t}>
              <div>
                <div className="[font-family:var(--font-display-alt)] text-[38px] leading-none tracking-[0.02em] text-peri">
                  {p.n}
                </div>
                <div className="mt-2 text-[15px] font-bold text-navy">{p.t}</div>
                <p className="mt-1.5 text-[13.5px] leading-[1.55] text-ink">{p.d}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* ---------- Cómo funciona: el viaje ---------- */}
      <section id="como-funciona" className="bg-white/65 px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-[1100px]">
          <ScrollReveal className="mb-8">
            <Kicker>Cómo funciona</Kicker>
            <h2 className="[font-family:var(--font-display-alt)] text-[clamp(34px,8vw,58px)] leading-[0.95] tracking-[0.02em] text-navy">
              CADA OPERACIÓN ES UN VIAJE.
            </h2>
            <p className="mt-4 max-w-[560px] text-[15px] leading-[1.65] text-ink">
              CarMentor conduce el trato entero por el mismo carril: sin fugas de margen, sin pasos a
              mano, sin cabos sueltos entre Múnich y Valencia.
            </p>
          </ScrollReveal>

          <ScrollReveal delay={0.1}>
            <div className="rounded-[16px] border border-peri/40 bg-paper p-5 sm:p-7">
              <div className="mb-4 flex justify-between [font-family:var(--font-mono)] text-[9px] uppercase tracking-[0.12em] text-mid sm:text-[10px]">
                <span>🇩🇪 Alemania · mobile.de</span>
                <span>🇪🇸 España · entrega</span>
              </div>
              <div
                className="overflow-x-auto overflow-y-hidden pt-2 [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] sm:[mask-image:none]"
              >
                <div className="min-w-[640px]">
                  <div className="h-[3px] rounded-full bg-gradient-to-r from-peri via-mid to-verdict" />
                  <div className="mt-4 flex justify-between">
                    {STAGES.map((s) => (
                      <div key={s.label} className="relative flex-1 px-1 text-center">
                        <span
                          className={`absolute -top-[26px] left-1/2 h-[13px] w-[13px] -translate-x-1/2 rounded-full border-[3px] bg-white ${
                            s.money ? 'border-verdict bg-verdict' : 'border-mid'
                          }`}
                        />
                        <div className="text-[11px] font-bold text-navy">{s.label}</div>
                        <div className="mt-0.5 text-[9.5px] leading-tight text-ink">{s.sub}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <p className="mt-2 text-center [font-family:var(--font-mono)] text-[9px] uppercase tracking-[0.1em] text-mid sm:hidden">
                Desliza para ver todas las etapas →
              </p>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* ---------- Features ---------- */}
      <section className="bg-paper/75 px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-[1100px]">
          <ScrollReveal className="mb-9">
            <Kicker>Todo en una herramienta</Kicker>
            <h2 className="[font-family:var(--font-display-alt)] max-w-[720px] text-[clamp(34px,8vw,58px)] leading-[0.95] tracking-[0.02em] text-navy">
              LO QUE NECESITAS PARA IMPORTAR SIN COMERTE UN COCHE MALO.
            </h2>
          </ScrollReveal>

          <StaggerChildren className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <StaggerItem key={f.title}>
                  <div className="flex h-full gap-3.5 rounded-[12px] border border-peri/35 bg-white p-4 sm:p-5">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] ${
                        f.hi ? 'bg-navy text-peri' : 'bg-surface text-mid'
                      }`}
                    >
                      <Icon size={19} />
                    </div>
                    <div>
                      <h3 className="text-[15.5px] font-bold leading-tight text-navy">
                        {f.title}
                        {f.tag && (
                          <span className="ml-2 align-middle [font-family:var(--font-mono)] text-[8.5px] font-bold uppercase tracking-[0.08em] text-verdict-deep">
                            · {f.tag}
                          </span>
                        )}
                      </h3>
                      <p className="mt-1.5 text-[13px] leading-[1.5] text-ink">{f.desc}</p>
                    </div>
                  </div>
                </StaggerItem>
              );
            })}
          </StaggerChildren>
        </div>
      </section>

      {/* ---------- Así se agiliza: mockups ---------- */}
      <section className="bg-white/65 px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-[1100px]">
          <ScrollReveal className="mb-10 text-center">
            <Kicker>De la teoría a tu día a día</Kicker>
            <h2 className="[font-family:var(--font-display-alt)] mx-auto max-w-[720px] text-[clamp(34px,8vw,58px)] leading-[0.95] tracking-[0.02em] text-navy">
              ASÍ SE AGILIZA CADA OPERACIÓN.
            </h2>
          </ScrollReveal>

          <div className="flex flex-col gap-5">
            {/* mock 1: análisis */}
            <ScrollReveal>
              <div className="grid items-center gap-6 rounded-[16px] border border-peri/35 bg-paper p-5 sm:p-7 lg:grid-cols-2">
                <div>
                  <div className="[font-family:var(--font-mono)] text-[9px] font-bold uppercase tracking-[0.14em] text-verdict-deep">
                    01 · Búsqueda
                  </div>
                  <h3 className="[font-family:var(--font-display-alt)] mt-1.5 text-[26px] leading-none tracking-[0.02em] text-navy">
                    SABES EN SEGUNDOS SI EL COCHE INTERESA
                  </h3>
                  <p className="mt-3 text-[14px] leading-[1.6] text-ink">
                    Pega el link de mobile.de y CarMentor te devuelve la{' '}
                    <b className="text-navy">media de mercado en España</b> (de coches.net, real), la
                    rentabilidad estimada y los riesgos de fiabilidad. Se acabó comprar por intuición.
                  </p>
                </div>
                {/* analysis card */}
                <div className="mx-auto w-full max-w-[360px] rounded-[12px] border border-peri/40 bg-white p-4 shadow-[0_10px_30px_rgba(4,33,82,0.08)]">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-[14px] font-bold text-navy">BMW 320d Touring · 2019</div>
                      <div className="[font-family:var(--font-mono)] text-[10px] text-ink">
                        140.000 km · 190 CV · Diésel
                      </div>
                    </div>
                    <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-verdict [font-family:var(--font-display-alt)] text-[18px] text-white">
                      8.4
                    </div>
                  </div>
                  <div className="mt-3 rounded-[10px] bg-surface px-3.5 py-3">
                    <div className="[font-family:var(--font-mono)] text-[8.5px] uppercase tracking-[0.12em] text-mid">
                      Media mercado España
                    </div>
                    <div className="[font-family:var(--font-display-alt)] text-[30px] leading-none tracking-[0.01em] text-navy">
                      24.900 €
                    </div>
                    <div className="mt-1 text-[9.5px] text-ink">
                      rango 22.400 – 27.100 € · 34 comparables · coches.net
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-verdict/12 px-2.5 py-1 text-[9.5px] font-semibold text-verdict-deep">
                      Rentabilidad estimada ✓
                    </span>
                    <span className="rounded-full bg-peri/30 px-2.5 py-1 text-[9.5px] font-semibold text-navy">
                      Motor B47 fiable
                    </span>
                    <span className="rounded-full bg-peri/30 px-2.5 py-1 text-[9.5px] font-semibold text-navy">
                      CO₂ resuelto
                    </span>
                  </div>
                </div>
              </div>
            </ScrollReveal>

            {/* mock 2: runner */}
            <ScrollReveal>
              <div className="grid items-center gap-6 rounded-[16px] border border-peri/35 bg-paper p-5 sm:p-7 lg:grid-cols-2">
                {/* phone */}
                <div className="order-2 mx-auto w-[170px] rounded-[22px] bg-[#0d1526] p-2.5 shadow-[0_14px_36px_rgba(4,33,82,0.22)] lg:order-1">
                  <div className="rounded-[15px] bg-[#0a0e18] p-3 text-[#eef2fb]">
                    <div className="flex items-center gap-2 border-b border-[#23304d] pb-2">
                      <span className="h-4 w-4 rounded-[5px] bg-peri" />
                      <b className="text-[10px]">Revisión · BMW 320d</b>
                      <span className="ml-auto [font-family:var(--font-mono)] text-[7.5px] text-[#8ea0c8]">
                        Múnich
                      </span>
                    </div>
                    <div className="[font-family:var(--font-mono)] mt-2.5 mb-1.5 text-[7px] uppercase tracking-[0.1em] text-[#7d8fb8]">
                      Vano motor
                    </div>
                    {[
                      ['ok', 'Cadena de distribución · sin ruido'],
                      ['ok', 'Nivel y color de aceite'],
                      ['bad', 'Fuga leve en junta — foto'],
                    ].map(([kind, text]) => (
                      <div key={text} className="my-1 flex items-center gap-2 text-[8.5px] text-[#dce4f5]">
                        <span
                          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] text-[8px] ${
                            kind === 'ok'
                              ? 'bg-[#14512f] text-[#4ade80]'
                              : 'bg-[#5a1d1d] text-[#f87171]'
                          }`}
                        >
                          {kind === 'ok' ? '✓' : '!'}
                        </span>
                        {text}
                      </div>
                    ))}
                    <div className="[font-family:var(--font-mono)] mt-2.5 mb-1.5 text-[7px] uppercase tracking-[0.1em] text-[#7d8fb8]">
                      Fotos de prueba
                    </div>
                    <div className="flex gap-1.5">
                      {[0, 1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className="flex h-6 flex-1 items-center justify-center rounded-[4px] border border-[#2c3a5c]"
                          style={{ background: 'linear-gradient(135deg,#22304f,#141c30)' }}
                        >
                          <Camera size={11} className="text-[#6b7ea6]" />
                        </div>
                      ))}
                    </div>
                    <div className="mt-2.5 rounded-[6px] border border-[#1c6b3f] bg-[#14512f] py-1.5 text-center text-[8.5px] font-semibold tracking-[0.02em] text-[#8ef0b6]">
                      ✓ COMPRAR · 18.600 € (–400 €)
                    </div>
                  </div>
                </div>
                <div className="order-1 lg:order-2">
                  <div className="[font-family:var(--font-mono)] text-[9px] font-bold uppercase tracking-[0.14em] text-verdict-deep">
                    02 · Runner
                  </div>
                  <h3 className="[font-family:var(--font-display-alt)] mt-1.5 text-[26px] leading-none tracking-[0.02em] text-navy">
                    TU RUNNER SUBE CON UN GUION, NO A CIEGAS
                  </h3>
                  <p className="mt-3 text-[14px] leading-[1.6] text-ink">
                    Checklist guiado por fases en el móvil, con los fallos típicos de <b>esa</b>{' '}
                    motorización ya marcados. Sube fotos de prueba, registra km y precio negociado, y
                    deja el veredicto <b className="text-navy">comprar / no comprar</b> antes de pagar.
                  </p>
                </div>
              </div>
            </ScrollReveal>

            {/* mock 3: presupuesto + seguimiento */}
            <ScrollReveal>
              <div className="grid items-center gap-6 rounded-[16px] border border-peri/35 bg-paper p-5 sm:p-7 lg:grid-cols-2">
                <div>
                  <div className="[font-family:var(--font-mono)] text-[9px] font-bold uppercase tracking-[0.14em] text-verdict-deep">
                    03 · Propuesta &amp; entrega
                  </div>
                  <h3 className="[font-family:var(--font-display-alt)] mt-1.5 text-[26px] leading-none tracking-[0.02em] text-navy">
                    EL CLIENTE VIVE UNA EXPERIENCIA DE MARCA
                  </h3>
                  <p className="mt-3 text-[14px] leading-[1.6] text-ink">
                    Un presupuesto profesional con tu logo, y luego una página donde el cliente ve su
                    coche viajar de Alemania a España, con prueba de inspección y avisos automáticos.
                    Sin precios ni márgenes: solo confianza.
                  </p>
                </div>
                <div className="flex gap-2.5">
                  {/* quote */}
                  <div className="flex-1 overflow-hidden rounded-[10px] border border-peri/40 bg-white shadow-[0_8px_24px_rgba(4,33,82,0.07)]">
                    <div className="flex items-center gap-1.5 bg-navy px-3 py-2">
                      <span className="h-4 w-4 rounded-[5px] bg-gradient-to-br from-peri to-white" />
                      <b className="[font-family:var(--font-display-alt)] text-[11px] tracking-[0.03em] text-white">
                        TU COMPRAVENTA
                      </b>
                      <span className="ml-auto [font-family:var(--font-mono)] text-[6.5px] tracking-[0.05em] text-peri">
                        PRESUPUESTO
                      </span>
                    </div>
                    <div className="px-3 py-2.5">
                      {[
                        ['BMW 320d Touring 2019', '18.600 €'],
                        ['Transporte + gestión', '1.450 €'],
                        ['Matriculación (IEDMT)', 'incl.'],
                      ].map(([a, b]) => (
                        <div
                          key={a}
                          className="flex justify-between border-b border-dashed border-peri/40 py-1 text-[8px] text-navy"
                        >
                          <span className="text-ink">{a}</span>
                          <span>{b}</span>
                        </div>
                      ))}
                      <div className="mt-1.5 flex justify-between [font-family:var(--font-display-alt)] text-[16px] text-navy">
                        <span>TOTAL</span>
                        <span className="text-verdict">23.400 €</span>
                      </div>
                    </div>
                  </div>
                  {/* tracking */}
                  <div className="w-[122px] rounded-[10px] border border-peri/40 bg-white p-2.5 shadow-[0_8px_24px_rgba(4,33,82,0.07)]">
                    <div className="text-[8px] font-bold text-navy">Tu coche</div>
                    <div className="mb-2 text-[7px] text-ink">va de camino</div>
                    <div className="relative pl-3.5">
                      <span className="absolute left-1 top-1 bottom-1 w-[2px] bg-peri/50" />
                      {[
                        ['done', 'Comprado', 'inspeccionado ✓'],
                        ['done', 'En transporte', 'salió de Múnich'],
                        ['now', 'En España', 'hoy'],
                        ['', 'Entrega', 'ETA 2 días'],
                      ].map(([state, t, s]) => (
                        <div key={t} className="relative my-1.5">
                          <span
                            className={`absolute left-[-11px] top-[2px] h-2 w-2 rounded-full border-2 bg-white ${
                              state === 'done'
                                ? 'border-verdict bg-verdict'
                                : state === 'now'
                                ? 'border-[#D9820A] ring-[3px] ring-[#D9820A]/20'
                                : 'border-mid'
                            }`}
                          />
                          <div
                            className={`text-[7.5px] font-semibold ${
                              state === 'done' ? 'text-verdict-deep' : 'text-navy'
                            }`}
                          >
                            {t}
                          </div>
                          <div className="text-[6.5px] text-ink">{s}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* ---------- Después de la compra: gestor + ingeniero ---------- */}
      <section className="bg-paper/75 px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-[1100px]">
          <ScrollReveal className="mb-9">
            <Kicker>Y lo que viene después</Kicker>
            <h2 className="[font-family:var(--font-display-alt)] max-w-[760px] text-[clamp(34px,8vw,58px)] leading-[0.95] tracking-[0.02em] text-navy">
              EL COCHE YA ES TUYO. LOS PAPELES LOS HACEMOS NOSOTROS.
            </h2>
            <p className="mt-4 max-w-[600px] text-[15px] leading-[1.65] text-ink">
              Cada operación queda guardada con su análisis, su presupuesto y la inspección del
              runner. Desde ahí, con un clic, la pasas a nuestro gestor y a nuestro ingeniero. Se
              pagan por operación: solo cuando los usas.
            </p>
          </ScrollReveal>

          <div className="grid gap-4 sm:grid-cols-2">
            <ScrollReveal>
              <div className="flex h-full flex-col rounded-[14px] border border-peri/40 bg-white p-5 sm:p-6">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-navy text-peri">
                    <Stamp size={19} />
                  </span>
                  <div>
                    <div className="[font-family:var(--font-mono)] text-[9px] font-bold uppercase tracking-[0.12em] text-verdict-deep">
                      Nuestro gestor
                    </div>
                    <h3 className="text-[17px] font-bold leading-tight text-navy">
                      Impuestos de matriculación
                    </h3>
                  </div>
                </div>
                <p className="mt-3.5 text-[14px] leading-[1.6] text-ink">
                  Presentamos y pagamos el <b className="text-navy">modelo 576</b> (impuesto de
                  matriculación) y el <b className="text-navy">IVTM</b> del ayuntamiento donde se
                  matricula el coche. Antes de encargarlo ves el 576 estimado con la valoración, el
                  CO2 y tu comunidad.
                </p>
                <ul className="mt-4 space-y-1.5">
                  {[
                    'Modelo 576 presentado y pagado',
                    'IVTM del municipio, con su ordenanza',
                    'Justificantes de pago en la operación',
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2 text-[13.5px] text-ink">
                      <Check size={15} className="mt-[3px] shrink-0 text-verdict" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={0.08}>
              <div className="flex h-full flex-col rounded-[14px] border border-peri/40 bg-white p-5 sm:p-6">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-navy text-peri">
                    <FileSignature size={19} />
                  </span>
                  <div>
                    <div className="[font-family:var(--font-mono)] text-[9px] font-bold uppercase tracking-[0.12em] text-verdict-deep">
                      Nuestro ingeniero
                    </div>
                    <h3 className="text-[17px] font-bold leading-tight text-navy">
                      Ficha técnica reducida
                    </h3>
                  </div>
                </div>
                <p className="mt-3.5 text-[14px] leading-[1.6] text-ink">
                  Las fotos que la ficha necesita —{' '}
                  <b className="text-navy">permiso, placa del fabricante, las cuatro vistas</b> — ya
                  las saca tu runner dentro de su inspección normal. Nuestro ingeniero redacta y
                  firma la ficha con ellas, sin volver a ver el coche.
                </p>
                <ul className="mt-4 space-y-1.5">
                  {[
                    'Sin COC: sale con las fotos de la inspección',
                    'Se tramita con el coche todavía en Alemania',
                    'Ficha firmada en PDF, en la propia operación',
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2 text-[13.5px] text-ink">
                      <Check size={15} className="mt-[3px] shrink-0 text-verdict" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* ---------- Founding band ---------- */}
      <section className="bg-navy px-4 py-14 text-white sm:px-6 sm:py-18">
        <div className="mx-auto flex max-w-[1000px] flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
          <div className="[font-family:var(--font-display-alt)] shrink-0 text-[72px] leading-[0.82] text-peri">
            1<span className="block text-[16px] tracking-[0.05em] text-white">coche</span>
          </div>
          <div>
            <h3 className="[font-family:var(--font-display-alt)] text-[clamp(26px,5vw,38px)] leading-[1] tracking-[0.02em]">
              UN SOLO COCHE MALO EVITADO LO PAGA TODO.
            </h3>
            <p className="mt-3 max-w-[600px] text-[14px] leading-[1.65] text-peri/85">
              No lo compares con un software: compáralo con el coste de una compra equivocada.
              CarMentor te dice cuál evitar antes de subir a por él, y hace que cada operación pase
              por el mismo carril. Estamos abriendo plazas para los primeros dealers fundadores.
            </p>
          </div>
        </div>
      </section>

      {/* ---------- Form ---------- */}
      <section id="solicitar" className="bg-paper/75 px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto grid max-w-[1000px] gap-9 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <ScrollReveal>
            <Kicker>Programa fundador</Kicker>
            <h2 className="[font-family:var(--font-display-alt)] text-[clamp(34px,8vw,52px)] leading-[0.95] tracking-[0.02em] text-navy">
              ¿LO VEMOS CON UN COCHE REAL TUYO?
            </h2>
            <p className="mt-4 max-w-[420px] text-[15px] leading-[1.65] text-ink">
              Déjanos tus datos y te hacemos una demo en vivo: análisis → presupuesto → revisión del
              runner, en tu móvil. Sin compromiso.
            </p>
            <ul className="mt-6 space-y-2.5">
              {[
                'Demo con un coche que estés mirando ahora',
                'Precio de fundador para los primeros dealers',
                'Te contactamos en menos de 24 h',
              ].map((li) => (
                <li key={li} className="flex items-start gap-2.5 text-[14px] font-medium text-navy">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-verdict/12 text-verdict">
                    <Check size={13} />
                  </span>
                  {li}
                </li>
              ))}
            </ul>
          </ScrollReveal>
          <ScrollReveal delay={0.1}>
            <DealerInterestForm />
          </ScrollReveal>
        </div>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="border-t border-peri/30 bg-white/80 px-6 py-9">
        <div className="mx-auto flex max-w-[1100px] flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-navy [font-family:var(--font-display-alt)] text-[16px] leading-none text-peri">
              C
            </span>
            <span className="[font-family:var(--font-display-alt)] text-[18px] tracking-[0.04em] text-navy">
              CARMENTOR DEALER
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-mid">
            <Link href="/" className="transition-colors hover:text-navy">
              CarMentor para particulares
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-navy">
              Privacidad
            </Link>
            <Link href="/terms" className="transition-colors hover:text-navy">
              Términos
            </Link>
            <a href="mailto:info@carmentor.es" className="transition-colors hover:text-navy">
              Contacto
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
