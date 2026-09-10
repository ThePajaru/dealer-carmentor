'use client';

// Consola de operaciones (2026-09-10). Sustituye al kanban por tres NIVELES,
// como el administrador de anuncios: marcas filas arriba y los niveles de abajo
// se filtran solos.
//
// La cascada va 1 → 2 y 1 → 3, NUNCA 1 → 2 → 3: impuestos y ficha no son padre
// e hijo como el conjunto y el anuncio de Facebook, son dos servicios hermanos
// de la misma operación. Encadenarlos vaciaría un nivel sin motivo.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';
import {
  Search, Share2, Plus, Copy, Pencil, Trash2, Columns3, SlidersHorizontal,
  Download, Stamp, FileSignature, ListFilter, ExternalLink,
  Workflow, RefreshCw, Check, Loader2, AlertTriangle, X, Layers,
} from 'lucide-react';
import CaptureLinksModal from '@/components/dealer/CaptureLinksModal';
import { OperacionesSkeleton } from '@/components/dealer/DealerSkeletons';
import {
  ACTION_STAGES, stageDef, isClosed, DOT_MOVING, DOT_ACTION, DOT_WAIT,
} from '@/lib/dealer/pipeline';
import { SERVICE_STATUS_LABELS, type ServiceKey, type ServiceStatus } from '@/lib/dealer/services';
import { STAGES } from '@/lib/dealer/pipeline';

/* ══════════ Tipos ══════════ */

interface TransitProgress { comprado?: boolean; en_transporte?: boolean; en_espana?: boolean }

interface VehicleProfile {
  make?: string | null; model?: string | null; max_price?: number | null;
  max_km?: number | null; min_year?: number | null; fuel?: string | null;
  transmission?: string | null; [k: string]: unknown;
}

interface Job {
  id: string;
  client_name: string;
  client_phone: string | null;
  client_email: string | null;
  vehicles?: VehicleProfile[];
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

/* ══════════ Columnas que se pueden ocultar ══════════ */

// La primera columna (Operación) no se puede esconder: sin ella la fila no
// identifica nada. El resto sí — es lo que pedía la pantalla de 14 pulgadas.
const COLS_OPS = [
  { key: 'etapa', label: 'Etapa' },
  { key: 'ahora', label: 'Ahora toca' },
  { key: 'tramites', label: 'Trámites' },
  { key: 'presupuesto', label: 'Presupuesto' },
  { key: 'margen', label: 'Margen' },
  { key: 'entrega', label: 'Entrega' },
] as const;

const CLAVE_COLS = 'dealer-operaciones-columnas-ocultas';

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

