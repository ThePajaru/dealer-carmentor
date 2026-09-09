'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Car, ChevronRight, Search, Workflow, Share2, TrendingUp, TrendingDown, Check, AlertCircle, Clock } from 'lucide-react';
import Link from 'next/link';
import CaptureLinksModal from '@/components/dealer/CaptureLinksModal';
import { OperacionesSkeleton } from '@/components/dealer/DealerSkeletons';
import {
  PHASES, PERDIDO, ACTION_STAGES, DOT_MOVING, stageDef, stageLabel, phaseOf, isClosed,
  type PhaseDef,
} from '@/lib/dealer/pipeline';

interface VehicleLite {
  make: string | null; model: string | null; max_price: number | null; max_km: number | null;
  min_year: number | null; fuel: string | null; transmission: string | null; mobile_url: string | null;
}
interface TransitProgress { comprado?: boolean; en_transporte?: boolean; en_espana?: boolean }
interface Job {
  id: string;
  client_name: string;
  stage: string;
  make: string | null; model: string | null; max_price: number | null; max_km: number | null;
  min_year: number | null; fuel: string | null; transmission: string | null;
  mobile_url: string | null;
  vehicles?: VehicleLite[];
  created_at: string; updated_at: string;
  transit_progress: TransitProgress | null;
  delivery_eta: string | null;
  car: { title: string | null; image: string | null } | null;
  price: number | null; margin: number | null; margin_is_real?: boolean;
  leads_count: number; presupuestos_count: number;
}
interface Kpis {
  activas: number; nuevas7d: number; entregadas: number; margen: number;
  margenMes: number; margenMesPrev: number; margenMesPrevSameDay: number; enJuego: number;
}
interface Series { activas: number[]; nuevas: number[]; entregadas: number[]; margen: number[] }
interface DealerEvent {
  id: string;
  request_id: string | null;
  type: string;
  payload: { client_name?: string | null; title?: string | null; from?: string | null; to?: string | null; margin?: number | null; source?: string | null };
  created_at: string;
}

const FUEL: Record<string, string> = { PETROL: 'Gasolina', DIESEL: 'Diésel', ELECTRICITY: 'Eléctrico', HYBRID: 'Híbrido', HYBRID_PLUGIN: 'Híbrido enchufable', PLUGINHYBRID: 'Híbrido enchufable' };
const TRANS: Record<string, string> = { AUTOMATIC_GEAR: 'Automático', MANUAL_GEAR: 'Manual' };

// Stage taxonomy, phase grouping and copy all come from the single source of
// truth in src/lib/dealer/pipeline.ts — same 5 phases the case page renders.
const CLOSED = [stageDef('entregado')!, PERDIDO];

