'use client';

// Consola de operaciones (2026-09-10). Sustituye al kanban por tres NIVELES,
// como el administrador de anuncios: marcas filas arriba y los niveles de abajo
// se filtran solos.
//
// La cascada va 1 → 2 y 1 → 3, NUNCA 1 → 2 → 3: impuestos y ficha no son padre
// e hijo como el conjunto y el anuncio de Facebook, son dos servicios hermanos
// de la misma operación. Encadenarlos vaciaría un nivel sin motivo.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';
import {
  Search, Share2, Plus, Copy, Pencil, Trash2, Columns3, SlidersHorizontal,
  Download, Stamp, FileSignature, ListFilter, ExternalLink,
  Workflow, RefreshCw,
} from 'lucide-react';
import CaptureLinksModal from '@/components/dealer/CaptureLinksModal';
import { OperacionesSkeleton } from '@/components/dealer/DealerSkeletons';
import {
  ACTION_STAGES, stageDef, isClosed, DOT_MOVING, DOT_ACTION, DOT_WAIT,
} from '@/lib/dealer/pipeline';
import { SERVICE_STATUS_LABELS, type ServiceKey, type ServiceStatus } from '@/lib/dealer/services';

/* ══════════ Tipos ══════════ */

interface TransitProgress { comprado?: boolean; en_transporte?: boolean; en_espana?: boolean }

interface Job {
  id: string;
  client_name: string;
  stage: string;
  make: string | null; model: string | null; max_price: number | null;
  created_at: string; updated_at: string;
  transit_progress: TransitProgress | null;
  delivery_eta: string | null;
  car: { title: string | null; image: string | null } | null;
  price: number | null; margin: number | null; margin_is_real?: boolean;
}

interface Kpis { activas: number; entregadas: number; margenMes: number; enJuego: number }

interface ResultFile { label: string; path: string; url: string | null }

interface ServiceOrder {
  id: string;
  request_id: string;
  kind: ServiceKey;
  status: ServiceStatus;
  payload: Record<string, unknown>;
  result: { nota?: string; files?: ResultFile[] };
  dealer_client_requests: { client_name: string | null; stage: string | null } | null;
}

type Level = 'ops' | 'impuestos' | 'ficha';
type TramiteState = 'done' | 'work' | 'none';

/* ══════════ Utilidades ══════════ */

const eur = (n: number | null | undefined) =>
  n == null ? '—' : `${Math.round(n).toLocaleString('es-ES')} €`;

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

function entregaText(j: Job): string {
  if (j.stage === 'entregado') return 'entregado';
  if (j.stage === 'perdido') return '—';
  const eta = etaText(j.delivery_eta);
  if (eta) return eta;
  const tp = j.transit_progress;
  if (tp?.en_espana) return 'en España';
  if (tp?.en_transporte) return 'en transporte';
  if (tp?.comprado) return 'comprado';
  return '—';
}

const cocheDe = (j: Job): string =>
  j.car?.title
  || [j.make, j.model].filter(Boolean).join(' ')
  || 'Sin coche elegido';

/* ══════════ Vistas guardadas ══════════ */

const VIEWS = [
  { key: 'todas', label: 'Todas', test: () => true },
  { key: 'accion', label: 'Te esperan', test: (j: Job) => ACTION_STAGES.has(j.stage) },
  { key: 'ruta', label: 'En ruta', test: (j: Job) => j.stage === 'transito' || j.stage === 'tramites' },
  { key: 'entregadas', label: 'Entregadas', test: (j: Job) => isClosed(j.stage) },
] as const;

/* ══════════ Piezas ══════════ */

function Dot({ color }: { color: string }) {
  return <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />;
}

const TR_LABEL: Record<ServiceKey | 'ivtm', string> = {
  impuestos: '576',
  ivtm: 'IVTM',
  ficha_reducida: 'FICHA',
};