  const [ocultas, setOcultas] = useState<Set<string>>(new Set());
  const [agrupar, setAgrupar] = useState(false);
  const [menu, setMenu] = useState<'columnas' | 'desglose' | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; malo?: boolean } | null>(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  const router = useRouter();
  const queryClient = useQueryClient();
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Las columnas escondidas se recuerdan por navegador: es una preferencia de
  // pantalla, no un dato del negocio.
  useEffect(() => {
    try {
      const guardado = localStorage.getItem(CLAVE_COLS);
      if (guardado) setOcultas(new Set(JSON.parse(guardado)));
    } catch { /* almacenamiento bloqueado: se usan todas las columnas */ }
  }, []);

  const alternarColumna = (clave: string) => {
    setOcultas(prev => {
      const next = new Set(prev);
      if (next.has(clave)) next.delete(clave); else next.add(clave);
      try { localStorage.setItem(CLAVE_COLS, JSON.stringify([...next])); } catch { /* ignora */ }
      return next;
    });
  };

  // Cerrar los desplegables al pulsar fuera.
  useEffect(() => {
    if (!menu) return;
    const fuera = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [menu]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

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
  const ve = (clave: string) => !ocultas.has(clave);
  const nCols = 2 + COLS_OPS.filter(c => ve(c.key)).length;

  // Filas agrupadas por etapa, en el orden del pipeline. Cada grupo lleva su
  // recuento y su margen, que es la pregunta real: donde esta el dinero parado.
  const grupos = useMemo(() => {
    if (!agrupar) return null;
    const orden = [...STAGES.map(st => st.key), 'perdido'];
    const mapa = new Map<string, Job[]>();
    for (const j of visibles) {
      const arr = mapa.get(j.stage) || [];
      arr.push(j);
      mapa.set(j.stage, arr);
    }
    return orden
      .filter(k => mapa.has(k))
      .map(k => ({
        stage: k,
        label: stageDef(k)?.label ?? k,
        dot: stageDef(k)?.dot ?? DOT_WAIT,
        filas: mapa.get(k)!,
        margen: mapa.get(k)!.reduce((t, j) => t + (j.margin || 0), 0),
      }));
  }, [agrupar, visibles]);

  /* ── Exportar: CSV del nivel que se esta viendo ── */
  const exportar = useCallback(() => {
    const esc = (v: unknown) => {
      const t = v == null ? '' : String(v);
      return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    let cabeceras: string[] = [];
    let filas: unknown[][] = [];
    let nombre = 'operaciones';

    if (level === 'ops') {
      cabeceras = ['Cliente', 'Coche', 'Etapa', 'Ahora toca', '576', 'Ficha', 'Presupuesto', 'Margen', 'Margen real', 'Entrega'];
      filas = visibles.map(j => {
        const t = tramitesDe.get(j.id) || { impuestos: 'none', ficha: 'none' };
        const estado = (e: string) => (e === 'done' ? 'hecho' : e === 'work' ? 'en curso' : 'sin encargar');
        return [
          j.client_name, cocheDe(j), stageDef(j.stage)?.label ?? j.stage,
          isClosed(j.stage) ? '' : (stageDef(j.stage)?.next ?? ''),
          estado(t.impuestos), estado(t.ficha),
          j.price ?? '', j.margin ?? '', j.margin_is_real ? 'si' : 'no', entregaText(j),
        ];
      });
    } else if (level === 'impuestos') {
      nombre = 'impuestos';
      cabeceras = ['Coche', 'Cliente', 'Comunidad', 'Municipio', 'Provincia', 'CVF', 'Valoracion', 'CO2', '576 estimado', 'Estado'];
      filas = impuestos.map(o => {
        const v = o.payload as Record<string, unknown>;
        return [
          v.coche ?? '', o.dealer_client_requests?.client_name ?? '', v.region_label ?? '',
          v.municipio ?? '', v.provincia ?? '', v.cvf ?? '', v.valoracion ?? '', v.co2 ?? '',
          v.iedmt_estimado ?? '', SERVICE_STATUS_LABELS[o.status],
        ];
      });
    } else {
      nombre = 'fichas-reducidas';
      cabeceras = ['Coche', 'Cliente', 'Fotos', 'Faltan', 'Estado', 'Documentos'];
      filas = fichas.map(o => {
        const v = o.payload as { coche?: string; photos?: unknown[]; faltan?: string[] };
        return [
          v.coche ?? '', o.dealer_client_requests?.client_name ?? '',
          Array.isArray(v.photos) ? v.photos.length : 0,
          Array.isArray(v.faltan) ? v.faltan.join(' · ') : '',
          SERVICE_STATUS_LABELS[o.status],
          (o.result?.files || []).map(f => f.label).join(' · '),
        ];
      });
    }

    if (filas.length === 0) {
      setAviso({ texto: 'No hay nada que exportar en esta vista.', malo: true });
      return;
    }

    // Punto y coma y BOM: es lo que abre Excel en español sin pelearse.
    const csv = '\ufeff' + [cabeceras, ...filas].map(f => f.map(esc).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nombre}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setAviso({ texto: `Exportadas ${filas.length} filas.` });
  }, [level, visibles, impuestos, fichas, tramitesDe]);

  /* ── Duplicar: mismo cliente y mismas preferencias, operacion nueva ── */
  const duplicar = useCallback(async () => {
    const j = jobs.find(x => x.id === unaSeleccionada);
    if (!j || !token) return;
    setTrabajando('duplicar');
    try {
      const cuerpo: Record<string, unknown> = {
        client_name: j.client_name,
        client_phone: j.client_phone,
        client_email: j.client_email,
      };
      // Si la solicitud original tenia varios coches, se copian todos; si no,
      // los campos planos de siempre.
      if (Array.isArray(j.vehicles) && j.vehicles.length) cuerpo.vehicles = j.vehicles;
      else Object.assign(cuerpo, { make: j.make, model: j.model, max_price: j.max_price });

      const res = await fetch('/api/dealer/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(cuerpo),
      });
      const data = await res.json();
      if (!res.ok || !data.id) throw new Error(data.error || 'No se pudo duplicar');
      setSelected(new Set());
      // Navegar primero y refrescar la lista despues, sin esperar: al reves, el
      // refetch se cruza con la navegacion y el destino puede perderse.
      router.push(`/dealer/clientes/${data.id}`);
      void queryClient.invalidateQueries({ queryKey: ['dealer', 'operaciones'] });
    } catch (e) {
      setAviso({ texto: e instanceof Error ? e.message : 'No se pudo duplicar', malo: true });
    } finally {
      setTrabajando(null);
    }
  }, [jobs, unaSeleccionada, token, queryClient, router]);

  /* ── Eliminar: a la papelera, nunca borrado definitivo desde aqui ── */
  const eliminar = useCallback(async () => {
    if (!token || sel === 0) return;
    setConfirmarBorrado(false);
    setTrabajando('eliminar');
    const ids = [...selected];
    let hechas = 0;
    for (const id of ids) {
      const res = await fetch(`/api/dealer/clients/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) hechas++;
    }
    await queryClient.invalidateQueries({ queryKey: ['dealer', 'operaciones'] });
    setSelected(new Set());
    setTrabajando(null);
    setAviso(
      hechas === ids.length
        ? { texto: `${hechas} ${hechas === 1 ? 'operación movida' : 'operaciones movidas'} a la papelera.` }
        : { texto: `Solo se movieron ${hechas} de ${ids.length}.`, malo: true },
    );
  }, [token, sel, selected, queryClient]);

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

        <button
          onClick={duplicar}
          disabled={!unaSeleccionada || trabajando !== null}
          title={sel > 1 ? 'Duplica de una en una' : 'Copia cliente y preferencias en una operación nueva'}
          className="d-btn-ghost px-3 py-1.5 rounded-lg text-[12.5px] disabled:opacity-40 inline-flex items-center gap-1.5"
        >
          {trabajando === 'duplicar' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
          Duplicar
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

        <button
          onClick={() => setConfirmarBorrado(true)}
          disabled={sel === 0 || trabajando !== null}
          title={sel === 0 ? 'Marca alguna operación' : `Mover ${sel} a la papelera`}
          className="d-btn-ghost p-2 rounded-lg disabled:opacity-40"
          aria-label="Mover a la papelera"
        >
          {trabajando === 'eliminar' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>

        <span className="w-px h-5 bg-d-border mx-1" />

        {unaSeleccionada ? (
          <Link
            href={`/dealer/clientes/${unaSeleccionada}`}
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

        <div className="ml-auto flex items-center gap-1.5" ref={menuRef}>
          {/* Columnas y Desglose solo existen en el nivel de operaciones: en
              Impuestos y Ficha no hay nada que configurar, y un boton apagado
              que nunca se enciende parece roto. Exportar si vale en los tres. */}
          {level === 'ops' && (
          <>
          <div className="relative">
            <button
              onClick={() => setMenu(m => (m === 'columnas' ? null : 'columnas'))}
              disabled={level !== 'ops'}
              className="d-btn-ghost px-3 py-1.5 rounded-lg text-[12.5px] disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              <Columns3 className="w-3.5 h-3.5" /> Columnas
              {ocultas.size > 0 && <span className="d-num text-d-dim">−{ocultas.size}</span>}
            </button>
            {menu === 'columnas' && (
              <div className="absolute right-0 top-full mt-1 z-30 d-card p-1.5 min-w-[190px]">
                {COLS_OPS.map(c => (
                  <button
                    key={c.key}
                    onClick={() => alternarColumna(c.key)}
                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] text-d-text-2 hover:bg-d-surface-2 text-left"
                  >
                    <span className={`w-4 h-4 rounded grid place-items-center border ${ve(c.key) ? 'bg-d-accent border-d-accent text-white' : 'border-d-border'}`}>
                      {ve(c.key) && <Check className="w-3 h-3" />}
                    </span>
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Desglose — agrupa por etapa con subtotal de margen. */}
          <div className="relative">
            <button
              onClick={() => setMenu(m => (m === 'desglose' ? null : 'desglose'))}
              disabled={level !== 'ops'}
              className={`d-btn-ghost px-3 py-1.5 rounded-lg text-[12.5px] disabled:opacity-40 inline-flex items-center gap-1.5 ${agrupar ? 'text-d-accent' : ''}`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" /> Desglose
            </button>
            {menu === 'desglose' && (
              <div className="absolute right-0 top-full mt-1 z-30 d-card p-1.5 min-w-[190px]">
                {([[false, 'Sin desglose'], [true, 'Por etapa']] as const).map(([valor, etiqueta]) => (
                  <button
                    key={String(valor)}
                    onClick={() => { setAgrupar(valor); setMenu(null); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] text-d-text-2 hover:bg-d-surface-2 text-left"
                  >
                    <span className="w-4 h-4 grid place-items-center">
                      {agrupar === valor && <Check className="w-3.5 h-3.5 text-d-accent" />}
                    </span>
                    {etiqueta}
                  </button>
                ))}
              </div>
            )}
          </div>

          </>
          )}

          <button
            onClick={exportar}
            className="d-btn-ghost p-2 rounded-lg"
            aria-label="Exportar a CSV"
            title="Exportar a CSV lo que ves"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {aviso && (
        <div className={`px-4 sm:px-6 py-2 text-[13px] flex items-center gap-2 border-b border-d-border ${aviso.malo ? 'text-d-red bg-d-red/5' : 'text-d-green bg-d-green/5'}`}>
          {aviso.malo ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <Check className="w-4 h-4 shrink-0" />}
          {aviso.texto}
          <button onClick={() => setAviso(null)} className="ml-auto text-d-dim hover:text-d-text" aria-label="Cerrar aviso">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {confirmarBorrado && (
        <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={() => setConfirmarBorrado(false)}>
          <div className="d-card max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
            <h2 className="text-d-text font-semibold text-[15px]">
              ¿Mover {sel} {sel === 1 ? 'operación' : 'operaciones'} a la papelera?
            </h2>
            <p className="text-d-dim text-[13px] mt-1.5">
              No se borra nada: siguen en la Papelera y puedes restaurarlas cuando quieras.
            </p>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setConfirmarBorrado(false)} className="d-btn-ghost px-3 py-1.5 rounded-lg text-[13px]">
                Cancelar
              </button>
              <button onClick={eliminar} className="d-btn-primary px-3 py-1.5 rounded-lg text-[13px] font-semibold">
                Mover a la papelera
              </button>
            </div>
          </div>
        </div>
      )}

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
            <table className="d-table w-full min-w-[720px]">
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
                  <th className="w-full">Operación</th>
                  {ve('etapa') && <th className="whitespace-nowrap">Etapa</th>}
                  {ve('ahora') && <th>Ahora toca</th>}
                  {ve('tramites') && <th>Trámites</th>}
                  {ve('presupuesto') && <th className="r">Presupuesto</th>}
                  {ve('margen') && <th className="r">Margen</th>}
                  {ve('entrega') && <th>Entrega</th>}
                </tr>
              </thead>
              <tbody>
                {(grupos ?? [{ stage: '', label: '', dot: '', filas: visibles, margen: 0 }]).map(g => (
                  <Fragment key={g.stage || 'todas'}>
                    {grupos && (
                      <tr className="bg-d-surface-2">
                        <td colSpan={nCols} className="py-2">
                          <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-d-text">
                            <Dot color={g.dot} /> {g.label}
                            <span className="d-num text-d-dim font-normal">{g.filas.length}</span>
                          </span>
                          {g.margen !== 0 && (
                            <span className="d-num text-d-dim text-[12.5px] ml-3">
                              margen {eur(g.margen)}
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                    {g.filas.map(j => {
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
                          <td className="min-w-[200px]">
                            <Link href={`/dealer/clientes/${j.id}`} className="font-semibold text-d-text hover:text-d-accent">
                              {j.client_name}
                            </Link>
                            <div className="text-d-dim text-[11.5px] mt-0.5 truncate max-w-[280px]">{cocheDe(j)}</div>
                          </td>
                          {ve('etapa') && (
                            <td>
                              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                                <Dot color={dot} /> {def?.label || j.stage}
                              </span>
                            </td>
                          )}
                          {ve('ahora') && (
                            <td className={`text-[12.5px] ${dot === DOT_ACTION ? 'text-d-amber font-medium' : 'text-d-dim'}`}>
                              {isClosed(j.stage) ? '—' : (esperando ? def?.next?.toLowerCase() : def?.next) || '—'}
                            </td>
                          )}
                          {ve('tramites') && (
                            <td>
                              <span className="inline-flex gap-1">
                                <TramiteChip label={TR_LABEL.impuestos} state={t.impuestos} />
                                <TramiteChip label={TR_LABEL.ficha_reducida} state={t.ficha} />
                              </span>
                            </td>
                          )}
                          {ve('presupuesto') && <td className="r d-num">{eur(j.price)}</td>}
                          {ve('margen') && (
                            <td className={`r d-num font-semibold ${j.margin == null ? 'text-d-dim' : j.margin >= 0 ? 'text-d-green' : 'text-d-red'}`}>
                              {j.margin == null ? '—' : `${j.margin >= 0 ? '+' : ''}${eur(j.margin)}`}
                              {j.margin_is_real && <span className="text-d-dim text-[10px] ml-1 font-normal">real</span>}
                            </td>
                          )}
                          {ve('entrega') && <td className="text-d-dim text-[12.5px]">{entregaText(j)}</td>}
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
                {visibles.length === 0 && (
                  <tr><td colSpan={nCols} className="text-center text-d-dim py-10">
                    Ninguna operación en esta vista{busca ? ' con esa búsqueda' : ''}.
                  </td></tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={nCols} className="bg-d-surface-2 text-d-muted text-[12.5px]">
                    Resultados de <b className="d-num text-d-text">{visibles.length}</b>{' '}
                    {visibles.length === 1 ? 'operación' : 'operaciones'} ·
                    margen <span className="d-num text-d-text">{eur(margenVisible)}</span> ·
                    <span className="d-num"> {orders.filter(o => o.status === 'pagado' || o.status === 'en_tramite').length}</span> trámites en curso
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          {/* w-full en la primera columna de cada nivel: se queda el hueco
              sobrante y las numericas se ajustan a su contenido, en vez de
              repartirse el ancho y dejar medio metro entre CVF y VALORACION. */}
          {level === 'impuestos' && (
            <table className="d-table w-full min-w-[860px]">
              <thead>
                <tr>
                  <th className="w-full">Coche</th>
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
                      <td className="r d-num whitespace-nowrap">{p.cvf != null ? p.cvf.toLocaleString('es-ES') : '—'}</td>
                      <td className="r d-num whitespace-nowrap">{eur(p.valoracion)}</td>
                      <td className="r d-num whitespace-nowrap">{p.co2 != null ? `${p.co2} g/km` : 'sin acreditar'}</td>
                      <td className="r d-num whitespace-nowrap font-semibold text-d-text">{eur(p.iedmt_estimado)}</td>
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
                    <b className="d-num text-d-text">{impuestos.length}</b>{' '}
                    {impuestos.length === 1 ? 'coche' : 'coches'} ·
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
            <table className="d-table w-full min-w-[680px]">
              <thead>
                <tr>
                  <th className="w-full">Coche</th>
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
                    <b className="d-num text-d-text">{fichas.length}</b>{' '}
                    {fichas.length === 1 ? 'coche' : 'coches'} ·
                    <span className="d-num"> {fichas.filter(o => o.status === 'completado').length}</span>{' '}
                    {fichas.filter(o => o.status === 'completado').length === 1 ? 'ficha firmada' : 'fichas firmadas'}
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
