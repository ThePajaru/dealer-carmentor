'use client';

import { useEffect, useState, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useDealer } from '@/hooks/useDealer';
import LeadStatusBadge from '@/components/dealer/LeadStatusBadge';
import { Button } from '@/components/ui/button';
import {
  Loader2, ArrowLeft, ExternalLink, Phone, Search, FileText,
  Plus, Send, ChevronRight, ChevronDown, Star, GitCompare,
  CheckCircle2, Truck, ShoppingBag, XCircle, Clipboard,
  Sparkles, AlertTriangle, Check, X, MapPin, Download,
  RefreshCw, MoreHorizontal, ClipboardCheck, Trash2, Clock, Eye, EyeOff,
  Camera, Receipt,
} from 'lucide-react';
import Link from 'next/link';
import { buildAnalysisView, type AnalysisView } from '@/lib/analysis-view';
import { DealerAnalysisPeek } from '@/components/dealer/DealerAnalysisReport';
import { PhotoStrip } from '@/components/dealer/PhotoLightbox';
import { AnalyzingCard } from '@/components/dealer/AnalyzeStages';
import BuscarSearch from '@/components/dealer/operation/BuscarSearch';
import { consumeAnalyzeStream } from '@/lib/analyze-stream';
import { buildInitialPresupuestoData, renderPresupuestoHtml, type PresupuestoData as PresupuestoContent } from '@/lib/presupuesto-template';
import { STAGES, PHASES, stageDef, phaseOf } from '@/lib/dealer/pipeline';
import { publicOrigin } from '@/lib/public-url';
import { FEATURE_LABELS, DRIVE_TYPES, INTERIOR_TYPES, DOOR_OPTIONS } from '@/lib/mobile-de-search';
import type { VehicleProfile } from '../../client-types';
import { waNumber, waLink } from '@/lib/whatsapp';
import { ClientDetailSkeleton } from '@/components/dealer/DealerSkeletons';
import RunnerReportReview, { type RunnerReport } from '@/components/dealer/RunnerReportReview';

const FUEL_LABELS: Record<string, string> = {
  PETROL: 'Gasolina', DIESEL: 'Diésel', ELECTRICITY: 'Eléctrico',
  HYBRID: 'Híbrido', HYBRID_PLUGIN: 'Híbrido enchufable', PLUGINHYBRID: 'Híbrido enchufable',
};

const TRANSMISSION_LABELS: Record<string, string> = {
  AUTOMATIC_GEAR: 'Automático', MANUAL_GEAR: 'Manual',
};

const eur = (n: number) => Math.round(n).toLocaleString('es-ES');

// Downscale a receipt photo before base64 → server (keeps ticket uploads small).
function fileToDataUrl(file: File, maxDim = 1600, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result as string; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale); height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no ctx'));
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}
/** «hace 3 h» / «hace 2 d» — para el «visto» del presupuesto. */
function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'ahora mismo';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.floor(hours / 24)} d`;
}
function hostnameOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u.slice(0, 40); }
}
function verdictStyle(v: string): string {
  const s = v.toLowerCase();
  if (/comprar|recomend|adelante|buena|oportunidad/.test(s)) return 'bg-d-green/10 text-d-green';
  if (/evitar|descart|huir|no comprar|malo|alto riesgo/.test(s)) return 'bg-d-red/10 text-d-red';
  return 'bg-d-amber/10 text-d-amber';
}

// Stage taxonomy + the 5-phase grouping come from the single source of truth in
// src/lib/dealer/pipeline.ts (STAGES = atomic linear stages; PHASES = the 5
// work sections shown here and on Operaciones).

const TRANSIT_STEPS = [
  { key: 'comprado', label: 'Comprado en Alemania', icon: ShoppingBag },
  { key: 'en_transporte', label: 'En transporte', icon: Truck },
  { key: 'en_espana', label: 'En España', icon: MapPin },
];

// La definición vive en client-types.ts. Había una copia local aquí y por eso
// los campos nuevos del formulario (variant, features, drive_type…) no
// compilaban: se añadían a una interfaz que esta página no miraba.

/** Las 7 respuestas crudas del asesor, tal cual las marcó el cliente. */
interface AdvisorAnswersRaw {
  usage?: string;
  km?: string;
  occupants?: string;
  childSeats?: string;
  cargo?: string[];
  parking?: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  payment?: string | null;
  tradeIn?: string | null;
  priorities?: string[];
  timeframe?: string | null;
}

// Las respuestas se guardan como claves estables (no como el texto del botón),
// así que la ficha necesita su propio diccionario para volver a leerlas.
const ADVISOR_LABELS: Record<string, Record<string, string>> = {
  usage: {
    ciudad: 'Ciudad, a diario', carretera: 'Carretera todos los días',
    mixto: 'Un poco de todo', trabajo: 'Para trabajar', finde: 'Segundo coche / finde',
  },
  km: {
    'menos-10k': 'Menos de 10.000', '10-20k': '10.000 – 20.000',
    '20-30k': '20.000 – 30.000', 'mas-30k': 'Más de 30.000',
  },
  childSeats: { no: 'sin sillitas', una: 'una sillita', 'dos-o-mas': 'dos o más sillitas' },
  cargo: {
    nada: 'Nada especial', carrito: 'Carrito de bebé', deporte: 'Bicis / deporte',
    perro: 'Perro grande', trabajo: 'Material de trabajo', remolque: 'Remolque',
  },
  parking: {
    'garaje-enchufe': 'Garaje con enchufe', 'garaje-sin-enchufe': 'Garaje sin enchufe',
    'calle-apretada': 'Calle apretada', 'calle-facil': 'Calle sin problema',
  },
  payment: { contado: 'Contado', financiado: 'Financiado', 'no-lo-se': 'No lo sabe' },
  tradeIn: { si: 'entrega su coche', no: 'no entrega', 'sin-coche': 'no tiene coche' },
  priorities: {
    consumo: 'Consumo', espacio: 'Espacio', precio: 'Precio', fiabilidad: 'Fiabilidad',
    potencia: 'Potencia', tecnologia: 'Tecnología', 'valor-residual': 'Valor residual', diseno: 'Diseño',
  },
  timeframe: { ya: 'Ya · este mes', '1-3-meses': '1–3 meses', 'sin-prisa': 'Sin prisa' },
};

const lbl = (group: string, key?: string | null) =>
  key ? (ADVISOR_LABELS[group]?.[key] ?? key) : null;

const ADVISOR_ROWS: { label: string; get: (a: AdvisorAnswersRaw) => string | null }[] = [
  { label: 'Uso principal', get: (a) => lbl('usage', a.usage) },
  { label: 'Km al año', get: (a) => lbl('km', a.km) },
  {
    label: 'Ocupantes',
    get: (a) => [a.occupants, lbl('childSeats', a.childSeats)].filter(Boolean).join(' · ') || null,
  },
  {
    label: 'Transporta',
    get: (a) => a.cargo?.map((c) => lbl('cargo', c)).filter(Boolean).join(' · ') || null,
  },
  { label: 'Aparca', get: (a) => lbl('parking', a.parking) },
  {
    label: 'Presupuesto',
    get: (a) => {
      const money = a.maxPrice
        ? `${a.minPrice ? `${a.minPrice.toLocaleString('es-ES')}–` : 'hasta '}${a.maxPrice.toLocaleString('es-ES')} €`
        : a.minPrice ? `desde ${a.minPrice.toLocaleString('es-ES')} €` : null;
      return [money, lbl('payment', a.payment)].filter(Boolean).join(' · ') || null;
    },
  },
  { label: 'Coche actual', get: (a) => lbl('tradeIn', a.tradeIn) },
  {
    label: 'Le importa',
    get: (a) => a.priorities?.map((p) => lbl('priorities', p)).filter(Boolean).join(' · ') || null,
  },
  { label: 'Plazo', get: (a) => lbl('timeframe', a.timeframe) },
];

interface ClientData {
  id: string;
  client_name: string;
  client_phone: string | null;
  client_email: string | null;
  vehicles: VehicleProfile[] | null;
  make: string | null;
  model: string | null;
  max_price: number | null;
  max_km: number | null;
  min_year: number | null;
  min_cv: number | null;
  fuel: string | null;
  transmission: string | null;
  color: string | null;
  notes: string | null;
  mobile_url: string | null;
  // Puerta B de captación (el asesor de 7 preguntas). Null en el resto de altas.
  source?: string | null;
  advisor_answers?: AdvisorAnswersRaw | null;
  advisor_profile?: { headline?: string; reasons?: string[]; ruledOut?: string[] } | null;
  advisor_models?: { nombre: string; porque?: string }[] | null;
  interest_confirmed_at?: string | null;
  status: string;
  stage: string;
  agreed_price: number | null;
  delivery_eta: string | null;
  runner_packet: { token?: string; lead_id?: string; created_at?: string } | null;
  runner_report: RunnerReport | null;
  transit_progress: Record<string, string> | null;
  runner_expenses: { concept: string; amount: number; ticket_url?: string | null }[] | null;
  actual_purchase: number | null;
  tracking_token: string | null;
  created_at: string;
  updated_at: string;
}

interface LeadData {
  id: string;
  source_url: string;
  status: string;
  is_shortlisted: boolean;
  is_shared?: boolean;
  created_at: string;
  car_analyses: {
    id: string;
    title: string | null;
    car_image_url: string | null;
    result_json: any;
    source_url: string | null;
    country_of_origin: string | null;
  } | null;
}

interface PresupuestoData {
  id: string;
  selling_price: number;
  total_cost: number;
  margin: number;
  status: string;
  sent_at: string | null;
  sent_pdf_path: string | null;
  viewed_at: string | null;   // cliente abrió el enlace público /pr/[id]
  view_count: number | null;
  created_at: string;
  presupuesto_data: PresupuestoContent | null;
  dealer_leads: {
    id: string;
    car_analyses: { title: string | null; car_image_url: string | null } | null;
  } | null;
}

/** On-theme hover tooltip for icon buttons. */
function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="relative group/tip flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-30 whitespace-nowrap rounded-md border border-d-border bg-d-surface-3 px-2 py-1 text-[11px] font-medium text-d-text opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:opacity-100">
        {label}
      </span>
    </div>
  );
}

/** A compact label-over-value stat for the chosen-car deal strip. */
function Stat({ label, value, amber }: { label: string; value: string; amber?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="d-cap mb-0.5">{label}</p>
      <p className={`d-num text-sm font-semibold ${amber ? 'text-d-amber' : 'text-d-text'}`}>{value}</p>
    </div>
  );
}

/** One step of the operación accordion. A step is a DWELL state (the deal can
    sit in it overnight); buttons inside are actions, never structural. Done
    steps collapse to a one-line receipt but reopen fully interactive (accordion,
    not wizard — analyses arriving while you compare is normal business). The
    current step is always open and shows its POSTURE: whose move it is. */
function StepSection({
  id, index, title, icon: Icon, state, posture, days, summary, open, onToggle, children,
}: {
  id?: string;
  index: number;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  state: 'done' | 'current' | 'upcoming';
  posture?: { kind: 'turno' | 'esperando'; label: string; days?: number | null } | null;
  days?: number | null;
  summary?: string;
  open?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
}) {
  if (state === 'upcoming') {
    return (
      <div id={id} className="flex items-center gap-3 py-2.5 border-t border-d-border opacity-45">
        <span className="w-7 h-7 grid place-items-center shrink-0"><Icon className="w-3.5 h-3.5 text-d-dim" /></span>
        <span className="text-[13px] text-d-dim">{index}. {title}</span>
      </div>
    );
  }
  if (state === 'done') {
    return (
      <div id={id} className="border-t border-d-border first:border-t-0">
        <button onClick={onToggle} className="w-full flex items-center gap-3 py-3 text-left hover:bg-d-surface-2/40 transition-colors">
          <span className="w-7 h-7 rounded-full grid place-items-center shrink-0 bg-d-green/10 text-d-green">
            <Check className="w-4 h-4" />
          </span>
          <span className="text-[13px] font-semibold text-d-text-2 shrink-0">{index}. {title}</span>
          {summary && <span className="text-[13px] text-d-dim truncate min-w-0">{summary}</span>}
          <ChevronDown className={`w-3.5 h-3.5 text-d-dim shrink-0 ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && children && <div className="pb-5">{children}</div>}
      </div>
    );
  }
  return (
    <div id={id} className="border-t border-d-border first:border-t-0 py-4">
      <div className="flex items-start gap-3 pb-3">
        <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0 bg-d-accent/15 text-d-accent">
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[17px] font-semibold text-d-text leading-tight">{index}. {title}</span>
            {days != null && days >= 1 && <span className="text-d-dim text-[11px] d-num">· {days} día{days === 1 ? '' : 's'}</span>}
          </div>
          {/* Posture: amber = your move (with the imperative), dim clock =
              waiting on the world (with who + how long). */}
          {posture && (posture.kind === 'turno' ? (
            <p className="text-[13px] mt-1 flex items-center gap-1.5 flex-wrap">
              <span className="w-1.5 h-1.5 rounded-full bg-d-amber shrink-0" />
              <span className="text-d-amber font-medium">Tu turno</span>
              <span className="text-d-muted">— {posture.label}</span>
            </p>
          ) : (
            <p className="text-[13px] mt-1 flex items-center gap-1.5 flex-wrap text-d-dim">
              <Clock className="w-3.5 h-3.5 shrink-0" /> {posture.label}
              {posture.days != null && posture.days >= 1 && <span className="d-num">· hace {posture.days} día{posture.days === 1 ? '' : 's'}</span>}
            </p>
          ))}
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}