function prefsOf(j: Job): string {
  const vs = j.vehicles && j.vehicles.length > 1 ? j.vehicles : null;
  if (vs) {
    const names = vs.map(v => (v.make ? (v.model ? `${v.make} ${v.model}` : v.make) : 'Cualquiera'));
    const head = names.slice(0, 2).join(', ');
    return names.length > 2 ? `${head} +${names.length - 2}` : head;
  }
  const p: string[] = [];
  if (j.make) p.push(j.model ? `${j.make} ${j.model}` : j.make);
  if (j.max_price) p.push(`<${(j.max_price / 1000).toFixed(0)}k€`);
  if (j.max_km) p.push(`<${(j.max_km / 1000).toFixed(0)}k km`);
  if (j.fuel && FUEL[j.fuel]) p.push(FUEL[j.fuel]);
  if (j.transmission && TRANS[j.transmission]) p.push(TRANS[j.transmission]);
  if (j.min_year) p.push(`desde ${j.min_year}`);
  return p.join(' · ') || 'Sin preferencias definidas';
}
function fmt(n: number | null) { return Math.round(n ?? 0).toLocaleString('es-ES'); }
function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
function agoText(iso: string): { text: string; stale: boolean } {
  const d = daysSince(iso);
  if (d <= 0) return { text: 'hoy', stale: false };
  if (d === 1) return { text: 'ayer', stale: false };
  return { text: `hace ${d}d`, stale: d >= 7 };
}
function eventAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `hace ${Math.max(mins, 1)}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const d = Math.floor(hours / 24);
  return d === 1 ? 'ayer' : `hace ${d}d`;
}
function etaText(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const days = Math.round((d.getTime() - Date.now()) / 86400000);
  if (days < 0) return 'entrega pasada';
  if (days === 0) return 'llega hoy';
  if (days === 1) return 'llega mañana';
  if (days <= 6) return `llega el ${d.toLocaleDateString('es-ES', { weekday: 'long' })}`;
  return `llega el ${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`;
}
function transitLabel(j: Job): string {
  const eta = etaText(j.delivery_eta);
  if (eta) return eta;
  const tp = j.transit_progress;
  if (tp?.en_espana) return 'en España';
  if (tp?.en_transporte) return 'en transporte';
  if (tp?.comprado) return 'comprado, preparando salida';
  return 'preparando salida';
}

export default function OperacionesPage() {
  const { session } = useAuth();
  const token = session?.access_token;
  const [showClosed, setShowClosed] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Cached (stale-while-revalidate): back-navigation to Operaciones renders the
  // last result instantly, then refetches quietly. isPending is only true on the
  // very first load, before anything is cached.
  const { data, isPending } = useQuery({
    queryKey: ['dealer', 'operaciones'],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch('/api/dealer/operaciones', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error('Error al cargar operaciones');
      return r.json();
    },
  });

  const jobs: Job[] = data?.jobs || [];
  const kpis: Kpis | null = data?.kpis || null;
  const series: Series | null = data?.series || null;
  const events: DealerEvent[] = data?.events || [];
  const loading = isPending && !!token;

  const byStage = (key: string) => jobs.filter(j => j.stage === key);
  // Active (non-closed) jobs that fall into a given phase.
  const byPhase = (key: string) => jobs.filter(j => !isClosed(j.stage) && phaseOf(j.stage)?.key === key);
  const closedItems = jobs.filter(j => isClosed(j.stage));
  const enRuta = jobs.filter(j => j.stage === 'transito');

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold text-d-text tracking-tight">Operaciones</h1>
          <p className="text-d-muted text-sm mt-1">Cada cliente, un viaje de la solicitud a la entrega.</p>
        </div>
        <button
          onClick={() => setShareOpen(true)}
          className="d-btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm shrink-0 mt-0.5"
          title="Comparte tu enlace de captación"
        >
          <Share2 className="w-4 h-4" /> <span className="hidden sm:inline">Enlace de captación</span>
        </button>
      </div>

      <CaptureLinksModal open={shareOpen} onClose={() => setShareOpen(false)} />

      {loading ? (
        <OperacionesSkeleton />
      ) : jobs.length === 0 ? (
        <div className="d-card-dashed py-16 text-center mt-8">
          <Workflow className="w-10 h-10 text-d-dim mx-auto mb-3" />
          <p className="text-d-text-2 text-sm font-medium">Aún no tienes operaciones</p>
          <p className="text-d-dim text-xs mt-1">Comparte tu <button onClick={() => setShareOpen(true)} className="d-link">enlace de captación</button> y cada cliente que lo rellene aparece aquí.</p>
        </div>
      ) : (
        <>
          {kpis && <HeroBand kpis={kpis} series={series} enRutaCount={enRuta.length} />}

          {/* El tablero: las 5 fases de la ruta como columnas */}
          <Kanban jobs={jobs} byPhase={byPhase} />

          {/* Debajo: qué ha pasado · qué se está estancando */}
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
            <ActividadReciente events={events} />
            <Riesgos jobs={jobs} />
          </div>

          {/* Archivo (entregado / perdido) */}
          {closedItems.length > 0 && (
            <div className="mt-10">
              <button onClick={() => setShowClosed(v => !v)} className="text-xs text-d-dim hover:text-d-muted flex items-center gap-1.5">
                <ChevronRight className={`w-3.5 h-3.5 transition-transform ${showClosed ? 'rotate-90' : ''}`} />
                Archivo <span className="d-num">({closedItems.length})</span>
              </button>
              {showClosed && (
                <div className="space-y-8 mt-5">
                  {CLOSED.map(st => {
                    const items = byStage(st.key);
                    if (items.length === 0) return null;
                    return <StageSection key={st.key} st={st} items={items} muted />;
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Hero: número protagonista (margen del mes) + ritmo vs mes pasado, ticker debajo ── */
function HeroBand({ kpis, series, enRutaCount }: { kpis: Kpis; series: Series | null; enRutaCount: number }) {
  // Pace, not calendar MoM: month-to-date vs the same day of the previous month.
  // (Comparing to the full previous month reads −100% for most of the month.)
  const pace = kpis.margenMesPrevSameDay > 0
    ? Math.round(((kpis.margenMes - kpis.margenMesPrevSameDay) / kpis.margenMesPrevSameDay) * 100)
    : null;
  const mes = new Date().toLocaleDateString('es-ES', { month: 'long' });
  return (
    <div className="mt-6">
      <div className="flex items-end justify-between gap-6 flex-wrap">
        <div>
          <p className="text-[13px] text-d-muted">Margen de {mes}</p>
          <div className="flex items-baseline gap-3 mt-1.5">
            <span className="font-semibold tracking-tight leading-none text-d-text tabular-nums" style={{ fontSize: 'clamp(32px, 5vw, 44px)' }}>€{fmt(kpis.margenMes)}</span>
            {kpis.enJuego > 0 && (
              <span className="text-[15px] text-d-muted whitespace-nowrap">+ <span className="text-d-green font-semibold d-num">€{fmt(kpis.enJuego)}</span> en juego</span>
            )}
            {pace != null && (
              <span className={`d-chip ${pace >= 0 ? 'd-chip-up' : 'd-chip-down'}`} title="vs mismo día del mes pasado">
                {pace >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {pace >= 0 ? '+' : ''}{pace}%
              </span>
            )}
          </div>
        </div>
        {/* "En juego" ya vive junto al margen — aquí solo lo que no se repite */}
        <div className="hidden md:flex pb-1">
          <Tick label="Entregados" value={String(kpis.entregadas)} />
          <Tick label="En marcha" value={String(kpis.activas)} />
          <Tick label="En ruta" value={String(enRutaCount)} />
        </div>
        {series?.margen && series.margen.length > 1 && (
          <div className="flex flex-col items-end gap-2 pb-1">
            <div className="w-[132px]"><Sparkline data={series.margen} color="#34d399" idKey="hero" /></div>
            <span className="text-xs text-d-dim tabular-nums">vs €{fmt(kpis.margenMesPrevSameDay)} a estas alturas del mes pasado</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Tick({ label, value, amber }: { label: string; value: string; amber?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 px-6 first:pl-0 border-l first:border-l-0 border-d-border">
      <span className="text-xs font-medium text-d-muted">{label}</span>
      <span className={`text-[20px] font-semibold leading-none tabular-nums ${amber ? 'text-d-amber' : 'text-d-text'}`}>{value}</span>
    </div>
  );
}

/* ══ El tablero: una columna por fase, sin cajas — reglas duras entre etapas ══ */
function Kanban({ jobs, byPhase }: { jobs: Job[]; byPhase: (key: string) => Job[] }) {
  return (
    <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
      {PHASES.map(ph => <KanbanColumn key={ph.key} phase={ph} items={byPhase(ph.key)} jobs={jobs} />)}
    </div>
  );
}

function KanbanColumn({ phase, items, jobs }: { phase: PhaseDef; items: Job[]; jobs: Job[] }) {
  const sum = items.reduce((s, j) => s + (j.margin ?? 0), 0);
  const hasMargins = items.some(j => j.margin != null);
  // Empty Propuesta while ops sit analyzed in Selección = the bottleneck CTA.
  const listos = items.length === 0 && phase.key === 'propuesta'
    ? jobs.filter(j => j.stage === 'seleccion').sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
    : [];

  return (
    <div
      className="border-t border-d-border-strong xl:border-t-0 xl:border-l xl:first:border-l-0 py-4 xl:py-0 xl:px-4 xl:first:pl-0 xl:last:pr-0 min-w-0"
      title={phase.tip}
    >
      <div className="flex items-baseline gap-2 pb-2.5 border-b border-d-border-strong">
        <span className="w-2 h-2 rounded-full shrink-0 self-center" style={{ backgroundColor: items.length > 0 ? phase.dot : 'var(--color-d-surface-3)' }} />
        <span className="text-[13px] font-semibold text-d-text truncate">{phase.label}</span>
        <span className="ml-auto d-num text-xs text-d-muted shrink-0">{items.length}</span>
      </div>
      {hasMargins && sum !== 0 && (
        <div className="d-num text-[11px] text-d-dim mt-2">Σ {sum > 0 ? '+' : ''}€{fmt(sum)}</div>
      )}

      {items.length === 0 ? (
        <div className="mt-4 xl:mt-6">
          {listos.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-d-muted leading-snug">{listos.length === 1 ? '1 operación analizada lista' : `${listos.length} operaciones analizadas listas`} para proponer</span>
              <Link href={`/dealer/clientes/${listos[0].id}`} className="text-xs font-semibold text-d-amber hover:text-d-text transition-colors">
                Generar propuesta →
              </Link>
            </div>
          ) : (
            <span className="text-xs text-d-dim">vacío</span>
          )}
        </div>
      ) : (
        <div className="mt-2 divide-y divide-d-border">
          {items.map(j => <KanbanItem key={j.id} j={j} />)}
        </div>
      )}
    </div>
  );
}

function KanbanItem({ j }: { j: Job }) {
  const st = stageDef(j.stage);
  const ago = agoText(j.updated_at);
  // Posture: `acuerdo` means the presupuesto is SENT — the ball is with the
  // client, so the card reads "esperando", not amber your-move.
  const waiting = j.stage === 'acuerdo';
  const needsAction = !waiting && ACTION_STAGES.has(j.stage);
  const moving = st?.dot === DOT_MOVING;
  const accent = needsAction ? 'border-l-d-amber' : moving ? 'border-l-d-green' : 'border-l-transparent';

  return (
    <Link
      href={`/dealer/clientes/${j.id}`}
      className={`block border-l-2 ${accent} py-2.5 pl-2.5 pr-1 -ml-px hover:bg-d-surface-2 transition-colors group`}
    >
      <p className="text-[13.5px] font-semibold text-d-text leading-tight truncate">{j.client_name}</p>
      <p className="text-xs text-d-muted truncate mt-0.5">{j.car?.title || prefsOf(j)}</p>

      <div className="flex items-center gap-2 mt-1.5">
        {j.stage === 'transito' ? (
          <span className="inline-flex items-center gap-1.5 text-d-green text-[11px] font-medium whitespace-nowrap truncate">
            <span className="w-1 h-1 rounded-full bg-d-green shrink-0" />{transitLabel(j)}
          </span>
        ) : (
          <span className={`d-num text-[11px] ${ago.stale ? 'text-d-amber' : 'text-d-dim'}`}>{ago.text}{ago.stale ? ' ⚠' : ''}</span>
        )}
        {j.margin != null && (
          <span className={`ml-auto d-num text-[12.5px] font-semibold ${j.margin >= 0 ? 'text-d-green' : 'text-d-red'}`}>{j.margin >= 0 ? '+' : ''}€{fmt(j.margin)}</span>
        )}
      </div>

      {waiting ? (
        <p className="mt-1.5 text-xs text-d-dim truncate flex items-center gap-1">
          <Clock className="w-3 h-3 shrink-0" /> Esperando al cliente — «Cliente aceptó» cuando diga sí
        </p>
      ) : needsAction && st?.next && (
        <p className="mt-1.5 text-xs font-medium text-d-amber group-hover:text-d-text transition-colors truncate">
          {st.next} →
        </p>
      )}
    </Link>
  );
}

/* ══ Actividad reciente: el feed de dealer_events ══ */
function eventLine(e: DealerEvent): { text: string; margin?: number | null } | null {
  const p = e.payload || {};
  const who = p.client_name || null;
  switch (e.type) {
    case 'solicitud_nueva':
      return { text: `Nueva solicitud de ${who || 'un cliente'}${p.source === 'captacion' ? ' desde el enlace de captación' : ''}` };
    case 'lead_captacion':
      return { text: `Nuevo lead desde el enlace de captación${who ? ` — ${who}` : ''}` };
    case 'etapa_cambiada':
      if (!p.to) return null;
      return { text: `${who || 'Operación'} pasa a ${stageLabel(p.to)}${p.from ? ` (desde ${stageLabel(p.from)})` : ''}` };
    case 'presupuesto_creado':
      return { text: `Presupuesto creado${who ? ` para ${who}` : ''}${p.title ? ` — ${p.title}` : ''}`, margin: p.margin };
    case 'presupuesto_enviado':
      return { text: `Presupuesto enviado${who ? ` a ${who}` : ''}`, margin: p.margin };
    case 'presupuesto_visto':
      return { text: `${who || 'El cliente'} ha abierto el presupuesto${p.title ? ` — ${p.title}` : ''}` };
    case 'analisis_completado':
      return { text: `Análisis completado${p.title ? `: ${p.title}` : ''}${who ? ` (${who})` : ''}` };
    default:
      return null;
  }
}

function ActividadReciente({ events }: { events: DealerEvent[] }) {
  const lines = events
    .map(e => ({ e, line: eventLine(e) }))
    .filter((x): x is { e: DealerEvent; line: NonNullable<ReturnType<typeof eventLine>> } => x.line != null)
    .slice(0, 6);

  return (
    <section aria-label="Actividad reciente" className="d-card p-4">
      <SecLabel title="Actividad reciente" />
      {lines.length === 0 ? (
        <p className="text-[13px] text-d-dim mt-3 leading-relaxed">
          Aquí verás lo que va pasando: solicitudes nuevas, análisis completados, presupuestos y cambios de etapa.
        </p>
      ) : (
        <div className="mt-1.5">
          {lines.map(({ e, line }) => (
            <div key={e.id} className="flex items-baseline gap-2.5 py-2 border-b border-d-border last:border-b-0 last:pb-0">
              <Check className="w-3.5 h-3.5 text-d-green shrink-0 translate-y-0.5" />
              <span className="text-[13px] text-d-text-2 leading-snug min-w-0">
                {e.request_id ? <Link href={`/dealer/clientes/${e.request_id}`} className="hover:text-d-text transition-colors">{line.text}</Link> : line.text}
                {line.margin != null && <span className="d-num font-semibold text-d-green"> +€{fmt(line.margin)}</span>}
              </span>
              <span className="ml-auto d-num text-[11px] text-d-dim shrink-0">{eventAgo(e.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ══ Riesgos y esperas: lo que se está estancando ══ */
function Riesgos({ jobs }: { jobs: Job[] }) {
  const stale = jobs
    .filter(j => !isClosed(j.stage) && daysSince(j.updated_at) >= 7)
    .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
  const staleIds = new Set(stale.map(j => j.id));
  const sinAnalizar = jobs.filter(j =>
    !isClosed(j.stage) && !staleIds.has(j.id) &&
    (j.stage === 'solicitud' || j.stage === 'busqueda') && j.leads_count === 0,
  );
  const rows: { j: Job; msg: string; cta: string }[] = [
    ...stale.map(j => ({ j, msg: `${daysSince(j.updated_at)} días sin actividad`, cta: 'Retomar' })),
    ...sinAnalizar.map(j => ({ j, msg: 'sin análisis todavía', cta: 'Analizar' })),
  ].slice(0, 5);

  return (
    <section aria-label="Riesgos y esperas" className="d-card p-4">
      <SecLabel title="Riesgos y esperas" count={rows.length || undefined} />
      {rows.length === 0 ? (
        <p className="text-[13px] text-d-dim mt-3 leading-relaxed">Nada parado. Todas las operaciones tienen movimiento reciente.</p>
      ) : (
        <div className="mt-1.5">
          {rows.map(({ j, msg, cta }) => (
            <div key={j.id} className="flex items-center gap-2.5 py-2 border-b border-d-border last:border-b-0 last:pb-0">
              <AlertCircle className="w-3.5 h-3.5 text-d-amber shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-d-text-2 leading-snug truncate">{j.client_name} — {j.car?.title || prefsOf(j)}</p>
                <p className="text-xs text-d-amber mt-0.5">{msg}</p>
              </div>
              <Link href={`/dealer/clientes/${j.id}`} className="d-link text-[12.5px] font-medium shrink-0">{cta} →</Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ── Etiqueta de sección — frase normal, sin adornos ── */
function SecLabel({ title, count, sub }: { title: string; count?: number; sub?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[15px] font-medium text-d-text">{title}</span>
      {count != null && <span className="text-[13px] text-d-dim d-num">{count}</span>}
      {sub && <span className="ml-auto text-xs text-d-dim">{sub}</span>}
    </div>
  );
}

// Dependency-free inline sparkline (area + line), stretches to the container width.
function Sparkline({ data, color, idKey }: { data: number[]; color: string; idKey: string }) {
  const W = 100, H = 24, P = 3;
  const n = data.length;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const x = (i: number) => (n === 1 ? 0 : (i / (n - 1)) * W);
  const y = (v: number) => H - P - ((v - min) / range) * (H - 2 * P);
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M ${pts.join(' L ')}`;
  const area = `${line} L ${W},${H} L 0,${H} Z`;
  const gid = `spark-${idKey}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-6" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* ── Archivo: lista plana por etapa terminal ── */
function StageSection({ st, items, muted }: { st: { key: string; label: string; dot: string }; items: Job[]; muted?: boolean }) {
  return (
    <section>
      <div className="flex items-center gap-2.5 mb-3">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: st.dot }} />
        <h2 className="text-d-text font-medium text-sm shrink-0">{st.label}</h2>
        <span className="d-num text-d-dim text-xs shrink-0">{items.length}</span>
        <span className="flex-1 h-px bg-d-border/70" />
      </div>

      <div className={`rounded-xl border border-d-border bg-d-surface overflow-hidden divide-y divide-d-border ${muted ? 'opacity-60' : ''}`}>
        {items.map(j => <JobRow key={j.id} j={j} />)}
      </div>
    </section>
  );
}

function JobRow({ j }: { j: Job }) {
  const ago = agoText(j.updated_at);
  const meta: { t: string; cls?: string }[] = [];
  if (j.leads_count > 0) meta.push({ t: `${j.leads_count} ${j.leads_count === 1 ? 'candidato' : 'candidatos'}` });
  if (j.presupuestos_count > 0) meta.push({ t: `${j.presupuestos_count} ${j.presupuestos_count === 1 ? 'presupuesto' : 'presupuestos'}` });
  meta.push({ t: ago.text, cls: ago.stale ? 'text-d-amber' : '' });

  return (
    <Link href={`/dealer/clientes/${j.id}`} className="flex items-center gap-3.5 px-3.5 py-3 hover:bg-d-surface-2 transition-colors group">
      {j.car?.image ? (
        <img src={j.car.image} alt="" className="w-12 h-9 sm:w-16 sm:h-12 rounded-lg object-cover shrink-0 ring-1 ring-white/[.06]" />
      ) : (
        <div className="w-12 h-9 sm:w-16 sm:h-12 rounded-lg bg-d-surface-2 grid place-items-center shrink-0 ring-1 ring-white/[.06]"><Car className="w-4 h-4 text-d-dim" /></div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-d-text font-semibold text-sm truncate leading-tight">{j.client_name}</p>
        <p className="text-d-muted text-xs truncate mt-0.5">{j.car?.title || prefsOf(j)}</p>
        <div className="flex items-center gap-1.5 mt-1 text-[11px] text-d-dim">
          {meta.map((m, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-d-border">·</span>}
              <span className={m.cls}>{m.t}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {j.price != null ? (
          <div className="text-right">
            <p className="text-d-text font-semibold text-sm d-num leading-tight">€{fmt(j.price)}</p>
            {j.margin != null && (
              <p className={`hidden sm:block text-[11px] d-num ${j.margin >= 0 ? 'text-d-green' : 'text-d-red'}`}>{j.margin >= 0 ? '+' : ''}€{fmt(j.margin)} margen {j.margin_is_real ? 'real' : 'est.'}</p>
            )}
          </div>
        ) : j.stage === 'solicitud' && j.mobile_url ? (
          <a href={j.mobile_url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} className="hidden sm:inline-flex items-center gap-1 text-[11px] text-d-accent bg-d-accent/10 border border-d-accent/20 rounded-full px-2.5 py-1 hover:bg-d-accent/15" title="Buscar en mobile.de">
            <Search className="w-3 h-3" /> Buscar
          </a>
        ) : null}
        <ChevronRight className="w-4 h-4 text-d-dim group-hover:text-d-muted" />
      </div>
    </Link>
  );
}