function TramiteChip({ label, state }: { label: string; state: TramiteState }) {
  const cls = state === 'done'
    ? 'bg-d-green/10 text-d-green border-d-green/30'
    : state === 'work'
      ? 'bg-d-amber/10 text-d-amber border-d-amber/30'
      : 'text-d-dim border-d-border border-dashed';
  const title = state === 'done' ? 'hecho' : state === 'work' ? 'en curso' : 'sin encargar';
  return (
    <span
      title={`${label}: ${title}`}
      className={`inline-flex items-center justify-center min-w-[34px] h-5 px-1.5 rounded-[5px] border text-[10.5px] font-bold tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}

function StatusPill({ status }: { status: ServiceStatus }) {
  const cls = status === 'completado' ? 'd-tag d-tag-good'
    : status === 'en_tramite' ? 'd-tag d-tag-info'
      : status === 'pagado' ? 'd-tag d-tag-warn'
        : 'd-tag d-tag-muted';
  return <span className={cls}>{SERVICE_STATUS_LABELS[status]}</span>;
}

/* ══════════ Página ══════════ */

export default function OperacionesPage() {
  const { session } = useAuth();
  const token = session?.access_token;

  const [level, setLevel] = useState<Level>('ops');
  const [view, setView] = useState<string>('todas');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shareOpen, setShareOpen] = useState(false);

  const { data, isPending, isFetching, refetch } = useQuery({
    queryKey: ['dealer', 'operaciones'],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch('/api/dealer/operaciones', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error('Error al cargar operaciones');
      return r.json();
    },
  });

  // Los encargos de toda la cartera alimentan los niveles 2 y 3.
  const { data: svc } = useQuery({
    queryKey: ['dealer', 'services', 'cartera'],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch('/api/dealer/services', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error('Error al cargar los trámites');
      return r.json();
    },
  });

  const jobs: Job[] = useMemo(() => data?.jobs || [], [data]);
  const kpis: Kpis | null = data?.kpis || null;
  const orders: ServiceOrder[] = useMemo(() => svc?.orders || [], [svc]);
  const loading = isPending && !!token;

  // Estado de los tres papeles por operación, para la columna «Trámites».
  const tramitesDe = useMemo(() => {
    const map = new Map<string, { impuestos: TramiteState; ficha: TramiteState }>();
    for (const o of orders) {
      const cur = map.get(o.request_id) || { impuestos: 'none' as TramiteState, ficha: 'none' as TramiteState };
      const st: TramiteState = o.status === 'completado' ? 'done'
        : o.status === 'pagado' || o.status === 'en_tramite' ? 'work'
          : 'none';
      if (o.kind === 'impuestos') cur.impuestos = st;
      else cur.ficha = st;
      map.set(o.request_id, cur);
    }
    return map;
  }, [orders]);

  const vista = VIEWS.find(v => v.key === view) ?? VIEWS[0];
  const busca = q.trim().toLowerCase();

  const visibles = useMemo(() => jobs.filter(j => {
    if (!vista.test(j)) return false;
    if (!busca) return true;
    return `${j.client_name} ${cocheDe(j)}`.toLowerCase().includes(busca);
  }), [jobs, vista, busca]);

  const sel = selected.size;
  const enFoco = (requestId: string) => sel === 0 || selected.has(requestId);

  const impuestos = orders.filter(o => o.kind === 'impuestos' && enFoco(o.request_id));
  const fichas = orders.filter(o => o.kind === 'ficha_reducida' && enFoco(o.request_id));

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const todasMarcadas = visibles.length > 0 && visibles.every(j => selected.has(j.id));
  const marcarTodas = () => setSelected(todasMarcadas ? new Set() : new Set(visibles.map(j => j.id)));

  const unaSeleccionada = sel === 1 ? [...selected][0] : null;
  const alcance = sel === 0 ? 'de todas' : sel === 1 ? 'de 1 operación' : `de ${sel} operaciones`;

  const margenVisible = visibles.reduce((s, j) => s + (j.margin || 0), 0);

  return (
    <div className="-mx-4 sm:-mx-5 md:-mx-6 -mt-16 md:-mt-8">
      <CaptureLinksModal open={shareOpen} onClose={() => setShareOpen(false)} />

      {/* ── Cabecera ── */}
      <header className="flex items-center gap-3 flex-wrap px-4 sm:px-6 py-3 border-b border-d-border">
        <h1 className="text-[19px] font-bold text-d-text tracking-tight">Operaciones</h1>
        {kpis && (
          <span className="inline-flex items-center gap-2 border border-d-border rounded-full pl-2 pr-3 py-1">
            <span className="w-2 h-2 rounded-full bg-d-green" />
            <span className="text-d-muted text-[12.5px]">Margen del mes</span>
            <b className="text-d-green d-num text-[13px]">{eur(kpis.margenMes)}</b>
          </span>
        )}
        {kpis && (
          <span className="text-d-dim text-[12.5px] hidden sm:inline">
            <span className="d-num">{kpis.activas}</span> activas ·{' '}
            <span className="d-num">{eur(kpis.enJuego)}</span> en juego
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="d-btn-ghost p-2 rounded-lg"
            title="Actualizar"
            aria-label="Actualizar"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShareOpen(true)} className="d-btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px]">
            <Share2 className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Enlace de captación</span>
          </button>
        </div>
      </header>

      {/* ── Vistas guardadas ── */}
      <div className="border-b border-d-border px-4 sm:px-6 flex items-center gap-1 flex-wrap">
        {VIEWS.map(v => {
          const n = jobs.filter(v.test).length;
          const on = v.key === view;
          return (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={`px-3 py-2.5 text-[12.5px] rounded-t-lg border border-b-0 -mb-px transition-colors ${
                on
                  ? 'bg-d-surface border-d-border text-d-text font-semibold'
                  : 'border-transparent text-d-muted hover:text-d-text hover:bg-d-surface-2'
              }`}
            >
              {v.label} <span className="d-num text-d-dim ml-0.5">{n}</span>
            </button>
          );
        })}
      </div>

      {/* ── Buscador ── */}
      <div className="px-4 sm:px-6 py-3 flex gap-2 flex-wrap">
        <label className="d-input flex-1 min-w-[220px] flex items-center gap-2 px-3 py-2">
          <Search className="w-3.5 h-3.5 text-d-dim shrink-0" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Busca por cliente o coche"
            className="flex-1 bg-transparent outline-none text-sm text-d-text placeholder:text-d-dim"
          />
        </label>
      </div>

      {/* ── Los tres niveles ── */}
      <div className="px-4 sm:px-6 flex items-end gap-2 border-b border-d-border flex-wrap">
        {([
          { key: 'ops', label: 'Operaciones', icon: ListFilter },
          { key: 'impuestos', label: 'Impuestos', icon: Stamp },
          { key: 'ficha', label: 'Ficha reducida', icon: FileSignature },
        ] as const).map(t => {
          const on = level === t.key;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setLevel(t.key)}
              className={`inline-flex items-center gap-2 px-3.5 py-2.5 rounded-t-[10px] border border-b-0 -mb-px text-[13px] font-semibold transition-colors ${
                on ? 'bg-d-surface border-d-border text-d-text' : 'bg-d-surface-2 border-d-border text-d-muted hover:text-d-text'
              }`}
            >
              <Icon className="w-4 h-4 text-d-accent" />
              {t.label}
              {t.key === 'ops'
                ? sel > 0 && (
                  <span className="inline-flex items-center gap-1.5 bg-d-accent/10 text-d-accent rounded-md px-1.5 py-0.5 text-[11.5px]">
                    {sel === 1 ? '1 seleccionada' : `${sel} seleccionadas`}
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={e => { e.stopPropagation(); setSelected(new Set()); }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setSelected(new Set()); } }}
                      className="cursor-pointer"
                      aria-label="Quitar selección"
                    >✕</span>
                  </span>
                )
                : <span className="font-normal text-d-dim">{alcance}</span>}
            </button>
          );
        })}
      </div>

      {/* ── Acciones ── */}
      <div className="px-4 sm:px-6 py-2.5 flex items-center gap-1.5 flex-wrap border-b border-d-border">
        <Link href="/dealer/analizar" className="d-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold">
          <Plus className="w-3.5 h-3.5" /> Crear
        </Link>
        <button disabled className="d-btn-ghost px-3 py-1.5 rounded-lg text-[12.5px] disabled:opacity-40 inline-flex items-center gap-1.5">
          <Copy className="w-3.5 h-3.5" /> Duplicar
        </button>
        {unaSeleccionada ? (
          <Link href={`/dealer/clientes/${unaSeleccionada}`} className="d-btn-ghost px-3 py-1.5 rounded-lg text-[12.5px] inline-flex items-center gap-1.5">
            <Pencil className="w-3.5 h-3.5" /> Abrir
          </Link>
        ) : (
          <button disabled className="d-btn-ghost px-3 py-1.5 rounded-lg text-[12.5px] disabled:opacity-40 inline-flex items-center gap-1.5">
            <Pencil className="w-3.5 h-3.5" /> Abrir
          </button>
        )}
        <button disabled className="d-btn-ghost p-2 rounded-lg disabled:opacity-40" aria-label="Eliminar">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <span className="w-px h-5 bg-d-border mx-1" />
        {unaSeleccionada ? (
          <Link
            href={`/dealer/clientes/${unaSeleccionada}#step-tramites`}
            className="d-btn-ghost px-3 py-1.5 rounded-lg text-[12.5px] inline-flex items-center gap-1.5"
          >
            <Stamp className="w-3.5 h-3.5" /> Encargar trámites
          </Link>
        ) : (
          <button
            disabled
            title={sel > 1 ? 'De momento los trámites se encargan de uno en uno' : 'Marca una operación'}
            className="d-btn-ghost px-3 py-1.5 rounded-lg text-[12.5px] disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            <Stamp className="w-3.5 h-3.5" /> Encargar trámites
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button disabled className="d-btn-ghost px-3 py-1.5 rounded-lg text-[12.5px] disabled:opacity-40 inline-flex items-center gap-1.5">
            <Columns3 className="w-3.5 h-3.5" /> Columnas
          </button>
          <button disabled className="d-btn-ghost px-3 py-1.5 rounded-lg text-[12.5px] disabled:opacity-40 inline-flex items-center gap-1.5">
            <SlidersHorizontal className="w-3.5 h-3.5" /> Desglose
          </button>
          <button disabled className="d-btn-ghost p-2 rounded-lg disabled:opacity-40" aria-label="Exportar">
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Tabla ── */}
      {loading ? (
        <div className="px-4 sm:px-6 py-6"><OperacionesSkeleton /></div>
      ) : jobs.length === 0 ? (
        <div className="px-4 sm:px-6 py-16 text-center">
          <Workflow className="w-9 h-9 text-d-dim mx-auto mb-3" />
          <p className="text-d-text font-medium text-sm">Aún no tienes operaciones</p>
          <p className="text-d-dim text-xs mt-1">
            Comparte tu <button onClick={() => setShareOpen(true)} className="d-link">enlace de captación</button> y cada cliente que lo rellene aparece aquí.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          {level === 'ops' && (
            <table className="d-table min-w-[1000px]">
              <thead>
                <tr>
                  <th className="w-9 pr-0">
                    <input
                      type="checkbox"
                      checked={todasMarcadas}
                      onChange={marcarTodas}
                      aria-label="Seleccionar todas"
                      className="w-[15px] h-[15px] accent-[#2b5bd7] align-middle"
                    />
                  </th>
                  <th>Operación</th>
                  <th>Etapa</th>
                  <th>Ahora toca</th>
                  <th>Trámites</th>
                  <th className="r">Presupuesto</th>
                  <th className="r">Margen</th>
                  <th>Entrega</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map(j => {
                  const def = stageDef(j.stage);
                  const marcada = selected.has(j.id);
                  const t = tramitesDe.get(j.id) || { impuestos: 'none' as TramiteState, ficha: 'none' as TramiteState };
                  const dot = def?.dot || DOT_WAIT;
                  const esperando = dot === DOT_MOVING || dot === DOT_WAIT;
                  return (
                    <tr key={j.id} className={marcada ? 'bg-d-accent/[0.07]' : undefined}>
                      <td className="pr-0">
                        <input
                          type="checkbox"
                          checked={marcada}
                          onChange={() => toggle(j.id)}
                          aria-label={`Seleccionar ${j.client_name}`}
                          className="w-[15px] h-[15px] accent-[#2b5bd7] align-middle"
                        />
                      </td>
                      <td className="min-w-[220px]">
                        <Link href={`/dealer/clientes/${j.id}`} className="font-semibold text-d-text hover:text-d-accent">
                          {j.client_name}
                        </Link>
                        <div className="text-d-dim text-[11.5px] mt-0.5 truncate max-w-[280px]">{cocheDe(j)}</div>
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-2 whitespace-nowrap">
                          <Dot color={dot} /> {def?.label || j.stage}
                        </span>
                      </td>
                      <td className={`text-[12.5px] ${dot === DOT_ACTION ? 'text-d-amber font-medium' : 'text-d-dim'}`}>
                        {isClosed(j.stage) ? '—' : (esperando ? def?.next?.toLowerCase() : def?.next) || '—'}
                      </td>
                      <td>
                        <span className="inline-flex gap-1">
                          <TramiteChip label={TR_LABEL.impuestos} state={t.impuestos} />
                          <TramiteChip label={TR_LABEL.ficha_reducida} state={t.ficha} />
                        </span>
                      </td>
                      <td className="r d-num">{eur(j.price)}</td>
                      <td className={`r d-num font-semibold ${j.margin == null ? 'text-d-dim' : j.margin >= 0 ? 'text-d-green' : 'text-d-red'}`}>
                        {j.margin == null ? '—' : `${j.margin >= 0 ? '+' : ''}${eur(j.margin)}`}
                        {j.margin_is_real && <span className="text-d-dim text-[10px] ml-1 font-normal">real</span>}
                      </td>
                      <td className="text-d-dim text-[12.5px]">{entregaText(j)}</td>
                    </tr>
                  );
                })}
                {visibles.length === 0 && (
                  <tr><td colSpan={8} className="text-center text-d-dim py-10">
                    Ninguna operación en esta vista{busca ? ' con esa búsqueda' : ''}.
                  </td></tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={8} className="bg-d-surface-2 text-d-muted text-[12.5px]">
                    Resultados de <b className="d-num text-d-text">{visibles.length}</b>{' '}
                    {visibles.length === 1 ? 'operación' : 'operaciones'} ·
                    margen <span className="d-num text-d-text">{eur(margenVisible)}</span> ·
                    <span className="d-num"> {orders.filter(o => o.status === 'pagado' || o.status === 'en_tramite').length}</span> trámites en curso
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          {level === 'impuestos' && (
            <table className="d-table min-w-[980px]">
              <thead>
                <tr>
                  <th>Coche</th>
                  <th>Comunidad</th>
                  <th>Municipio</th>
                  <th className="r">CVF</th>
                  <th className="r">Valoración</th>
                  <th className="r">CO2</th>
                  <th className="r">576 estimado</th>
                  <th>Estado</th>
                  <th>Justificantes</th>
                </tr>
              </thead>
              <tbody>
                {impuestos.map(o => {
                  const p = o.payload as {
                    coche?: string; region_label?: string; municipio?: string; provincia?: string;
                    cvf?: number; valoracion?: number; co2?: number; iedmt_estimado?: number;
                  };
                  const files = o.result?.files || [];
                  return (
                    <tr key={o.id}>
                      <td className="min-w-[220px]">
                        <Link href={`/dealer/clientes/${o.request_id}`} className="font-semibold text-d-text hover:text-d-accent">
                          {p.coche || 'Vehículo'}
                        </Link>
                        <div className="text-d-dim text-[11.5px] mt-0.5">{o.dealer_client_requests?.client_name || ''}</div>
                      </td>
                      <td>{p.region_label || '—'}</td>
                      {/* Barcelona · Barcelona no aporta nada: la provincia solo
                          se enseña cuando difiere del municipio. */}
                      <td className="whitespace-nowrap">
                        {p.municipio || '—'}
                        {p.provincia && p.provincia !== p.municipio ? ` · ${p.provincia}` : ''}
                      </td>
                      <td className="r d-num">{p.cvf ?? '—'}</td>
                      <td className="r d-num">{eur(p.valoracion)}</td>
                      <td className="r d-num">{p.co2 != null ? `${p.co2} g/km` : 'sin acreditar'}</td>
                      <td className="r d-num font-semibold text-d-text">{eur(p.iedmt_estimado)}</td>
                      <td><StatusPill status={o.status} /></td>
                      <td>
                        {files.length === 0 ? <span className="text-d-dim">—</span> : (
                          <span className="inline-flex flex-wrap gap-1.5">
                            {files.map(f => f.url
                              ? <a key={f.path} href={f.url} target="_blank" rel="noopener" className="d-link inline-flex items-center gap-1 text-[12.5px]">
                                  <ExternalLink className="w-3 h-3" /> {f.label}
                                </a>
                              : <span key={f.path} className="d-pill">{f.label}</span>)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {impuestos.length === 0 && (
                  <tr><td colSpan={9} className="text-center text-d-dim py-10">
                    {sel > 0
                      ? 'Las operaciones marcadas no tienen impuestos encargados.'
                      : 'Todavía no has encargado impuestos en ninguna operación.'}
                  </td></tr>
                )}
              </tbody>
              {impuestos.length > 0 && (
                <tfoot>
                  <tr><td colSpan={9} className="bg-d-surface-2 text-d-muted text-[12.5px]">
                    <b className="d-num text-d-text">{impuestos.length}</b> coches ·
                    576 estimado{' '}
                    <span className="d-num text-d-text">
                      {eur(impuestos.reduce((s, o) => s + Number((o.payload as { iedmt_estimado?: number }).iedmt_estimado || 0), 0))}
                    </span>
                    <span className="text-d-dim"> · el importe final lo fija Hacienda; el IVTM lo calcula el gestor con la ordenanza del municipio</span>
                  </td></tr>
                </tfoot>
              )}
            </table>
          )}

          {level === 'ficha' && (
            <table className="d-table min-w-[820px]">
              <thead>
                <tr>
                  <th>Coche</th>
                  <th>Expediente de fotos</th>
                  <th>Estado</th>
                  <th>Ficha firmada</th>
                </tr>
              </thead>
              <tbody>
                {fichas.map(o => {
                  const p = o.payload as { coche?: string; photos?: unknown[]; faltan?: string[] };
                  const hechas = Array.isArray(p.photos) ? p.photos.length : 0;
                  const faltan = Array.isArray(p.faltan) ? p.faltan.length : 0;
                  const total = hechas + faltan;
                  const pct = total > 0 ? Math.round((hechas / total) * 100) : 0;
                  const files = o.result?.files || [];
                  return (
                    <tr key={o.id}>
                      <td className="min-w-[220px]">
                        <Link href={`/dealer/clientes/${o.request_id}`} className="font-semibold text-d-text hover:text-d-accent">
                          {p.coche || 'Vehículo'}
                        </Link>
                        <div className="text-d-dim text-[11.5px] mt-0.5">{o.dealer_client_requests?.client_name || ''}</div>
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-2">
                          <span className="w-[62px] h-[5px] rounded-full bg-d-surface-3 overflow-hidden">
                            <span
                              className="block h-full rounded-full"
                              style={{ width: `${pct}%`, background: pct === 100 ? 'var(--color-d-green)' : '#d9891a' }}
                            />
                          </span>
                          <span className="d-num text-[12.5px]">{hechas}/{total || 6}</span>
                          {faltan > 0 && (
                            <span className="text-d-amber text-[12px]">
                              faltan {(p.faltan as string[]).slice(0, 2).join(', ')}{faltan > 2 ? `+${faltan - 2}` : ''}
                            </span>
                          )}
                        </span>
                      </td>
                      <td><StatusPill status={o.status} /></td>
                      <td>
                        {files.length === 0 ? <span className="text-d-dim">—</span> : (
                          <span className="inline-flex flex-wrap gap-1.5">
                            {files.map(f => f.url
                              ? <a key={f.path} href={f.url} target="_blank" rel="noopener" className="d-link inline-flex items-center gap-1 text-[12.5px]">
                                  <ExternalLink className="w-3 h-3" /> {f.label}
                                </a>
                              : <span key={f.path} className="d-pill">{f.label}</span>)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {fichas.length === 0 && (
                  <tr><td colSpan={4} className="text-center text-d-dim py-10">
                    {sel > 0
                      ? 'Las operaciones marcadas no tienen ficha encargada.'
                      : 'Todavía no has encargado ninguna ficha reducida.'}
                  </td></tr>
                )}
              </tbody>
              {fichas.length > 0 && (
                <tfoot>
                  <tr><td colSpan={4} className="bg-d-surface-2 text-d-muted text-[12.5px]">
                    <b className="d-num text-d-text">{fichas.length}</b> coches ·
                    <span className="d-num"> {fichas.filter(o => o.status === 'completado').length}</span> fichas firmadas
                    <span className="text-d-dim"> · las fotos salen de la inspección del runner, no hay una segunda visita al coche</span>
                  </td></tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      )}
    </div>
  );
}