type CaseData = { client: ClientData; leads: LeadData[]; presupuestos: PresupuestoData[] };

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const { dealerProfile } = useDealer();
  const queryClient = useQueryClient();
  const deductImportVat = dealerProfile?.deduct_import_vat ?? undefined;

  // Seed from the React Query cache so returning to a case you just viewed
  // renders instantly; the effect below still refetches to revalidate. The page
  // keeps its own state (lots of optimistic updates) — the cache is only the
  // warm start + a write-through target so the next visit is instant too.
  const cached = queryClient.getQueryData<CaseData>(['dealer', 'client', id]);
  const [client, setClient] = useState<ClientData | null>(cached?.client ?? null);
  const [leads, setLeads] = useState<LeadData[]>(cached?.leads ?? []);
  const [presupuestos, setPresupuestos] = useState<PresupuestoData[]>(cached?.presupuestos ?? []);
  const [loading, setLoading] = useState(!cached);
  const [url, setUrl] = useState('');
  const [batchUrls, setBatchUrls] = useState('');
  const [showBatch, setShowBatch] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<string | null>(null);
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);
  const [batchResults, setBatchResults] = useState<{ total: number; queued: number } | null>(null);
  const [updatingStage, setUpdatingStage] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState<any>(null);
  const [expandedLeads, setExpandedLeads] = useState<Set<string>>(new Set());
  // Reopened (non-current) steps of the accordion — the current step is always open.
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set());
  // Steps the dealer folded by hand that would otherwise be open by default.
  const [closedSteps, setClosedSteps] = useState<Set<string>>(new Set());
  const analyzingRef = useRef(false);
  const analyzingRef2 = useRef<HTMLDivElement | null>(null);

  // ---- Feedback layer (2026-07-21 flow redesign) ----
  // Every consequential action announces what happened + what comes next; the
  // stage machine never moves silently anymore. Destructive/undo actions
  // confirm in-theme instead of window.confirm/alert.
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: 'ok' | 'warn' }[]>([]);
  const toastIdRef = useRef(0);
  const notify = useCallback((msg: string, kind: 'ok' | 'warn' = 'ok') => {
    const tid = ++toastIdRef.current;
    setToasts(prev => [...prev, { id: tid, msg, kind }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== tid)), 6500);
  }, []);
  const [confirmBox, setConfirmBox] = useState<{ msg: string; onYes: () => void } | null>(null);
  const askConfirm = (msg: string, onYes: () => void) => setConfirmBox({ msg, onYes });
  // Deal-strip compact/expanded (compact from Propuesta onward) and the
  // one-time first-case intro strip.
  const [stripOpen, setStripOpen] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  useEffect(() => {
    try { if (!localStorage.getItem('dealer_case_intro_v1')) setShowIntro(true); } catch { /* blocked storage */ }
  }, []);
  const dismissIntro = () => {
    setShowIntro(false);
    try { localStorage.setItem('dealer_case_intro_v1', '1'); } catch { /* ignore */ }
  };

  const fetchData = useCallback(async (): Promise<{ client: ClientData; leads: LeadData[]; presupuestos: PresupuestoData[] } | undefined> => {
    if (!id) return;
    if (!session?.access_token) return;
    const res = await fetch(`/api/dealer/clients/${id}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.ok) {
      const data = await res.json();
      const payload: CaseData = { client: data.client, leads: data.leads || [], presupuestos: data.presupuestos || [] };
      setClient(payload.client);
      setLeads(payload.leads);
      setPresupuestos(payload.presupuestos);
      // Write-through so the next visit to this case starts from cache.
      queryClient.setQueryData(['dealer', 'client', id], payload);
      return payload;
    }
  }, [session?.access_token, id, queryClient]);

  // ---- Analysis polling + stuck detection ----
  // Batch analyses run server-side; leads appear linked as each one completes.
  // Poll while any lead is still pending (no analysis, or an in_progress
  // placeholder), give up after 4 min and let the card show its retry state.
  const STUCK_AFTER_MS = 4 * 60_000;
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [retriedAt, setRetriedAt] = useState<Record<string, number>>({});
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const pollTokenRef = useRef(0);

  const leadIsPending = (l: LeadData) =>
    !l.car_analyses || l.car_analyses.result_json?.status === 'in_progress';

  const startPolling = useCallback((timeoutMs = 4 * 60_000) => {
    const token = ++pollTokenRef.current;
    const startedAt = Date.now();
    const tick = async () => {
      if (pollTokenRef.current !== token) return;
      const fresh = await fetchData();
      if (pollTokenRef.current !== token) return;
      setNowTick(Date.now());
      const stillPending = (fresh?.leads || []).some(leadIsPending);
      if (!stillPending || Date.now() - startedAt > timeoutMs) return;
      setTimeout(tick, 5000);
    };
    setTimeout(tick, 5000);
  }, [fetchData]);

  // Invalidate any in-flight poll loop on unmount.
  useEffect(() => () => { pollTokenRef.current++; }, []);

  useEffect(() => {
    fetchData().then(fresh => {
      // Reloading mid-batch: resume polling for any lead still waiting on its analysis.
      if ((fresh?.leads || []).some(leadIsPending)) startPolling();
    }).finally(() => setLoading(false));
  }, [fetchData, startPolling]);

  const retryLead = async (leadId: string) => {
    if (!session?.access_token) return;
    setRetrying(prev => new Set(prev).add(leadId));
    try {
      const res = await fetch(`/api/dealer/leads/${leadId}/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        setRetriedAt(prev => ({ ...prev, [leadId]: Date.now() }));
        setNowTick(Date.now());
        startPolling();
      } else {
        const err = await res.json().catch(() => ({}));
        notify(err.error || 'No se pudo reintentar el análisis', 'warn');
      }
    } finally {
      setRetrying(prev => { const n = new Set(prev); n.delete(leadId); return n; });
    }
  };

  const updateStage = async (newStage: string) => {
    if (!id || !session?.access_token) return;
    setUpdatingStage(true);
    try {
      await fetch(`/api/dealer/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ stage: newStage }),
      });
      setClient(prev => prev ? { ...prev, stage: newStage } : prev);
      // NOTE: openSteps is deliberately NOT wiped here. Wiping it kicked the
      // dealer out of whatever step they were working in the instant the stage
      // moved — analyzing one car collapsed «Buscar y analizar» and dropped
      // them into «Elegir finalista» mid-flow.
    } finally {
      setUpdatingStage(false);
    }
  };

  // Stage only moves FORWARD, as a consequence of real work (first analysis →
  // búsqueda, starring a finalista → selección, enviar presupuesto → acuerdo,
  // guardar acuerdo → runner, coche comprado → tránsito). There is no "Avanzar"
  // button; the only way back is the guarded "Deshacer" in the ⋯ menu.
  const stageIdx = (k: string) => STAGES.findIndex(s => s.key === k);
  const advanceTo = (k: string) => {
    if (!client || client.stage === 'perdido' || client.stage === 'entregado') return;
    if (stageIdx(k) > stageIdx(client.stage)) updateStage(k);
  };
  const markEntregado = async () => {
    await updateStage('entregado');
    notify('Operación entregada 🎉 — cerrada con su margen registrado en tus KPIs.');
  };

  // One-time reconcile after first load: artifacts created on other pages (the
  // presupuesto builder) imply a stage the stored value may lag behind. Derives
  // forward only, never regresses.
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (loading || reconciledRef.current || !client) return;
    reconciledRef.current = true;
    if (client.stage === 'perdido' || client.stage === 'entregado') return;
    if (['solicitud', 'busqueda', 'seleccion'].includes(client.stage) && presupuestos.length) updateStage('propuesta');
    else if (client.stage === 'propuesta' && presupuestos.some(p => p.status === 'enviado')) updateStage('acuerdo');
    else if (client.stage === 'acuerdo' && client.agreed_price != null) updateStage('runner');
  }, [loading, client, presupuestos]);

  const [menuOpen, setMenuOpen] = useState(false);
  const undoPhase = () => {
    if (!client) return;
    setMenuOpen(false);
    if (client.stage === 'entregado') {
      askConfirm('¿Reabrir la entrega? La operación vuelve a «En tránsito».', () => updateStage('transito'));
      return;
    }
    const cur = PHASES.findIndex(p => p.key === phaseOf(client.stage)?.key);
    if (cur <= 0) return;
    const prev = PHASES[cur - 1];
    askConfirm(`¿Deshacer y volver a «${prev.label}»?`, () => updateStage(prev.back));
  };
  const markLost = () => {
    setMenuOpen(false);
    askConfirm('¿Marcar la operación como perdida?', () => updateStage('perdido'));
  };
  // Soft delete → the operación moves to the Papelera and we return to the list.
  const [deleting, setDeleting] = useState(false);
  const deleteOperation = () => {
    if (!id || !session?.access_token) return;
    setMenuOpen(false);
    askConfirm('¿Mover esta operación a la papelera? Podrás restaurarla desde la Papelera.', async () => {
      setDeleting(true);
      try {
        const res = await fetch(`/api/dealer/clients/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session!.access_token}` },
        });
        if (res.ok) {
          queryClient.invalidateQueries({ queryKey: ['dealer', 'operaciones'] });
          queryClient.invalidateQueries({ queryKey: ['dealer', 'papelera'] });
          router.push('/dealer/operaciones');
        } else {
          setDeleting(false);
        }
      } catch {
        setDeleting(false);
      }
    });
  };

  // ---- Aceptación (dentro de Propuesta) + entrega estimada ----
  const [deliveryEta, setDeliveryEta] = useState('');
  const [etaSaved, setEtaSaved] = useState(false);
  const [savingAcuerdo, setSavingAcuerdo] = useState(false);
  const [runnerLink, setRunnerLink] = useState<string | null>(null);
  useEffect(() => {
    if (client) {
      setDeliveryEta(client.delivery_eta || '');
      setActualPurchase(client.actual_purchase != null ? String(client.actual_purchase) : '');
      setExpenses((client.runner_expenses || []).map(e => ({ concept: e.concept, amount: String(e.amount), ticket_url: e.ticket_url ?? null })));
      if (client.runner_packet?.token) setRunnerLink(`${window.location.origin}/runner/${client.runner_packet.token}`);
      if (client.tracking_token) setTrackingLink(`${window.location.origin}/seguimiento/${client.tracking_token}`);
    }
  }, [client]);

  // «Aceptado» on a sent presupuesto: records the agreed price from the quote
  // itself and launches the runner — the old standalone Acuerdo step is gone.
  const acceptPresupuesto = async (presu: PresupuestoData) => {
    if (!id || !session?.access_token) return;
    setSavingAcuerdo(true);
    try {
      await fetch(`/api/dealer/presupuesto/${presu.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ status: 'aceptado' }),
      });
      const body = {
        agreed_price: presu.selling_price ?? null,
        agreed_at: new Date().toISOString(),
      };
      await putClient(body);
      setPresupuestos(prev => prev.map(p => p.id === presu.id ? { ...p, status: 'aceptado' } : p));
      setClient(prev => prev ? { ...prev, agreed_price: body.agreed_price } : prev);
      advanceTo('runner'); // deal recorded = launch the runner
      notify(`Aceptado${presu.selling_price != null ? ` por ${eur(presu.selling_price)} €` : ''} — precio acordado registrado. La operación pasa a Runner: prepara la ficha para tu chico.`);
    } finally {
      setSavingAcuerdo(false);
    }
  };

  // ---- Runner ----
  const [genChecklist, setGenChecklist] = useState(false);
  const [checklistReady, setChecklistReady] = useState(false);
  const [sharingRunner, setSharingRunner] = useState(false);
  const [runnerCopied, setRunnerCopied] = useState(false);

  const chosenLead = leads.find(l => l.is_shortlisted) || leads.find(l => l.car_analyses?.id) || null;

  const generateChecklist = async () => {
    const analysisId = chosenLead?.car_analyses?.id;
    if (!analysisId || !session?.access_token) return;
    setGenChecklist(true);
    try {
      const res = await fetch('/api/generate-inspection-checklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ analysisId }),
      });
      if (res.ok) setChecklistReady(true);
    } finally {
      setGenChecklist(false);
    }
  };

  const shareRunner = async () => {
    if (!id || !session?.access_token || !chosenLead) return;
    setSharingRunner(true);
    try {
      const token = (client?.runner_packet?.token) || crypto.randomUUID().replace(/-/g, '');
      const runner_packet = { token, lead_id: chosenLead.id, created_at: new Date().toISOString() };
      await fetch(`/api/dealer/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ runner_packet }),
      });
      setClient(prev => prev ? { ...prev, runner_packet } : prev);
      const link = `${window.location.origin}/runner/${token}`;
      setRunnerLink(link);
      try { await navigator.clipboard.writeText(link); setRunnerCopied(true); setTimeout(() => setRunnerCopied(false), 2000); } catch {}
    } finally {
      setSharingRunner(false);
    }
  };

  // Send the runner packet link over WhatsApp. The runner ("tu chico") isn't a
  // stored contact, so we open WhatsApp with the message + link pre-filled and no
  // number — the dealer picks their runner from the contact list.
  const shareRunnerWhatsApp = () => {
    const link = runnerLink || (client?.runner_packet?.token ? `${window.location.origin}/runner/${client.runner_packet.token}` : null);
    if (!link) return;
    const car = chosenLead?.car_analyses?.title || 'el coche';
    const text = `Ficha de inspección de ${car}. Ábrela desde el móvil cuando llegues:\n${link}\n\nHaz las fotos y marca la revisión paso a paso desde ahí. Los gastos del viaje (vuelo, gasolina, peajes…) los añades en el mismo enlace.`;
    window.open(waLink(null, text), '_blank');
  };

  // One click: generate the inspection checklist (if needed) + mint & copy the link.
  const [preparingRunner, setPreparingRunner] = useState(false);
  const prepareAndShareRunner = async () => {
    setPreparingRunner(true);
    try {
      await generateChecklist();
      await shareRunner();
      notify('Ficha del runner lista y enlace copiado — pégaselo a tu chico por WhatsApp. Su informe aparecerá aquí.');
    } finally {
      setPreparingRunner(false);
    }
  };

  const putClient = async (body: Record<string, unknown>) => {
    if (!id || !session?.access_token) return;
    await fetch(`/api/dealer/clients/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
  };

  // ---- Preview + download modal (opened from the list "Enviar" button) ----
  const [previewPresu, setPreviewPresu] = useState<PresupuestoData | null>(null);
  const [downloadingPreview, setDownloadingPreview] = useState(false);
  const previewHtml = useMemo(
    () => (previewPresu?.presupuesto_data ? renderPresupuestoHtml(previewPresu.presupuesto_data) : ''),
    [previewPresu],
  );

  // Show/hide the price in the client-facing document without leaving the flow.
  // The selling price stays stored (margin math is unaffected) — only the PDF
  // changes. Saved before generating so the archived snapshot matches.
  const [togglingPrice, setTogglingPrice] = useState(false);
  const setPresuShowPrice = async (presu: PresupuestoData, show: boolean) => {
    if (!session?.access_token || !presu.presupuesto_data) return;
    const next = { ...presu.presupuesto_data, showPrice: show };
    if (!show && !(next.priceHiddenLabel ?? '').trim()) next.priceHiddenLabel = 'A consultar';
    setTogglingPrice(true);
    try {
      setPreviewPresu(p => (p && p.id === presu.id ? { ...p, presupuesto_data: next } : p));
      setPresupuestos(prev => prev.map(p => p.id === presu.id ? { ...p, presupuesto_data: next } : p));
      await fetch(`/api/dealer/presupuesto/${presu.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ presupuesto_data: next }),
      });
    } finally {
      setTogglingPrice(false);
    }
  };

  // Download the PDF for the dealer to forward, and record the presupuesto as
  // sent (freezes the snapshot + advances the pipeline so "Aceptado" appears).
  const downloadPresuPdf = async (presu: PresupuestoData) => {
    if (!session?.access_token || !presu.presupuesto_data) return;
    setDownloadingPreview(true);
    try {
      const title = (presu.presupuesto_data.title || presu.dealer_leads?.car_analyses?.title || 'coche').slice(0, 40);
      const res = await fetch('/api/dealer/presupuesto-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ data: presu.presupuesto_data, filename: `presupuesto-${title}` }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `presupuesto-${title.replace(/[^a-z0-9]/gi, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      // Downloading it IS sending it to the client → mark enviado (unless already).
      if (presu.status !== 'enviado' && presu.status !== 'aceptado') await sendPresupuesto(presu.id);
      setPreviewPresu(null);
      notify('PDF descargado y presupuesto marcado como enviado — mándaselo al cliente por WhatsApp o email.');
    } finally {
      setDownloadingPreview(false);
    }
  };

  // ---- Send presupuesto (store-on-send PDF snapshot) ----
  const sendPresupuesto = async (pid: string): Promise<{ public_url?: string } | null> => {
    if (!session?.access_token) return null;
    const res = await fetch(`/api/dealer/presupuesto/${pid}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) return null;
    const d = await res.json();
    setPresupuestos(prev => prev.map(p => p.id === pid ? { ...p, status: 'enviado', sent_pdf_path: d.sent_pdf_url, sent_at: new Date().toISOString() } : p));
    advanceTo('acuerdo'); // sent to the client = waiting on / recording their answer
    return d;
  };

  // ---- Send by WhatsApp: the main way a presupuesto reaches the client ----
  // Opens the client's chat with the message + public link pre-filled, from the
  // dealer's own number (which is what the client expects to see). The link
  // beats attaching the PDF: it previews in the chat, reads fine on a phone,
  // and tells us when the client opens it.
  const [sendingWa, setSendingWa] = useState(false);
  const presuPublicUrl = (pid: string) => `${publicOrigin()}/pr/${pid}`;

  const sendPresupuestoWhatsApp = async (presu: PresupuestoData) => {
    if (!session?.access_token) return;
    // Opened synchronously inside the click gesture — after an await the popup
    // blocker would swallow it.
    const win = window.open('', '_blank');
    setSendingWa(true);
    try {
      let url = presuPublicUrl(presu.id);
      if (presu.status !== 'enviado' && presu.status !== 'aceptado') {
        const sent = await sendPresupuesto(presu.id);
        if (!sent) {
          win?.close();
          notify('No se pudo preparar el envío. Inténtalo otra vez.', 'warn');
          return;
        }
        url = sent.public_url || url;
      }
      const car = presu.presupuesto_data?.title || presu.dealer_leads?.car_analyses?.title || 'el coche';
      const name = (client?.client_name || '').split(' ')[0];
      const text = `Hola${name ? ` ${name}` : ''}, te paso el presupuesto de ${car}:\n${url}\n\nCualquier duda, me dices.`;
      const phone = waNumber(client?.client_phone);
      const target = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
      if (win) win.location.href = target;
      else window.open(target, '_blank');
      setPreviewPresu(null);
      notify(phone
        ? 'WhatsApp abierto con el presupuesto — dale a enviar. Aquí verás cuándo lo abre el cliente.'
        : 'WhatsApp abierto con el mensaje — elige el contacto y envía. Aquí verás cuándo lo abre el cliente.');
    } finally {
      setSendingWa(false);
    }
  };

  const copyPresuLink = async (presu: PresupuestoData) => {
    let url = presuPublicUrl(presu.id);
    if (presu.status !== 'enviado' && presu.status !== 'aceptado') {
      const sent = await sendPresupuesto(presu.id);
      if (!sent) { notify('No se pudo preparar el enlace. Inténtalo otra vez.', 'warn'); return; }
      url = sent.public_url || url;
    }
    try {
      await navigator.clipboard.writeText(url);
      notify('Enlace copiado — pégalo donde quieras (email, SMS, tu CRM).');
    } catch {
      notify(`Copia el enlace a mano: ${url}`, 'warn');
    }
  };

  // ---- Bulk: one presupuesto per finalist, so the dealer can send 4–5 cars at
  // once. Each is seeded exactly like the editor would (purchase/selling from the
  // analysis + full PDF content), then refined/sent from the list below. ----
  const [bulkCreating, setBulkCreating] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);

  // Finalists that still don't have a presupuesto (by lead id).
  const finalistsWithoutPresu = leads.filter(l =>
    l.is_shortlisted && l.car_analyses?.id &&
    !presupuestos.some(p => p.dealer_leads?.id === l.id));

  const seedPayloadForLead = (lead: LeadData) => {
    const ca = lead.car_analyses!;
    const rj = ca.result_json || {};
    const rent = rj.analisis_rentabilidad || {};
    const reco = rj.recomendacion_final || {};
    const dp: any = dealerProfile || {};
    // Same net/gross purchase basis the editor picks for deductible imports.
    const iva = rent.iva_import ?? null;
    const useNet = !!(iva?.vat_deductible && dp?.deduct_import_vat);
    const fallbackPrice = reco.precio_maximo_compra ?? rj.precio_publicado ?? rj.precio ?? 0;
    const purchase = iva ? Math.round(useNet ? iva.precio_neto : iva.precio_bruto) : fallbackPrice;
    const transport = dp?.default_transport ?? 0;
    const gestoria = dp?.default_gestoria ?? 0;
    const itv = dp?.default_itv ?? 0;
    const plates = dp?.default_plates ?? 0;
    const estVenta = rent.precio_venta_estimado ?? reco.precio_objetivo_venta ?? rj.precio_venta_estimado ?? null;
    const selling = estVenta
      ? Math.round(estVenta)
      : Math.round((purchase + (transport || 500) + (gestoria || 180) + (itv || 160) + (plates || 60)) * (1 + (dp?.default_margin_pct || 15) / 100));
    const docDate = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    const presupuesto_data = buildInitialPresupuestoData({ analysis: ca, dealer: dp, sellingPrice: selling, docDate, ref: '' });
    return {
      lead_id: lead.id,
      analysis_id: ca.id,
      purchase_price: purchase,
      transport_cost: transport,
      gestoria_cost: gestoria,
      itv_cost: itv,
      plates_cost: plates,
      insurance_cost: 0,
      other_costs: [],
      selling_price: presupuesto_data.price,
      presupuesto_data,
      purchase_price_is_net: useNet,
    };
  };

  // Create a presupuesto for one lead IN-PAGE (seeded from its analysis), instead
  // of navigating to the standalone builder — keeps the dealer inside the
  // operation. Editing the fine numbers stays available via the builder link.
  const createPresupuestoForLead = async (lead: LeadData) => {
    if (!session?.access_token || !lead.car_analyses?.id) return;
    setBulkCreating(true);
    try {
      await fetch('/api/dealer/presupuesto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(seedPayloadForLead(lead)),
      });
      await fetchData();
      advanceTo('propuesta');
      notify('Presupuesto creado con los precios del análisis — fase Propuesta. Revísalo y descárgalo para enviárselo al cliente.');
    } finally {
      setBulkCreating(false);
    }
  };

  const bulkCreatePresupuestos = async () => {
    if (!session?.access_token || finalistsWithoutPresu.length === 0) return;
    const n = finalistsWithoutPresu.length;
    setBulkCreating(true);
    try {
      for (const lead of finalistsWithoutPresu) {
        await fetch('/api/dealer/presupuesto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify(seedPayloadForLead(lead)),
        });
      }
      await fetchData();
      advanceTo('propuesta');
      notify(`${n} presupuestos creados con los precios de cada análisis — fase Propuesta. Revísalos y descárgalos para enviárselos al cliente.`);
    } finally {
      setBulkCreating(false);
    }
  };

  // Freeze + mark-sent every still-draft presupuesto (send only archives a PDF
  // snapshot; it emails nobody), so all cars go out together.
  const sendAllDrafts = async () => {
    const drafts = presupuestos.filter(p => p.status !== 'enviado' && p.status !== 'aceptado');
    if (drafts.length === 0) return;
    setSendingAll(true);
    try {
      for (const p of drafts) await sendPresupuesto(p.id);
      notify(`${drafts.length} presupuestos marcados como enviados — el PDF de cada uno queda archivado en «Lo enviado». El envío al cliente lo haces tú.`);
    } finally {
      setSendingAll(false);
    }
  };

  // ---- Transit tracking ----
  const [savingTransit, setSavingTransit] = useState(false);
  const [trackingLink, setTrackingLink] = useState<string | null>(null);
  const [sharingTracking, setSharingTracking] = useState(false);
  const [trackingCopied, setTrackingCopied] = useState(false);

  const stampMilestone = (key: string) => {
    if (!client) return;
    const label = TRANSIT_STEPS.find(s => s.key === key)?.label || key;
    const already = !!client.transit_progress?.[key];
    const apply = async () => {
      const progress = { ...(client.transit_progress || {}) };
      if (progress[key]) delete progress[key]; else progress[key] = new Date().toISOString();
      setSavingTransit(true);
      try {
        await putClient({ transit_progress: progress });
        setClient(prev => prev ? { ...prev, transit_progress: progress } : prev);
        if (!already) notify(`«${label}» registrado — el cliente lo verá en su página de seguimiento.`);
      } finally {
        setSavingTransit(false);
      }
    };
    // Stamping is one click; UN-stamping (an easy mis-click on a done row) confirms.
    if (already) askConfirm(`¿Quitar la marca de «${label}»?`, apply); else apply();
  };

  // Buying the car IS the runner → entrega transition: stamp the milestone, advance.
  const [markingComprado, setMarkingComprado] = useState(false);
  const markComprado = async () => {
    if (!client) return;
    setMarkingComprado(true);
    try {
      const progress = { ...(client.transit_progress || {}), comprado: client.transit_progress?.comprado || new Date().toISOString() };
      await putClient({ transit_progress: progress });
      setClient(prev => prev ? { ...prev, transit_progress: progress } : prev);
      advanceTo('transito');
      notify('Coche comprado ✓ — la operación pasa a Entrega. Sigue el transporte y comparte el seguimiento con el cliente.');
    } finally {
      setMarkingComprado(false);
    }
  };

  const shareTracking = async () => {
    if (!client) return;
    setSharingTracking(true);
    try {
      const token = client.tracking_token || crypto.randomUUID().replace(/-/g, '');
      await putClient({ tracking_token: token });
      setClient(prev => prev ? { ...prev, tracking_token: token } : prev);
      const link = `${window.location.origin}/seguimiento/${token}`;
      setTrackingLink(link);
      try { await navigator.clipboard.writeText(link); setTrackingCopied(true); setTimeout(() => setTrackingCopied(false), 2000); } catch {}
    } finally {
      setSharingTracking(false);
    }
  };

  // ---- Runner actuals → real margin ----
  const [actualPurchase, setActualPurchase] = useState('');
  const [expenses, setExpenses] = useState<{ concept: string; amount: string; ticket_url?: string | null }[]>([]);
  const [savingActuals, setSavingActuals] = useState(false);
  const [uploadingTicket, setUploadingTicket] = useState<Record<number, boolean>>({});
  const addExpense = () => setExpenses(prev => [...prev, { concept: '', amount: '', ticket_url: null }]);
  const updateExpense = (i: number, field: 'concept' | 'amount', val: string) => setExpenses(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e));
  const setExpenseTicket = (i: number, url: string | null) => setExpenses(prev => prev.map((e, idx) => idx === i ? { ...e, ticket_url: url } : e));
  const removeExpense = (i: number) => setExpenses(prev => prev.filter((_, idx) => idx !== i));
  const uploadTicket = async (i: number, file: File) => {
    setUploadingTicket(u => ({ ...u, [i]: true }));
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await fetch('/api/dealer/expense-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ dataUrl }),
      });
      if (!res.ok) throw new Error();
      const { url } = await res.json();
      setExpenseTicket(i, url);
    } catch {
      notify('No se pudo subir el ticket. Reinténtalo.');
    } finally {
      setUploadingTicket(u => ({ ...u, [i]: false }));
    }
  };
  const saveActuals = async () => {
    setSavingActuals(true);
    try {
      const cleanExp = expenses
        .filter(e => e.concept.trim() || e.amount || e.ticket_url)
        .map(e => ({ concept: e.concept.trim(), amount: Number(e.amount) || 0, ticket_url: e.ticket_url ?? null }));
      const ap = actualPurchase ? Number(actualPurchase) : null;
      await putClient({ actual_purchase: ap, runner_expenses: cleanExp });
      setClient(prev => prev ? { ...prev, actual_purchase: ap, runner_expenses: cleanExp } : prev);
      notify('Gastos guardados — el margen real de la operación queda actualizado.');
    } finally {
      setSavingActuals(false);
    }
  };

  const analyzeCarForClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !session?.access_token || analyzingRef.current) return;
    const target = url.trim();
    analyzingRef.current = true;
    setAnalyzing(true);
    setAnalyzeProgress('Abriendo el anuncio…');
    setUrl('');
    requestAnimationFrame(() => analyzingRef2.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    try {
      const res = await fetch('/api/dealer/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ url: target, client_request_id: id }),
      });
      // Drain the SSE stream (shared parser — see src/lib/analyze-stream.ts):
      // the analysis runs 12–36s and the route only persists the lead's
      // analysis_id right before closing the stream, so we keep the spinner up
      // until the stream ends and refetch exactly on completion. (Without
      // reading the body, fetch resolves on headers → spinner flashed off in
      // ~1s and the old 2s refetch fired long before results existed.)
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as { error?: string }));
        notify(err.error || 'No se pudo lanzar el análisis. Reinténtalo.', 'warn');
        setUrl(target); // give the link back instead of swallowing it
        return;
      }
      // The route inserts the lead row BEFORE streaming, so this refetch (headers
      // are already in) paints the "Analizando…" card immediately instead of
      // leaving the dealer staring at a dead button for 12–36s.
      fetchData();
      await consumeAnalyzeStream(res, { onProgress: m => setAnalyzeProgress(m) });
      const fresh = await fetchData();
      advanceTo('busqueda'); // first candidate analyzed = sourcing is underway
      // Stage moved, but the dealer is still in "analizar" — keep the step open
      // so they can paste the next link (today's car, tomorrow's car).
      setOpenSteps(prev => new Set(prev).add('analizar'));
      // 202 in-progress dedupe (or a dropped stream) can leave the lead pending
      // even though the analysis finishes server-side — poll it home.
      if ((fresh?.leads || []).some(leadIsPending)) startPolling();
    } catch (err) {
      // A thrown `error` event / dropped stream used to fail silently: spinner
      // off, no message, lead stuck pending forever.
      notify(err instanceof Error && err.message ? err.message : 'El análisis falló. Reinténtalo desde la tarjeta del coche.', 'warn');
      await fetchData();
      startPolling(); // the analysis often finishes server-side anyway
    } finally {
      setAnalyzing(false);
      setAnalyzeProgress(null);
      analyzingRef.current = false;
    }
  };

  const batchAnalyze = async () => {
    if (!batchUrls.trim() || !session?.access_token) return;
    setBatchAnalyzing(true);
    setBatchResults(null);
    try {
      const urls = batchUrls
        .split('\n')
        .map(u => u.trim())
        .filter(u => u.length > 0);

      const res = await fetch('/api/dealer/batch-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ urls, client_request_id: id }),
      });

      if (res.ok) {
        const data = await res.json();
        setBatchResults({ total: data.total, queued: data.queued });
        setBatchUrls('');
        await fetchData(); // show the queued leads immediately
        advanceTo('busqueda');
        setOpenSteps(prev => new Set(prev).add('analizar'));
        startPolling();    // then poll until every lead links (or 4 min pass)
        notify(`${data.queued} de ${data.total} análisis en cola — irán apareciendo en «Coches analizados».`);
      } else {
        const err = await res.json();
        notify(err.error || 'Error al analizar', 'warn');
      }
    } finally {
      setBatchAnalyzing(false);
    }
  };

  const toggleShortlist = async (leadId: string, current: boolean) => {
    if (!session?.access_token) return;
    await fetch(`/api/dealer/leads/${leadId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ is_shortlisted: !current }),
    });
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, is_shortlisted: !current } : l));
    if (!current) {
      advanceTo('seleccion'); // first finalist = you're choosing
      notify('★ Finalista marcado. Cuando lo tengas claro, crea el presupuesto en el paso 3.');
    }
  };

  const compareShortlisted = async () => {
    const shortlisted = leads.filter(l => l.is_shortlisted);
    if (shortlisted.length < 2) return;

    if (!session?.access_token) return;
    setComparing(true);
    try {
      const res = await fetch('/api/dealer/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ lead_ids: shortlisted.map(l => l.id), client_request_id: id }),
      });
      if (res.ok) {
        setComparison(await res.json());
      }
    } finally {
      setComparing(false);
    }
  };

  const toggleLead = (leadId: string) => setExpandedLeads(prev => {
    const next = new Set(prev);
    if (next.has(leadId)) next.delete(leadId); else next.add(leadId);
    return next;
  });
  const toggleStep = (key: string, openNow: boolean) => {
    setOpenSteps(prev => {
      const next = new Set(prev);
      if (openNow) next.delete(key); else next.add(key);
      return next;
    });
    setClosedSteps(prev => {
      const next = new Set(prev);
      if (openNow) next.add(key); else next.delete(key);
      return next;
    });
  };
  // "Point, don't describe": empty states open another step and scroll to it
  // instead of telling the dealer to go find it.
  const openStep = (key: string) => {
    setOpenSteps(prev => new Set(prev).add(key));
    setTimeout(() => document.getElementById(`step-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  const shortlistedCount = leads.filter(l => l.is_shortlisted).length;

  // In-app search → tick ads across engines/models → analyze in one batch. The
  // set of already-analyzed URLs marks those ads as done so they aren't re-run.
  const analyzedUrlSet = new Set(leads.map(l => l.source_url));
  const handleSearchAnalyzed = async () => {
    const fresh = await fetchData();
    advanceTo('busqueda'); // first candidate analyzed = sourcing is underway
    setOpenSteps(prev => new Set(prev).add('analizar')); // keep searching/analyzing
    if ((fresh?.leads || []).some(leadIsPending)) startPolling();
  };

  // The vehicle profiles the customer has in mind (one operación, N cars). New
  // rows always carry `vehicles`; fall back to the flat mirror for safety.
  const reqVehicles: VehicleProfile[] = (client?.vehicles && client.vehicles.length)
    ? client.vehicles
    : (client && (client.make || client.mobile_url || client.max_price)
        ? [{ make: client.make, model: client.model, max_price: client.max_price, max_km: client.max_km, min_year: client.min_year, min_cv: client.min_cv, fuel: client.fuel, transmission: client.transmission, color: client.color, mobile_url: client.mobile_url }]
        : []);
  const multiVehicle = reqVehicles.length > 1;

  // One-line description of a vehicle profile (for the multi-car list).
  const vehicleLine = (v: VehicleProfile): string => {
    const p: string[] = [];
    if (v.max_price) p.push(`<${v.max_price.toLocaleString('es-ES')} €`);
    if (v.max_km) p.push(`${(v.max_km / 1000).toFixed(0)}k km`);
    if (v.min_year) p.push(`desde ${v.min_year}`);
    if (v.fuel) p.push(FUEL_LABELS[v.fuel] || v.fuel);
    if (v.transmission) p.push(TRANSMISSION_LABELS[v.transmission] || v.transmission);
    if (v.color) p.push(v.color);
    return p.join(' · ') || 'Sin filtros';
  };

  // Los extras que el cliente marcó como innegociables ya van dentro de
  // `mobile_url` como `fe=`, así que la búsqueda los respeta sola. Se listan
  // aparte para que el dealer sepa por qué salen tan pocos anuncios.
  const mustHaves: string[] = Array.from(
    new Set(reqVehicles.flatMap((v) => v.features ?? [])),
  );
  const niceToHaves: string[] = Array.from(
    new Set(reqVehicles.flatMap((v) => v.nice_to_have ?? [])),
  ).filter((f) => !mustHaves.includes(f));

  // Single-vehicle: the classic label/value chips (unchanged look).
  const prefChips: { label: string; value: string }[] = [];
  if (client && !multiVehicle) {
    const v = reqVehicles[0];
    if (v?.make) prefChips.push({ label: 'Marca', value: [v.make, v.model, (v.engines ?? []).join(' / ') || null, v.variant].filter(Boolean).join(' ') });
    if (v?.max_price) prefChips.push({ label: 'Presupuesto', value: `<${v.max_price.toLocaleString('es-ES')} €` });
    if (v?.max_km) prefChips.push({ label: 'Km máx.', value: `${(v.max_km / 1000).toFixed(0)}k km` });
    if (v?.fuel) prefChips.push({ label: 'Combustible', value: FUEL_LABELS[v.fuel] || v.fuel });
    if (v?.transmission) prefChips.push({ label: 'Cambio', value: TRANSMISSION_LABELS[v.transmission] || v.transmission });
    if (v?.min_year) prefChips.push({ label: 'Año mín.', value: String(v.min_year) });
    if (v?.max_year) prefChips.push({ label: 'Año máx.', value: String(v.max_year) });
    if (v?.drive_type) prefChips.push({ label: 'Tracción', value: DRIVE_TYPES.find(d => d.value === v.drive_type)?.label ?? v.drive_type });
    if (v?.seats) prefChips.push({ label: 'Plazas', value: String(v.seats) });
    if (v?.doors) prefChips.push({ label: 'Puertas', value: DOOR_OPTIONS.find(d => d.value === v.doors)?.label ?? v.doors });
    if (v?.interior_type) prefChips.push({ label: 'Tapicería', value: INTERIOR_TYPES.find(t => t.value === v.interior_type)?.label ?? v.interior_type });
    if (v?.emission_class) prefChips.push({ label: 'Emisiones', value: v.emission_class.replace('EURO', 'Euro ') });
    if (v?.color) prefChips.push({ label: 'Color', value: v.color });
  }

  // Search-link buttons — FALLBACK only: vehicles whose general search isn't
  // already carried by their MotorizationCard (no make/model, or a stage where
  // the cards don't render). The general search per named model lives inside
  // its card, labeled «Búsqueda general».
  const searchLinks = (): ReactNode => {
    const cardsVisible = ['solicitud', 'busqueda'].includes(client?.stage || '');
    const withUrl = reqVehicles.filter(v => v.mobile_url && !(cardsVisible && v.make && v.model));
    if (withUrl.length === 0) return null;
    return (
      <div className="space-y-2">
        {withUrl.map((v, i) => (
          <a key={i} href={v.mobile_url!} target="_blank" rel="noopener" className="d-btn-primary flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold">
            <Search className="w-4 h-4" />
            {multiVehicle
              ? `Buscar${v.make ? ` · ${v.model ? `${v.make} ${v.model}` : v.make}` : ` · coche ${i + 1}`}`
              : 'Buscar en mobile.de'}
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        ))}
      </div>
    );
  };

  // ---- Deal cockpit: money first ----
  const leadViews = leads
    .map(l => ({ lead: l, r: l.car_analyses ? buildAnalysisView(l.car_analyses.result_json, l.car_analyses.title) : null }))
    .filter((v): v is { lead: LeadData; r: AnalysisView } => !!v.r);

  // Presupuesto buckets feeding the step model below.
  const draftPresus = presupuestos.filter(p => p.status !== 'enviado' && p.status !== 'aceptado');
  const sentPresus = presupuestos.filter(p => p.status === 'enviado');
  const poolViews = leadViews.some(v => v.lead.is_shortlisted) ? leadViews.filter(v => v.lead.is_shortlisted) : leadViews;
  // Honesty gate: pick the best CONFIDENT margin for the headline; only fall back
  // to a low-confidence lead when none of the candidates has a trustworthy
  // comparable set — so the deal is never led by a fantasy margin.
  const rankByMargin = (a: { r: AnalysisView }, b: { r: AnalysisView }) => (b.r.margen_bruto ?? -Infinity) - (a.r.margen_bruto ?? -Infinity);
  const confidentLeads = poolViews.filter(v => v.r.margen_bruto != null && !v.r.low_confidence);
  const bestLead = confidentLeads.length
    ? [...confidentLeads].sort(rankByMargin)[0]
    : (poolViews.length ? [...poolViews].sort(rankByMargin)[0] : null);
  const bestPresu = presupuestos.length ? [...presupuestos].sort((a, b) => (b.margin ?? -Infinity) - (a.margin ?? -Infinity))[0] : null;

  let dealMargin: { amount: number; pct: number | null; label: string; low: boolean } | null = null;
  if (bestPresu && bestPresu.margin != null) {
    dealMargin = { amount: bestPresu.margin, pct: bestPresu.total_cost ? Math.round((bestPresu.margin / bestPresu.total_cost) * 100) : null, label: 'Margen del presupuesto', low: false };
  } else if (bestLead && bestLead.r.margen_bruto != null) {
    dealMargin = { amount: bestLead.r.margen_bruto, pct: bestLead.r.margen_porcentaje, label: 'Margen estimado', low: bestLead.r.low_confidence };
  }

  const chosenView = chosenLead?.car_analyses ? buildAnalysisView(chosenLead.car_analyses.result_json, chosenLead.car_analyses.title) : null;
  const fit: { label: string; ok: boolean }[] = [];
  if (chosenView && client) {
    if (client.max_price && chosenView.precio_compra_total != null) fit.push({ label: 'Presupuesto', ok: chosenView.precio_compra_total <= client.max_price });
    if (client.max_km && chosenView.kilometraje != null) fit.push({ label: 'Km', ok: chosenView.kilometraje <= client.max_km });
    if (client.min_year && chosenView.año != null) fit.push({ label: 'Año', ok: chosenView.año >= client.min_year });
  }

  // Internal comparison strip — a dealer-only numeric side-by-side of the
  // shortlisted finalists, built straight from the analyses already in memory
  // (no extra fetch, no AI cost). The qualitative "Comparativa IA" button stays
  // separate. Margin is estimated market data — flagged low-confidence when the
  // comparable set is thin (see docs/DEALER.md §8 trust gate) so the least
  // trustworthy number never silently leads the decision.
  const shortlistViews = leadViews.filter(v => v.lead.is_shortlisted);
  const bestMarginLeadId = shortlistViews
    .filter(v => v.r.margen_bruto != null && !v.r.low_confidence)
    .sort((a, b) => (b.r.margen_bruto ?? -Infinity) - (a.r.margen_bruto ?? -Infinity))[0]?.lead.id ?? null;

  const comparisonStrip: ReactNode = shortlistViews.length >= 2 ? (
    <div className="rounded-xl border border-d-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-d-text text-sm font-semibold flex items-center gap-2"><GitCompare className="w-4 h-4 text-d-accent" /> Comparativa de finalistas</h4>
        <span className="text-d-dim text-[11px]">Solo lo ves tú</span>
      </div>
      <div className="overflow-x-auto -mx-4 px-4 [-webkit-mask-image:linear-gradient(to_right,#000_92%,transparent)] [mask-image:linear-gradient(to_right,#000_92%,transparent)] sm:[-webkit-mask-image:none] sm:[mask-image:none]">
        <table className="text-sm border-collapse min-w-full">
          <thead>
            <tr>
              <th className="text-left font-normal text-d-dim text-[11px] pr-3 pb-2 align-bottom"></th>
              {shortlistViews.map(v => (
                <th key={v.lead.id} className={`text-left font-semibold text-d-text text-xs px-3 pb-2 align-bottom min-w-[120px] ${v.lead.id === bestMarginLeadId ? 'text-d-green' : ''}`}>
                  <span className="line-clamp-2">{v.r.titulo || 'Coche'}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-d-border">
            {[
              { label: 'Precio compra', get: (r: AnalysisView) => r.precio_compra_total != null ? `${eur(r.precio_compra_total)}€` : '—' },
              { label: 'Media mercado ES', get: (r: AnalysisView) => r.precio_medio != null ? `${eur(r.precio_medio)}€` : '—' },
              { label: 'Venta estimada', get: (r: AnalysisView) => r.precio_venta_estimado != null ? `${eur(r.precio_venta_estimado)}€` : '—' },
              { label: 'Fiabilidad', get: (r: AnalysisView) => r.score_radar?.fiabilidad_mecanica ? `${r.score_radar.fiabilidad_mecanica}/10` : '—' },
              { label: 'Coste mant.', get: (r: AnalysisView) => r.score_radar?.coste_mantenimiento ? `${r.score_radar.coste_mantenimiento}/10` : '—' },
              { label: 'Puntuación', get: (r: AnalysisView) => r.score_global != null ? `${r.score_global}/10` : '—' },
              { label: 'Año', get: (r: AnalysisView) => r.año != null ? String(r.año) : '—' },
              { label: 'Km', get: (r: AnalysisView) => r.kilometraje != null ? `${(r.kilometraje / 1000).toFixed(0)}k` : '—' },
            ].map(row => (
              <tr key={row.label}>
                <td className="text-d-dim text-[11px] pr-3 py-1.5 whitespace-nowrap align-top">{row.label}</td>
                {shortlistViews.map(v => (
                  <td key={v.lead.id} className="text-d-text-2 d-num px-3 py-1.5 align-top">{row.get(v.r)}</td>
                ))}
              </tr>
            ))}
            {/* Margin row last, styled — the headline number, honestly caveated. */}
            <tr>
              <td className="text-d-dim text-[11px] pr-3 py-1.5 align-top">Margen est.</td>
              {shortlistViews.map(v => (
                <td key={v.lead.id} className={`px-3 py-1.5 align-top ${v.lead.id === bestMarginLeadId ? 'text-d-green font-semibold' : 'text-d-text-2'}`}>
                  {v.r.margen_bruto != null ? (
                    <div className="d-num">
                      +{eur(v.r.margen_bruto)}€{v.r.margen_porcentaje != null ? ` · ${v.r.margen_porcentaje}%` : ''}
                      {(v.r.low_confidence || (v.r.n_comparables != null && v.r.n_comparables < 3)) && (
                        <span className="block text-d-amber text-[10px] font-normal not-italic">baja confianza{v.r.n_comparables != null ? ` · ${v.r.n_comparables} comp.` : ''}</span>
                      )}
                    </div>
                  ) : '—'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-d-dim text-[11px] mt-2.5 leading-snug">Margen estimado sobre datos de mercado; <span className="text-d-amber">baja confianza</span> = menos de 3 anuncios comparables. Confírmalo antes de decidir.</p>
    </div>
  ) : null;

  // Actual economics from the runner's reported costs → real margin.
  const expensesTotal = (client?.runner_expenses || []).reduce((s, e) => s + (e.amount || 0), 0);
  const salePrice = client?.agreed_price ?? bestPresu?.selling_price ?? null;
  const actualCost = client?.actual_purchase != null ? client.actual_purchase + expensesTotal : null;
  const actualMargin = (actualCost != null && salePrice != null) ? salePrice - actualCost : null;

  const carTitle = chosenLead?.car_analyses?.title || null;

  // Phase geometry — still used by the header stepper, the compact-strip gate
  // and the ⋯ undo menu. The workspace itself renders STEPS (see the step
  // model below), not phases.
  const isLost = client?.stage === 'perdido';
  const delivered = client?.stage === 'entregado';
  const curPhaseIdx = client ? PHASES.findIndex(p => p.key === phaseOf(client.stage)?.key) : 0;
  const effIdx = delivered ? PHASES.length - 1 : Math.max(0, curPhaseIdx);
  const prevPhase = effIdx > 0 ? PHASES[effIdx - 1] : null;

  // ---- The chosen car, made central ----
  // Once a finalist is starred (or any car is analyzed) this hero pins the deal's
  // essentials — identity + Spanish market value (media + venta estimada) + the
  // coches.net search + margin — so they stay visible in every stage without
  // navigating back. Market numbers stay caveated when the comparable set is thin
  // (DEALER.md §7 trust gate).
  const marketLow = !!chosenView && (chosenView.low_confidence || (chosenView.n_comparables != null && chosenView.n_comparables < 3));
  // The chosen car as a full-width deal strip up top (moved out of the old left
  // rail): identity + margin + Spanish market value in one horizontal row. The
  // point margin is SUPPRESSED to "Datos insuficientes" when the comparable set
  // is thin — a confident €/% off ~0 ads is the "margin fantasy" bug (DEALER §7).
  // Hidden while still choosing (búsqueda with no finalist): pinning an unchosen
  // "best candidate" with a headline margin was disorienting — the strip appears
  // the moment a car is actually elegido (or the deal moves past búsqueda).
  const chosenStrip: ReactNode = !client || !chosenView || !chosenLead || (effIdx === 0 && shortlistedCount === 0 && !delivered) ? null : (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4 pt-3 border-t border-d-border">
      {/* Identity */}
      <div className="flex items-center gap-3 min-w-0">
        {chosenLead.car_analyses?.car_image_url && (
          <img src={chosenLead.car_analyses.car_image_url} alt="" className="w-16 h-12 rounded-lg object-cover shrink-0" />
        )}
        <div className="min-w-0">
          <p className="d-cap mb-0.5">{shortlistedCount > 0 ? 'Coche elegido' : 'Mejor candidato'}</p>
          <p className="text-d-text text-sm font-semibold leading-snug truncate max-w-[240px]">{chosenView.titulo || carTitle || 'Coche'}</p>
          {(chosenView.año != null || chosenView.kilometraje != null) && (
            <p className="text-d-dim text-xs d-num">{[chosenView.año, chosenView.kilometraje != null ? `${(chosenView.kilometraje / 1000).toFixed(0)}k km` : null].filter(Boolean).join(' · ')}</p>
          )}
        </div>
      </div>

      {/* Headline margin */}
      {(actualMargin != null || dealMargin) && (
        <div className="min-w-0">
          <p className="d-cap mb-0.5">{actualMargin != null ? 'Margen real' : dealMargin!.label}</p>
          {actualMargin == null && dealMargin!.low ? (
            <span className="text-d-amber text-sm font-semibold inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Datos insuficientes</span>
          ) : (
            <p className={`text-[24px] font-bold tracking-tight leading-none d-num ${actualMargin != null ? (actualMargin >= 0 ? 'text-d-green' : 'text-d-red') : 'text-d-green'}`}>
              {actualMargin != null ? `${actualMargin >= 0 ? '+' : ''}€${eur(actualMargin)}` : `+€${eur(dealMargin!.amount)}`}
              {actualMargin == null && dealMargin!.pct != null && <span className="text-d-dim text-sm font-normal"> · {dealMargin!.pct}%</span>}
            </p>
          )}
        </div>
      )}

      {/* Spanish market value */}
      <div className="flex items-start gap-x-6 gap-y-2 flex-wrap">
        <Stat label="Compra total" value={chosenView.precio_compra_total != null ? `${eur(chosenView.precio_compra_total)}€` : '—'} />
        <Stat label={client.agreed_price != null ? 'Precio acordado' : 'Venta estimada'} value={client.agreed_price != null ? `${eur(client.agreed_price)}€` : chosenView.precio_venta_estimado != null ? `${eur(chosenView.precio_venta_estimado)}€` : '—'} />
        <Stat label="Media mercado ES" value={chosenView.precio_medio != null ? `${eur(chosenView.precio_medio)}€` : '—'} amber={marketLow} />
        <Stat label="Comparables" value={String(chosenView.n_comparables ?? '—')} amber={marketLow} />
      </div>

      {/* Fit chips + market proof */}
      <div className="ml-auto flex items-center gap-2 flex-wrap">
        <span className="text-d-dim text-[10px]">Margen y mercado: solo lo ves tú</span>
        {fit.map((f, i) => (
          <span key={i} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${f.ok ? 'bg-d-green/10 text-d-green' : 'bg-d-red/10 text-d-red'}`}>
            {f.ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />} {f.label}
          </span>
        ))}
        {chosenView.url_busqueda_mercado && (
          <a href={chosenView.url_busqueda_mercado} target="_blank" rel="noopener" className="d-btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs">
            <Search className="w-3.5 h-3.5" /> Mercado ES <ExternalLink className="w-3 h-3" />
          </a>
        )}
        {chosenLead.car_analyses?.source_url && (
          <a href={chosenLead.car_analyses.source_url} target="_blank" rel="noopener" className="text-d-accent text-xs hover:underline inline-flex items-center gap-1">
            mobile.de <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );

  // Vino por el asesor (puerta B): el POR QUÉ busca eso. Es la diferencia entre
  // llamar a un nombre y llamar sabiendo que tiene un bebé, hace 25.000 km y no
  // puede cargar en casa.
  const advisorBlock: ReactNode = client?.advisor_answers ? (
    <div className="mt-3 rounded-lg border border-d-border bg-d-surface-2/60 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="d-pill text-d-green border-d-green/35 bg-d-green/8">Asesor</span>
        {client.interest_confirmed_at && (
          <span className="d-pill text-d-green border-d-green/35 bg-d-green/8">Pidió búsqueda</span>
        )}
        {client.advisor_profile?.headline && (
          <span className="text-d-text-2 text-[12.5px] font-medium truncate">
            {client.advisor_profile.headline}
          </span>
        )}
      </div>

      <div className="grid gap-1">
        {ADVISOR_ROWS.map(({ label, get }) => {
          const value = get(client.advisor_answers!);
          if (!value) return null;
          return (
            <div key={label} className="flex justify-between gap-3 text-[11.8px]">
              <span className="text-d-dim shrink-0">{label}</span>
              <span className="text-d-text-2 font-medium text-right">{value}</span>
            </div>
          );
        })}
      </div>

      {(client.advisor_models?.length ?? 0) > 0 && (
        <div className="mt-2.5 border-t border-d-border pt-2.5">
          <p className="text-d-dim text-[10px] uppercase tracking-[0.12em] d-num mb-1.5">Se le mostró</p>
          <div className="flex flex-wrap gap-1.5">
            {client.advisor_models!.map((m) => (
              <span key={m.nombre} className="d-pill">{m.nombre}</span>
            ))}
          </div>
          <p className="text-d-dim text-[11px] leading-relaxed mt-2">
            Si le enseñas algo fuera de este perfil, tendrás que explicarle por qué te sales de su resultado.
          </p>
        </div>
      )}
    </div>
  ) : null;

  // The client's request — lives at the top of the buscar step.
  const requestBlock: ReactNode = client && (multiVehicle || prefChips.length > 0 || mustHaves.length > 0 || client.notes) ? (
    <div className="space-y-2.5">
      {multiVehicle ? (
        <div className="space-y-1.5">
          {reqVehicles.map((v, i) => (
            <div key={i} className="flex items-baseline gap-2 text-[13px] min-w-0">
              <span className="text-d-text font-medium shrink-0">{[v.make || 'Cualquier marca', v.model, (v.engines ?? []).join(' / ') || null, v.variant].filter(Boolean).join(' ')}</span>
              <span className="text-d-dim truncate">{vehicleLine(v)}</span>
            </div>
          ))}
        </div>
      ) : prefChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {prefChips.map((chip, i) => (
            <span key={i} className="d-pill">{chip.label}&nbsp;<span className="text-d-text d-num">{chip.value}</span></span>
          ))}
        </div>
      )}
      {mustHaves.length > 0 && (
        <p className="text-[12.5px] text-d-muted">
          <span className="text-d-text font-semibold">Innegociable:</span>{' '}
          {mustHaves.map(f => FEATURE_LABELS[f] || f).join(' · ')}
          <span className="text-d-dim"> — ya filtrado en la búsqueda</span>
        </p>
      )}
      {niceToHaves.length > 0 && (
        <p className="text-[12.5px] text-d-dim">
          Le gustaría: {niceToHaves.map(f => FEATURE_LABELS[f] || f).join(' · ')}
        </p>
      )}
      {client.notes && <p className="text-d-muted text-[13px] italic">&quot;{client.notes}&quot;</p>}
      {advisorBlock}
    </div>
  ) : null;

  const analyzeBox = (
    <div className="rounded-xl border border-d-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-d-text text-sm font-semibold">Analizar coche</h4>
        <button onClick={() => setShowBatch(!showBatch)} className="text-xs text-d-accent hover:text-d-text transition-colors flex items-center gap-1">
          <Clipboard className="w-3.5 h-3.5" />
          {showBatch ? 'Un solo link' : 'Pegar varios links'}
        </button>
      </div>
      {showBatch ? (
        <div className="space-y-3">
          <textarea
            value={batchUrls}
            onChange={e => setBatchUrls(e.target.value)}
            placeholder={"Pega varios links de mobile.de (uno por línea):\nhttps://suchen.mobile.de/...\nhttps://suchen.mobile.de/..."}
            className="d-input w-full h-32 px-3 py-2.5 text-sm resize-none font-mono"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-d-dim"><span className="d-num">{batchUrls.split('\n').filter(u => u.trim()).length}</span> URLs</span>
            <Button onClick={batchAnalyze} disabled={batchAnalyzing || !batchUrls.trim()} className="d-btn-primary">
              {batchAnalyzing ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Analizando...</> : <><Sparkles className="w-4 h-4 mr-1" /> Analizar todos</>}
            </Button>
          </div>
          {batchResults && (
            <div className="bg-d-green/10 border border-d-green/20 rounded-lg px-4 py-3 text-sm text-d-green">
              <span className="d-num">{batchResults.queued}</span> de <span className="d-num">{batchResults.total}</span> análisis en cola. Los resultados irán apareciendo.
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <form onSubmit={analyzeCarForClient} className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-d-dim z-10" />
              <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Pega el enlace del coche de mobile.de..." className="d-input w-full pl-10 pr-3 py-2.5 text-sm" />
            </div>
            <Button type="submit" disabled={analyzing || !url.trim()} className="d-btn-primary">
              {analyzing ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Analizando…</> : <><Plus className="w-4 h-4 mr-1" /> Analizar</>}
            </Button>
          </form>
          {/* The analysis runs 12–36s. A one-line spinner next to the button
              read as "nothing happened" until the car popped in further down,
              so the staged card lands right where the dealer just clicked. */}
          {analyzing && (
            <div ref={analyzingRef2} className="pt-1 scroll-mt-24">
              <AnalyzingCard progress={analyzeProgress || ''} subtitle="tarda ~30s — puedes seguir aquí" />
            </div>
          )}
        </div>
      )}
    </div>
  );

  const pendingCount = leads.filter(leadIsPending).length;
  const analyzedCars = (
    <div>
      <h4 className="text-d-text font-semibold text-sm mb-3 flex items-center gap-2">
        Coches analizados <span className="d-num text-d-dim">({leads.length})</span>
        {pendingCount > 0 && (
          <span className="text-d-accent text-xs font-normal inline-flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" /> <span className="d-num">{pendingCount}</span> analizando…
          </span>
        )}
      </h4>
      {leads.length === 0 ? (
        <div className="d-card-dashed py-8 text-center">
          <p className="text-d-dim text-sm">Busca en mobile.de, elige un coche y pega el enlace arriba</p>
        </div>
      ) : (
        <div className="space-y-3">
          {leads.map(lead => {
            const analysis = lead.car_analyses;
            const rj = analysis?.result_json;
            // No analysis yet, or the placeholder row the analyze route creates upfront.
            const analysisPending = !analysis || rj?.status === 'in_progress';
            const analysisFailed = !analysisPending && (rj?.status === 'failed' || !!rj?.error);
            const startedAt = Math.max(new Date(lead.created_at).getTime(), retriedAt[lead.id] || 0);
            const stuck = analysisFailed || (analysisPending && nowTick - startedAt > STUCK_AFTER_MS);
            const r = analysis && !analysisPending && !analysisFailed ? buildAnalysisView(analysis.result_json, analysis.title) : null;
            const price = r?.precio_compra_total;
            const isExpanded = expandedLeads.has(lead.id);
            const hasReport = !!r && (!!r.razonamiento || !!r.veredicto || r.fallos.length > 0 || !!r.score_radar);
            return (
              <div key={lead.id} className={`rounded-xl border p-4 transition-colors ${lead.is_shortlisted ? 'border-d-accent/30 bg-d-accent/5' : 'border-d-border'}`}>
                <div className="flex gap-4">
                  {analysis?.car_image_url && (
                    <img src={analysis.car_image_url} alt="" className="w-16 h-12 sm:w-24 sm:h-16 rounded-lg object-cover shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-d-text text-sm font-semibold truncate">
                        {analysisPending || analysisFailed
                          ? (analysisPending && !stuck
                              ? <span className="inline-flex items-center gap-2 text-d-muted"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analizando…</span>
                              : <span className="text-d-muted">{hostnameOf(lead.source_url)}</span>)
                          : (analysis?.title || r?.titulo || 'Sin título')}
                      </p>
                      {r?.veredicto && (
                        <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${verdictStyle(r.veredicto)}`}>
                          {r.veredicto.split(/[:.–-]/)[0].trim().slice(0, 22)}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-d-muted">
                      {price && <span className="text-d-green font-semibold d-num">{price.toLocaleString('es-ES')}€</span>}
                      {r?.score_global != null && <span className="text-d-accent font-semibold d-num">{r.score_global}/10</span>}
                      {r?.margen_porcentaje != null && (
                        r.low_confidence ? (
                          <Tip label={`Muestra de mercado insuficiente${r.n_comparables != null ? ` (${r.n_comparables} comparables)` : ''} — menos de 3 anuncios. Margen no fiable para fijar el precio de venta; revisa el mercado en coches.net.`}>
                            <span className="text-d-amber inline-flex items-center gap-1 cursor-help">
                              <AlertTriangle className="w-3 h-3" />
                              Margen no fiable
                            </span>
                          </Tip>
                        ) : (
                          <span className="text-d-green">Margen <span className="d-num">{r.margen_porcentaje}%</span></span>
                        )
                      )}
                      {r?.kilometraje && <span className="d-num">{(r.kilometraje / 1000).toFixed(0)}k km</span>}
                      {r?.precio_medio != null && <span className="text-d-dim">Mercado ES <span className="d-num text-d-text-2">{eur(r.precio_medio)}€</span></span>}
                    </div>
                    {stuck && (
                      <div className="flex items-center gap-2 mt-1.5 text-xs">
                        <AlertTriangle className="w-3.5 h-3.5 text-d-amber shrink-0" />
                        <span className="text-d-amber">{analysisFailed ? 'El análisis falló' : 'El análisis no se completó'}</span>
                        <button
                          onClick={() => retryLead(lead.id)}
                          disabled={retrying.has(lead.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-d-border px-2 py-0.5 text-d-text-2 hover:text-d-text hover:bg-d-surface-2 transition-colors disabled:opacity-50"
                        >
                          {retrying.has(lead.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                          Reintentar
                        </button>
                      </div>
                    )}
                    {r && (!!r.n_comparables || r.fallos.length > 0) && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[11px] text-d-dim">
                        {!!r.n_comparables && (
                          r.url_busqueda_mercado ? (
                            <a href={r.url_busqueda_mercado} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-d-accent hover:underline" title="Ver comparables en coches.net">
                              {r.n_comparables} comparables de mercado <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span>{r.n_comparables} comparables de mercado</span>
                          )
                        )}
                        {!!r.n_comparables && r.fallos.length > 0 && <span className="text-d-border">·</span>}
                        {r.fallos.length > 0 && <span>{r.fallos.length} {r.fallos.length === 1 ? 'riesgo' : 'riesgos'} del modelo</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {hasReport && (
                      <Tip label={isExpanded ? 'Ocultar análisis' : 'Ver análisis'}>
                        <button onClick={() => toggleLead(lead.id)} className="text-d-dim hover:text-d-muted p-2 sm:p-1.5 rounded-lg hover:bg-d-surface-2 transition-colors">
                          <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>
                      </Tip>
                    )}
                    {/* Explicit finalista action (not a bare icon) so the next
                        step after analysis is obvious. */}
                    {r && (
                      <button onClick={() => toggleShortlist(lead.id, lead.is_shortlisted)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${lead.is_shortlisted ? 'text-d-accent bg-d-accent/10 hover:bg-d-accent/20' : 'text-d-muted border border-d-border hover:text-d-text hover:bg-d-surface-2'}`}>
                        <Star className={`w-3.5 h-3.5 ${lead.is_shortlisted ? 'fill-d-accent' : ''}`} /> {lead.is_shortlisted ? 'Finalista' : 'Marcar finalista'}
                      </button>
                    )}
                    {analysis?.source_url && (
                      <Tip label="Ver anuncio original">
                        <a href={analysis.source_url} target="_blank" rel="noopener" className="text-d-dim hover:text-d-accent p-2 sm:p-1.5 rounded-lg hover:bg-d-surface-2 transition-colors">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </Tip>
                    )}
                  </div>
                </div>
                {isExpanded && r && (
                  <div className="mt-4 pt-4 border-t border-d-border space-y-4">
                    {r.car_images.length > 1 && (
                      <PhotoStrip images={r.car_images} thumbClass="h-20 w-28" />
                    )}
                    <DealerAnalysisPeek view={r} fullHref={`/dealer/analisis/${analysis!.id}?from=/dealer/clientes/${id}`} deductImportVat={deductImportVat} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderStep = (key: string): ReactNode => {
    if (!client) return null;
    switch (key) {
      // Step 1 — Buscar y analizar: the in-app search (one ranked-motor block
      // per requested model) + the paste box. Reopening this step IS "analizar
      // más coches" — there is no separate fold anymore.
      case 'analizar': {
        const searchAvailable = ['solicitud', 'busqueda', 'seleccion'].includes(client.stage);
        return (
          <div className="space-y-4">
            {requestBlock}
            {searchLinks()}
            {searchAvailable && (
              <BuscarSearch
                vehicles={reqVehicles
                  .filter(v => v.make && v.model)
                  .map(v => ({
                    make: v.make!, model: v.model!, min_year: v.min_year, max_year: v.max_year ?? null, min_cv: v.min_cv ?? null,
                    engines: v.engines ?? null, variant: v.variant ?? null,
                    fuel: v.fuel, max_price: v.max_price, max_km: v.max_km, transmission: v.transmission, mobile_url: v.mobile_url,
                  }))}
                token={session?.access_token || ''}
                requestId={client.id}
                onAnalyzed={handleSearchAnalyzed}
                analyzedUrls={analyzedUrlSet}
              />
            )}
            {analyzeBox}
          </div>
        );
      }
      // Step 2 — Elegir finalista: the analyzed cars, comparison and the ★.
      case 'elegir': {
        const finalistTools = shortlistedCount > 0 ? (
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm text-d-text font-medium inline-flex items-center gap-2">
              <Star className="w-4 h-4 text-d-accent fill-d-accent" /><span className="d-num">{shortlistedCount}</span> finalista{shortlistedCount > 1 ? 's' : ''}
            </span>
            {shortlistedCount >= 2 && (
              <Button onClick={compareShortlisted} disabled={comparing} size="sm" className="d-btn-ghost text-xs">
                {comparing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <GitCompare className="w-3.5 h-3.5 mr-1" />}
                Comparar con IA
              </Button>
            )}
          </div>
        ) : null;

        const aiComparison = comparison ? (
          <div className="rounded-xl border border-d-border p-4">
            <h4 className="text-d-text text-sm font-semibold flex items-center gap-2 mb-3"><GitCompare className="w-4 h-4 text-d-accent" /> Comparativa IA</h4>
            <div className="space-y-4">
              <div>
                <h5 className="text-xs text-d-accent font-semibold uppercase tracking-wide mb-2">Entre modelos</h5>
                <p className="text-d-text-2 text-sm leading-relaxed whitespace-pre-line">{comparison.comparison.cross_model}</p>
              </div>
              {Object.entries(comparison.comparison.per_model || {}).map(([make, text]) => (
                <div key={make}>
                  <h5 className="text-xs text-d-mid font-semibold uppercase tracking-wide mb-2">{make}</h5>
                  <p className="text-d-text-2 text-sm leading-relaxed whitespace-pre-line">{text as string}</p>
                </div>
              ))}
              <div className="bg-d-accent/5 border border-d-accent/20 rounded-lg p-4">
                <h5 className="text-xs text-d-accent font-semibold uppercase tracking-wide mb-2">Recomendación</h5>
                <p className="text-d-text text-sm leading-relaxed">{comparison.comparison.recommendation}</p>
              </div>
            </div>
          </div>
        ) : null;

        return leads.length === 0 ? (
          <p className="text-d-dim text-sm">Analiza el primer coche en el paso 1 — aquí los compararás y elegirás al finalista.</p>
        ) : (
          <div className="space-y-4">
            {/* With ≥2 finalists the comparison rises above the list — that's
                the moment the dealer is deciding between them. */}
            {shortlistedCount >= 2 ? (
              <>
                {finalistTools}
                {comparisonStrip}
                {aiComparison}
                {analyzedCars}
              </>
            ) : (
              <>
                {analyzedCars}
                {finalistTools}
                {comparisonStrip}
                {aiComparison}
              </>
            )}
          </div>
        );
      }
      // Step 3 — Presupuesto al cliente: actions live IN the step — create
      // (single/bulk), per-row Preparar envío / Cliente aceptó, the hand editor
      // as secondary, and the honest bulk "marcar como enviados".
      case 'propuesta': {
        const draftCount = draftPresus.length;
        const canCreate = !!chosenLead?.car_analyses?.id;
        return (
          <div className="space-y-3">
            {presupuestos.length === 0 && canCreate && (
              <div className="flex flex-wrap items-center gap-2">
                {finalistsWithoutPresu.length >= 2 ? (
                  <Button onClick={bulkCreatePresupuestos} disabled={bulkCreating} className="d-btn-primary inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold h-auto">
                    {bulkCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                    Crear los {finalistsWithoutPresu.length} presupuestos
                  </Button>
                ) : (
                  <Button onClick={() => createPresupuestoForLead(chosenLead!)} disabled={bulkCreating} className="d-btn-primary inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold h-auto">
                    {bulkCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                    Crear presupuesto
                  </Button>
                )}
                <Link href={`/dealer/presupuesto/nuevo?lead=${chosenLead!.id}&analysis=${chosenLead!.car_analyses!.id}&client=${client.id}`}
                  className="d-btn-ghost inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold">
                  A mano en el editor
                </Link>
              </div>
            )}
            {presupuestos.length === 0 && canCreate && finalistsWithoutPresu.length >= 2 && (
              <p className="text-d-dim text-xs">Uno por finalista, con los precios de cada análisis — luego afina y envía cada uno.</p>
            )}
            {presupuestos.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {chosenLead?.car_analyses?.id && (
                  <Link href={`/dealer/presupuesto/nuevo?lead=${chosenLead.id}&analysis=${chosenLead.car_analyses.id}&client=${client.id}`}
                    className="d-btn-ghost inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold">
                    <FileText className="w-3.5 h-3.5" /> Otro presupuesto a mano
                  </Link>
                )}
                {draftCount >= 2 && (
                  <Button onClick={sendAllDrafts} disabled={sendingAll} className="d-btn-ghost inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold h-auto ml-auto">
                    {sendingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    Marcar los {draftCount} como enviados
                  </Button>
                )}
              </div>
            )}
            {draftCount >= 2 && (
              <p className="text-d-dim text-xs">«Enviado» archiva el PDF de cada presupuesto — el envío al cliente (WhatsApp o email) lo haces tú.</p>
            )}
            {presupuestos.length === 0 ? (
              canCreate ? null : (
                <div className="flex items-center gap-3 flex-wrap">
                  <p className="text-d-dim text-sm">No hay finalista todavía.</p>
                  <button onClick={() => openStep('elegir')} className="d-btn-ghost text-xs px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5">
                    <Search className="w-3.5 h-3.5" /> Ver los coches y marcar ★
                  </button>
                </div>
              )
            ) : (
              <div className="space-y-3">
                {presupuestos.map(presu => (
                  <Link key={presu.id} href={`/dealer/presupuesto/nuevo?presupuesto=${presu.id}`}>
                    <div className="rounded-xl border border-d-border hover:border-d-accent/40 p-4 cursor-pointer group transition-colors">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-d-text text-sm font-semibold">{presu.dealer_leads?.car_analyses?.title || 'Presupuesto'}</p>
                          <div className="flex items-center gap-3 mt-1 text-xs flex-wrap">
                            <span className="text-d-text font-semibold d-num">{presu.selling_price?.toLocaleString('es-ES')}€</span>
                            <span className="text-d-green d-num">+{presu.margin?.toLocaleString('es-ES')}€</span>
                            <LeadStatusBadge status={presu.status} />
                            {presu.presupuesto_data?.showPrice === false && (
                              <span className="text-d-dim inline-flex items-center gap-1"><EyeOff className="w-3 h-3" /> sin precio</span>
                            )}
                            {/* La señal que da el enlace y no daba el PDF. */}
                            {presu.viewed_at ? (
                              <span className="text-d-green inline-flex items-center gap-1">
                                <Eye className="w-3 h-3" /> Visto {timeAgo(presu.viewed_at)}
                                {(presu.view_count || 0) > 1 && <span className="text-d-dim">· {presu.view_count} veces</span>}
                              </span>
                            ) : presu.sent_at ? (
                              <span className="text-d-dim inline-flex items-center gap-1"><Clock className="w-3 h-3" /> sin abrir</span>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {presu.status !== 'enviado' && presu.status !== 'aceptado' && (
                            <button onClick={e => { e.preventDefault(); e.stopPropagation(); setPreviewPresu(presu); }}
                              className="d-btn-ghost text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1">
                              <Send className="w-3.5 h-3.5" /> Revisar y enviar
                            </button>
                          )}
                          {(presu.status === 'enviado' || presu.status === 'aceptado') && (
                            <Tip label="Reenviar el enlace por WhatsApp">
                              <button onClick={e => { e.preventDefault(); e.stopPropagation(); sendPresupuestoWhatsApp(presu); }} disabled={sendingWa}
                                className="d-btn-ghost text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 disabled:opacity-50">
                                <Send className="w-3.5 h-3.5" /> WhatsApp
                              </button>
                            </Tip>
                          )}
                          {presu.status === 'enviado' && (
                            <button onClick={e => { e.preventDefault(); e.stopPropagation(); acceptPresupuesto(presu); }} disabled={savingAcuerdo}
                              className="text-xs px-2.5 py-1.5 rounded-lg font-semibold inline-flex items-center gap-1 bg-d-green/15 text-d-green border border-d-green/30 hover:bg-d-green/25">
                              {savingAcuerdo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><CheckCircle2 className="w-3.5 h-3.5" /> Cliente aceptó</>}
                            </button>
                          )}
                          {(presu.status === 'enviado' || presu.status === 'aceptado') && presu.sent_pdf_path && (
                            <a href={presu.sent_pdf_path} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} className="d-btn-ghost text-xs px-2.5 py-1.5 inline-flex items-center gap-1">
                              <Download className="w-3.5 h-3.5" /> Lo enviado
                            </a>
                          )}
                          <ChevronRight className="w-4 h-4 text-d-dim group-hover:text-d-muted" />
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      }
      case 'runner':
        return chosenLead ? (
          <div>
            <div className="flex items-center gap-3 mb-3">
              {chosenLead.car_analyses?.car_image_url && <img src={chosenLead.car_analyses.car_image_url} alt="" className="w-16 h-12 rounded-lg object-cover" />}
              <p className="text-d-text text-sm font-medium">{chosenLead.car_analyses?.title || 'Coche elegido'}</p>
            </div>
            {/* ETA moved here from the removed Acuerdo step — saves on pick. */}
            <label className="flex items-center gap-2 mb-3 text-[11px] text-d-dim">
              Entrega estimada
              <input type="date" value={deliveryEta}
                onChange={e => {
                  setDeliveryEta(e.target.value);
                  putClient({ delivery_eta: e.target.value || null }).then(() => { setEtaSaved(true); setTimeout(() => setEtaSaved(false), 2000); });
                  setClient(prev => prev ? { ...prev, delivery_eta: e.target.value || null } : prev);
                }}
                className="d-input px-2.5 py-1.5 text-sm" />
              {etaSaved && <span className="text-d-green inline-flex items-center gap-1"><Check className="w-3 h-3" /> Guardado</span>}
            </label>
            {!runnerLink ? (
              <>
                <p className="text-d-dim text-xs mb-3">Con un clic generamos la checklist de inspección y creamos el enlace para el runner que va a Alemania.</p>
                <Button onClick={prepareAndShareRunner} disabled={preparingRunner} className="d-btn-primary text-sm">
                  {preparingRunner ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Preparando ficha…</> : <><Send className="w-4 h-4 mr-1.5" /> Preparar y compartir ficha</>}
                </Button>
              </>
            ) : (
              <>
                <p className="text-d-green text-sm flex items-center gap-1.5 mb-2"><CheckCircle2 className="w-4 h-4" /> Ficha lista y compartida</p>
                <a href={runnerLink} target="_blank" rel="noopener" className="text-d-accent text-xs hover:underline break-all block">{runnerLink}</a>
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <Button onClick={shareRunnerWhatsApp} className="d-btn-primary text-xs">
                    <Send className="w-3.5 h-3.5 mr-1" /> Enviar por WhatsApp
                  </Button>
                  <Button onClick={shareRunner} disabled={sharingRunner} className="d-btn-ghost text-xs">
                    {runnerCopied ? <><Check className="w-3.5 h-3.5 mr-1" /> Copiado</> : <><Clipboard className="w-3.5 h-3.5 mr-1" /> Copiar enlace</>}
                  </Button>
                  <Button onClick={generateChecklist} disabled={genChecklist} className="d-btn-ghost text-xs">
                    {genChecklist ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null} Regenerar checklist
                  </Button>
                </div>
              </>
            )}
            {client.runner_report ? (
              <RunnerReportReview report={client.runner_report} />
            ) : runnerLink ? (
              <div className="mt-4 rounded-xl border border-dashed border-d-border p-4 flex items-start gap-2.5">
                <ClipboardCheck className="w-4 h-4 text-d-dim shrink-0 mt-0.5" />
                <div>
                  <p className="text-d-text-2 text-sm font-medium">Esperando la inspección del runner</p>
                  <p className="text-d-dim text-xs mt-0.5">Cuando el runner la envíe desde el terreno, la verás aquí mismo: veredicto, hallazgos, km reales, precio final y fotos.</p>
                </div>
              </div>
            ) : null}
            {runnerLink && (
              <div className="mt-4 pt-4 border-t border-d-border">
                <p className="text-d-dim text-xs mb-2.5">Cuando el runner cierre la compra, la operación pasa a entrega:</p>
                <Button onClick={markComprado} disabled={markingComprado} className="d-btn-primary text-sm">
                  {markingComprado ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <ShoppingBag className="w-4 h-4 mr-1.5" />}
                  Coche comprado — pasar a entrega
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-d-dim text-sm">Marca un coche como finalista para preparar la ficha del runner.</p>
            <button onClick={() => openStep('elegir')} className="d-btn-ghost text-xs px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" /> Ver los coches y marcar ★
            </button>
          </div>
        );
      case 'entrega': {
        const apLocal = actualPurchase ? Number(actualPurchase) : 0;
        const expTotalLocal = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
        const realCostLocal = apLocal + expTotalLocal;
        const realMarginLocal = salePrice != null && apLocal ? salePrice - realCostLocal : null;
        return (
          <div className="space-y-4">
            {/* Transit timeline */}
            <div>
              <h4 className="text-sm font-semibold text-d-text mb-2.5">Progreso del envío</h4>
              <div className="space-y-1">
                {TRANSIT_STEPS.map(step => {
                  const at = client.transit_progress?.[step.key];
                  const Icon = step.icon;
                  return (
                    <button key={step.key} onClick={() => stampMilestone(step.key)} disabled={savingTransit} className="w-full flex items-center gap-2.5 text-left py-1.5 hover:bg-d-surface-2/40 rounded-lg px-1.5 -mx-1.5 transition-colors">
                      <span className={`w-6 h-6 rounded-full grid place-items-center shrink-0 ${at ? 'bg-d-green/15 text-d-green' : 'bg-d-surface-2 text-d-dim'}`}>{at ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}</span>
                      <span className={`text-sm ${at ? 'text-d-text' : 'text-d-dim'}`}>{step.label}</span>
                      {at && <span className="text-d-dim text-xs ml-auto d-num">{new Date(at).toLocaleDateString('es-ES')}</span>}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3">
                <Button onClick={shareTracking} disabled={sharingTracking} className="d-btn-ghost text-sm">
                  {sharingTracking ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : trackingCopied ? <Check className="w-4 h-4 mr-1.5" /> : <MapPin className="w-4 h-4 mr-1.5" />}
                  {trackingCopied ? 'Enlace copiado' : 'Compartir seguimiento con el cliente'}
                </Button>
                {trackingLink && <a href={trackingLink} target="_blank" rel="noopener" className="text-d-accent text-xs hover:underline break-all mt-2 block">{trackingLink}</a>}
              </div>
            </div>

            {/* Runner actuals → real margin */}
            <div className="rounded-xl border border-d-border p-4">
              <h4 className="text-sm font-semibold text-d-text flex items-center gap-2"><Receipt className="w-4 h-4 text-d-accent" /> Gastos del runner</h4>
              <p className="text-d-dim text-xs mb-3">El coste real de la operación — se convierte en tu margen real. Los que el runner haya subido desde el terreno (con su ticket) aparecen aquí; edítalos o añade los que falten.</p>
              <label className="block space-y-1 mb-3">
                <span className="block text-[11px] text-d-dim">Precio de compra real (€)</span>
                <input type="number" value={actualPurchase} onChange={e => setActualPurchase(e.target.value)} placeholder="p. ej. 17.500" className="d-input d-num w-full px-3 py-2 text-sm" />
              </label>
              <div className="space-y-2">
                {expenses.map((e, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={e.concept} onChange={ev => updateExpense(i, 'concept', ev.target.value)} placeholder="Vuelo, gasolina, hotel…" className="d-input flex-1 px-2.5 py-1.5 text-sm" />
                    <input type="number" value={e.amount} onChange={ev => updateExpense(i, 'amount', ev.target.value)} placeholder="€" className="d-input d-num w-24 px-2.5 py-1.5 text-sm" />
                    {e.ticket_url ? (
                      <a href={e.ticket_url} target="_blank" rel="noopener" className="relative w-9 h-9 rounded-md overflow-hidden border border-d-border shrink-0 group/tk" title="Ver ticket">
                        <img src={e.ticket_url} alt="ticket" className="w-full h-full object-cover" />
                        <button onClick={ev => { ev.preventDefault(); setExpenseTicket(i, null); }} className="absolute inset-0 bg-black/50 opacity-0 group-hover/tk:opacity-100 grid place-items-center text-white transition-opacity"><X className="w-3.5 h-3.5" /></button>
                      </a>
                    ) : (
                      <label className="cursor-pointer p-2 sm:p-1.5 rounded-md text-d-dim hover:text-d-accent hover:bg-d-surface-2 shrink-0" title="Adjuntar ticket">
                        {uploadingTicket[i] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async ev => { const f = ev.target.files?.[0]; if (f) await uploadTicket(i, f); ev.target.value = ''; }} />
                      </label>
                    )}
                    <button onClick={() => removeExpense(i)} className="text-d-dim hover:text-d-red p-2 sm:p-1 shrink-0"><X className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
              <button onClick={addExpense} className="text-d-accent text-xs mt-2 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Añadir gasto</button>

              <div className="mt-3 pt-3 border-t border-d-border space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-d-dim">Coste real</span><span className="text-d-text d-num">{eur(realCostLocal)}€</span></div>
                {realMarginLocal != null && (
                  <div className="flex justify-between"><span className="text-d-dim">Margen real</span><span className={`font-semibold d-num ${realMarginLocal >= 0 ? 'text-d-green' : 'text-d-red'}`}>{realMarginLocal >= 0 ? '+' : ''}€{eur(realMarginLocal)}</span></div>
                )}
                {dealMargin && <div className="flex justify-between text-xs"><span className="text-d-dim">Estimado</span><span className="text-d-dim d-num">+€{eur(dealMargin.amount)}</span></div>}
              </div>
              <Button onClick={saveActuals} disabled={savingActuals} className="d-btn-primary text-sm mt-3">
                {savingActuals && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />} Guardar gastos
              </Button>
            </div>

            {client.stage === 'entregado' ? (
              <div className="text-center py-2 rounded-xl bg-d-green/5 border border-d-green/20">
                <ShoppingBag className="w-7 h-7 text-d-green mx-auto mb-1.5" />
                <p className="text-d-text font-semibold text-sm">Operación entregada</p>
                {(actualMargin ?? dealMargin?.amount) != null && (
                  <p className="text-d-green text-sm mt-1 d-num">+€{eur((actualMargin ?? dealMargin!.amount))} de margen {actualMargin != null ? 'real' : 'estimado'}</p>
                )}
              </div>
            ) : (
              <Button onClick={markEntregado} disabled={updatingStage} className="d-btn-primary text-sm"><ShoppingBag className="w-4 h-4 mr-1.5" /> Marcar entregado</Button>
            )}
          </div>
        );
      }
      default:
        return null;
    }
  };

  // ---- The step model (2026-07-22): phases → steps → actions ----
  // The workspace renders STEPS — dwell-states a deal can sit in overnight.
  // Buttons are actions inside them; the kanban keeps the 4 coarse phases. A
  // step is done when its artifact exists; the current step is the first
  // not-done one, capped by the stage machine so «Deshacer» works. Each step
  // carries its POSTURE: tu turno (amber + imperative) or esperando (who +
  // since when) — that IS the answer to "¿y ahora qué?", rendered in place.
  const lastSentAt = presupuestos.filter(p => p.sent_at).map(p => p.sent_at!).sort().pop() ?? null;
  const firstPresuAt = presupuestos.map(p => p.created_at).sort()[0] ?? null;
  const firstLeadAt = leads.map(l => l.created_at).sort()[0] ?? null;
  const anyAccepted = !!client && (client.agreed_price != null || presupuestos.some(p => p.status === 'aceptado'));
  const fichaShared = !!(runnerLink || client?.runner_packet?.token);
  const comprado = !!client?.transit_progress?.comprado;

  type Posture = { kind: 'turno' | 'esperando'; label: string; sinceIso?: string | null } | null;
  interface StepModel {
    key: string;
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    done: boolean;
    summary: string;
    posture: Posture;
    sinceIso: string | null;
  }
  const steps: StepModel[] = !client ? [] : [
    {
      key: 'analizar', title: 'Buscar y analizar', icon: Search,
      done: leadViews.length > 0,
      summary: leads.length ? `${leads.length} coche${leads.length === 1 ? '' : 's'} analizados` : 'Sin análisis todavía',
      posture: pendingCount > 0 && leadViews.length === 0
        ? { kind: 'esperando', label: 'Analizando los primeros candidatos — irán apareciendo en el paso 2' }
        : leads.length > 0 && leadViews.length === 0
          ? { kind: 'turno', label: 'los análisis no se completaron — reintenta desde el paso 2' }
          : { kind: 'turno', label: 'busca los candidatos por motorización y analízalos' },
      sinceIso: client.created_at,
    },
    {
      key: 'elegir', title: 'Elegir finalista', icon: Star,
      done: shortlistedCount > 0,
      summary: shortlistedCount > 0
        ? `★ ${chosenView?.titulo || 'finalista'}${shortlistedCount > 1 ? ` · ${shortlistedCount} finalistas` : ''}`
        : leads.length ? `${leadViews.length} de ${leads.length} analizados` : '',
      posture: { kind: 'turno', label: 'compara los análisis y marca tu finalista ★' },
      sinceIso: firstLeadAt,
    },
    {
      key: 'propuesta', title: 'Presupuesto al cliente', icon: FileText,
      done: anyAccepted,
      summary: client.agreed_price != null
        ? `Aceptado · ${eur(client.agreed_price)}€`
        : presupuestos.length ? `${presupuestos.length} presupuesto${presupuestos.length === 1 ? '' : 's'}` : '',
      posture: !chosenLead?.car_analyses?.id
        ? { kind: 'esperando', label: 'Analizando el finalista — el presupuesto sale de su análisis' }
        : presupuestos.length === 0
          ? { kind: 'turno', label: finalistsWithoutPresu.length >= 2 ? `crea los presupuestos de los ${finalistsWithoutPresu.length} finalistas` : 'crea el presupuesto del coche elegido' }
          : draftPresus.length > 0
            ? { kind: 'turno', label: 'descarga el presupuesto y envíaselo al cliente' }
            : sentPresus.length > 0
              ? { kind: 'esperando', label: 'Esperando la respuesta del cliente — cuando acepte, márcalo en su presupuesto', sinceIso: lastSentAt }
              : { kind: 'turno', label: 'revisa los presupuestos' },
      sinceIso: firstPresuAt,
    },
    {
      key: 'runner', title: 'Runner en Alemania', icon: Truck,
      done: comprado,
      summary: comprado
        ? `Comprado · ${new Date(client.transit_progress!.comprado).toLocaleDateString('es-ES')}`
        : fichaShared ? 'Ficha compartida' : '',
      posture: !fichaShared
        ? { kind: 'turno', label: 'prepara la ficha de inspección y compártela con tu runner' }
        : !client.runner_report
          ? { kind: 'esperando', label: 'Esperando la inspección del runner — cuando compre el coche, márcalo', sinceIso: client.runner_packet?.created_at ?? null }
          : { kind: 'turno', label: 'informe recibido — revísalo y marca la compra si se cerró' },
      sinceIso: client.runner_packet?.created_at ?? null,
    },
    {
      key: 'entrega', title: 'Tránsito y entrega', icon: ShoppingBag,
      done: client.stage === 'entregado',
      summary: client.stage === 'entregado' ? 'Entregado' : comprado ? 'En camino a España' : '',
      posture: { kind: 'esperando', label: 'Coche en camino — marca los hitos según avancen y cierra la entrega al llegar', sinceIso: client.transit_progress?.comprado ?? null },
      sinceIso: client.transit_progress?.comprado ?? null,
    },
  ];
  // Current step = first not-done, capped by the stage machine (so «Deshacer»
  // reopens the right step even though its artifacts still exist).
  // Stage caps sit one step AHEAD of the stage's entry action, because each
  // stage's exit action lives in the NEXT step: analyses landing during
  // `busqueda` is choosing territory (cap 1), and `seleccion` (= finalist
  // starred) is presupuesto territory (cap 2). «Deshacer» regresses the stage
  // below these caps (buscar.back = 'busqueda' → reopens elegir).
  const stageStepIdx: Record<string, number> = { solicitud: 0, busqueda: 1, seleccion: 2, propuesta: 2, acuerdo: 2, runner: 3, transito: 4, entregado: 4 };
  const sourcingStage = !!client && ['solicitud', 'busqueda', 'seleccion'].includes(client.stage);
  const artifactIdx = steps.findIndex(s => !s.done);
  const currentStepIdx = !client || isLost
    ? -1
    : delivered
      ? steps.length - 1
      : Math.min(artifactIdx === -1 ? steps.length - 1 : artifactIdx, stageStepIdx[client.stage] ?? 0);

  return (
    <div className="space-y-4 max-w-7xl mx-auto pb-10">
      <Link href="/dealer/operaciones" className="inline-flex items-center gap-2 text-d-muted hover:text-d-text text-sm transition-colors">
        <ArrowLeft className="w-4 h-4" /> Operaciones
      </Link>

      {loading ? (
        <ClientDetailSkeleton />
      ) : !client ? (
        <p className="text-d-dim text-center py-12">Cliente no encontrado</p>
      ) : (
        <>
          {/* Case header — the ONE stage signal. Stage moves by doing the work,
              not from here; the ⋯ menu holds the rare escape hatches. */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="min-w-0 order-1 md:flex-1">
                <h1 className="text-[22px] font-bold text-d-text tracking-tight leading-tight">
                  {client.client_name}
                  {carTitle && <span className="text-d-dim font-semibold"> · {carTitle}</span>}
                </h1>
                {/* Contact — moved up from the old left rail. */}
                {(client.client_phone || client.client_email) && (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {client.client_phone && (
                      <>
                        <a href={`tel:${client.client_phone}`} className="d-btn-ghost inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs"><Phone className="w-3.5 h-3.5" /> Llamar</a>
                        <a href={`https://wa.me/${client.client_phone.replace(/[^0-9+]/g, '')}`} target="_blank" rel="noopener" className="d-btn-ghost inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs"><Send className="w-3.5 h-3.5" /> WhatsApp</a>
                      </>
                    )}
                    {client.client_email && <a href={`mailto:${client.client_email}`} className="text-d-accent text-xs hover:underline">{client.client_email}</a>}
                  </div>
                )}
              </div>

              {/* Stage stepper — centered in the header row (no wasted row). */}
              <div className="order-3 md:order-2 w-full md:w-auto flex justify-center">
                {isLost ? (
                  <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl border border-d-red/25 bg-d-red/5">
                    <XCircle className="w-4 h-4 text-d-red shrink-0" />
                    <span className="text-[13px] text-d-text-2">Operación perdida.</span>
                    <button onClick={() => updateStage('solicitud')} disabled={updatingStage} className="d-link text-[13px]">Reabrir</button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    {PHASES.map((p, i) => {
                      const done = delivered || i < effIdx;
                      const cur = i === effIdx && !delivered;
                      const short = p.key === 'buscar' ? 'Búsqueda' : p.label;
                      return (
                        <div key={p.key} className="flex items-center gap-2">
                          {/* Hover explains what each phase is and what moves it. */}
                          <Tip label={p.tip}>
                            <span className={`inline-flex items-center gap-1.5 text-xs font-medium transition-colors cursor-default ${cur ? 'text-d-accent' : done ? 'text-d-green' : 'text-d-dim'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${cur ? 'bg-d-accent' : done ? 'bg-d-green' : 'bg-d-surface-3'}`} />
                              {short}
                            </span>
                          </Tip>
                          {i < PHASES.length - 1 && <span className={`w-6 h-px ${done ? 'bg-d-green/40' : 'bg-d-border'}`} />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="relative shrink-0 order-2 md:order-3 ml-auto md:ml-0 md:flex-1 md:flex md:justify-end">
                <button onClick={() => setMenuOpen(v => !v)} aria-label="Más acciones" className="d-btn-ghost p-2 sm:p-1.5 rounded-lg">
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 mt-1.5 z-30 min-w-[230px] rounded-lg border border-d-border bg-d-surface-2 py-1 shadow-xl">
                      {!isLost && (delivered || prevPhase) && (
                        <button onClick={undoPhase} disabled={updatingStage} className="w-full text-left px-3 py-2 text-[13px] text-d-text-2 hover:bg-d-surface-3 hover:text-d-text transition-colors flex items-center gap-2">
                          <ArrowLeft className="w-3.5 h-3.5" /> Deshacer — volver a {delivered ? 'Entrega' : prevPhase!.label}
                        </button>
                      )}
                      {!isLost && !delivered && (
                        <button onClick={markLost} disabled={updatingStage} className="w-full text-left px-3 py-2 text-[13px] text-d-red/90 hover:bg-d-red/10 hover:text-d-red transition-colors flex items-center gap-2">
                          <XCircle className="w-3.5 h-3.5" /> Marcar como perdida
                        </button>
                      )}
                      {isLost && (
                        <button onClick={() => { setMenuOpen(false); updateStage('solicitud'); }} disabled={updatingStage} className="w-full text-left px-3 py-2 text-[13px] text-d-text-2 hover:bg-d-surface-3 hover:text-d-text transition-colors flex items-center gap-2">
                          <RefreshCw className="w-3.5 h-3.5" /> Reabrir operación
                        </button>
                      )}
                      <div className="my-1 border-t border-d-border" />
                      <button onClick={deleteOperation} disabled={deleting} className="w-full text-left px-3 py-2 text-[13px] text-d-red/90 hover:bg-d-red/10 hover:text-d-red transition-colors flex items-center gap-2">
                        {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Mover a la papelera
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Chosen-car deal strip — full while eligiendo; from Propuesta
                onward a compact one-liner (the numbers live in the rows),
                expandable on click. */}
            {effIdx === 0 ? chosenStrip : (chosenStrip && (
              <div className="pt-3 border-t border-d-border">
                <button onClick={() => setStripOpen(v => !v)} className="w-full flex items-center gap-3 text-left">
                  {chosenLead?.car_analyses?.car_image_url && (
                    <img src={chosenLead.car_analyses.car_image_url} alt="" className="w-10 h-8 rounded-md object-cover shrink-0" />
                  )}
                  <span className="text-d-text text-[13px] font-semibold truncate min-w-0">{chosenView?.titulo || carTitle || 'Coche'}</span>
                  {client.agreed_price != null && <span className="d-num text-[13px] text-d-text shrink-0">{eur(client.agreed_price)}€</span>}
                  {actualMargin != null ? (
                    <span className={`d-num text-[13px] font-semibold shrink-0 ${actualMargin >= 0 ? 'text-d-green' : 'text-d-red'}`}>{actualMargin >= 0 ? '+' : ''}€{eur(actualMargin)}</span>
                  ) : dealMargin ? (dealMargin.low
                    ? <span className="text-d-amber text-[11px] shrink-0 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> margen sin datos</span>
                    : <span className="d-num text-[13px] font-semibold text-d-green shrink-0">+€{eur(dealMargin.amount)}</span>
                  ) : null}
                  <ChevronDown className={`w-3.5 h-3.5 text-d-dim ml-auto shrink-0 transition-transform ${stripOpen ? 'rotate-180' : ''}`} />
                </button>
                {stripOpen && chosenStrip}
              </div>
            ))}
          </div>

          {/* One-time intro: sets the mental model (work advances the case; the
              next step always lives in the bottom bar). */}
          {showIntro && (
            <div className="rounded-xl border border-d-accent/25 bg-d-accent/5 px-4 py-3 flex items-start gap-3">
              <Sparkles className="w-4 h-4 text-d-accent shrink-0 mt-0.5" />
              <p className="text-d-text-2 text-[13px] leading-relaxed flex-1">
                Así funciona una operación: <span className="text-d-text">avanza paso a paso según trabajas</span>. <span className="text-d-text">El paso abierto es siempre el que toca</span> — con «Tu turno» o «Esperando a…» debajo del título — y los pasos hechos se pliegan arriba; tócalos para reabrirlos.
              </p>
              <button onClick={dismissIntro} aria-label="Entendido" className="text-d-dim hover:text-d-text p-1 -m-1 shrink-0"><X className="w-4 h-4" /></button>
            </div>
          )}

          {/* The operación as a step accordion: done steps collapse to one-line
              receipts (reopenable, fully interactive), the current step is open
              showing its posture, upcoming steps are ghosts. For a lost deal
              nothing is current — steps keep their done receipts. */}
          <div className="min-w-0">
            {steps.map((s, i) => {
              const state: 'done' | 'current' | 'upcoming' =
                i === currentStepIdx ? 'current' : (s.done || (currentStepIdx !== -1 && i < currentStepIdx)) ? 'done' : 'upcoming';
              // Sourcing never really "finishes": good German ads show up day
              // after day, so «Buscar y analizar» stays open (and reopens on
              // tomorrow's visit) until a presupuesto is on the table. One
              // analysis used to fold it and drop the dealer into «Elegir
              // finalista» with no visible way back to searching.
              const open = state === 'current'
                || (s.key === 'analizar' && sourcingStage && !closedSteps.has(s.key))
                || (state === 'done' && openSteps.has(s.key));
              return (
                <StepSection
                  key={s.key}
                  id={`step-${s.key}`}
                  index={i + 1}
                  title={s.title}
                  icon={s.icon}
                  state={state}
                  posture={state === 'current' && !delivered && s.posture
                    ? { kind: s.posture.kind, label: s.posture.label, days: s.posture.sinceIso ? daysSince(s.posture.sinceIso) : null }
                    : null}
                  days={state === 'current' && !delivered && s.sinceIso ? daysSince(s.sinceIso) : null}
                  summary={s.summary}
                  open={open}
                  onToggle={() => toggleStep(s.key, open)}
                >
                  {open ? renderStep(s.key) : null}
                </StepSection>
              );
            })}
          </div>
        </>
      )}

      {/* Preview + download popup, opened from the propuesta "Enviar" button */}
      {previewPresu && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewPresu(null)}
        >
          <div
            className="d-card w-full max-w-2xl flex flex-col overflow-hidden max-h-[92vh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-d-border shrink-0">
              <div className="min-w-0">
                <p className="text-d-text text-sm font-semibold truncate">{previewPresu.dealer_leads?.car_analyses?.title || 'Presupuesto'}</p>
                <p className="text-d-dim text-xs d-num">{previewPresu.selling_price?.toLocaleString('es-ES')}€</p>
              </div>
              {previewPresu.presupuesto_data && (
                <button
                  onClick={() => setPresuShowPrice(previewPresu, previewPresu.presupuesto_data!.showPrice === false)}
                  disabled={togglingPrice}
                  className="d-btn-ghost text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                >
                  {previewPresu.presupuesto_data.showPrice === false
                    ? <><Eye className="w-3.5 h-3.5" /> Mostrar precio</>
                    : <><EyeOff className="w-3.5 h-3.5" /> Ocultar precio</>}
                </button>
              )}
              <button onClick={() => setPreviewPresu(null)} className="text-d-dim hover:text-d-text p-1 -m-1 shrink-0" aria-label="Cerrar"><X className="w-5 h-5" /></button>
            </div>

            {previewPresu.presupuesto_data ? (
              <div className="bg-white h-[65vh] shrink-0">
                <iframe title="Vista previa del presupuesto" srcDoc={previewHtml} className="w-full h-full border-0" />
              </div>
            ) : (
              <div className="grid place-items-center p-10 text-center">
                <p className="text-d-dim text-sm">Este presupuesto aún no tiene contenido. Ábrelo para completarlo antes de descargarlo.</p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-d-border shrink-0">
              <p className="text-d-dim text-[11px] leading-snug flex-1 min-w-[180px]">
                Se abre WhatsApp {client?.client_phone ? <>con el chat de <span className="text-d-text-2">{client.client_name || 'tu cliente'}</span></> : 'con el mensaje listo'} y el enlace del presupuesto. Sale desde tu número — solo tienes que darle a enviar.
              </p>
              <div className="flex items-center gap-2 ml-auto">
                <button onClick={() => copyPresuLink(previewPresu)} className="d-btn-ghost text-sm px-3 py-2 rounded-lg inline-flex items-center gap-1.5">
                  <Clipboard className="w-3.5 h-3.5" /> Copiar enlace
                </button>
                <button onClick={() => downloadPresuPdf(previewPresu)} disabled={downloadingPreview || !previewPresu.presupuesto_data} className="d-btn-ghost text-sm px-3 py-2 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50">
                  {downloadingPreview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} PDF
                </button>
                <Button onClick={() => sendPresupuestoWhatsApp(previewPresu)} disabled={sendingWa || !previewPresu.presupuesto_data} className="d-btn-primary text-sm">
                  {sendingWa ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Send className="w-4 h-4 mr-1.5" />} Enviar por WhatsApp
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* In-theme confirm (replaces window.confirm) */}
      {confirmBox && (
        <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setConfirmBox(null)}>
          <div className="d-card w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <p className="text-d-text text-sm leading-relaxed">{confirmBox.msg}</p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setConfirmBox(null)} className="d-btn-ghost text-sm px-3.5 py-2 rounded-lg">Cancelar</button>
              <Button onClick={() => { const fn = confirmBox.onYes; setConfirmBox(null); fn(); }} className="d-btn-primary text-sm">Confirmar</Button>
            </div>
          </div>
        </div>
      )}

      {/* Action feedback — confirms what just happened + points at what's next. */}
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] flex w-full max-w-lg flex-col items-center gap-2 px-4 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className={`pointer-events-auto w-full rounded-xl border px-4 py-3 text-[13px] leading-snug shadow-xl backdrop-blur bg-d-surface-2/95 ${t.kind === 'warn' ? 'border-d-amber/30 text-d-amber' : 'border-d-green/25 text-d-text'}`}>
            {t.kind === 'ok' && <Check className="w-3.5 h-3.5 text-d-green inline mr-1.5 -mt-0.5" />}
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
