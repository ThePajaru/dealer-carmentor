'use client';

/**
 * FROZEN SNAPSHOT — the pre-overhaul case page, kept for reference/rollback.
 * Viewable at /dealer/clientes/{id}/legacy. The live page (../page.tsx) is the
 * redesigned version (unified 5-phase spine + persistent "Coche elegido" hero +
 * Spanish market value/coches.net headlined). To restore: copy this back over
 * ../page.tsx. Snapshotted 2026-07-08.
 */

import { useEffect, useState, useRef, useCallback, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import LeadStatusBadge from '@/components/dealer/LeadStatusBadge';
import { Button } from '@/components/ui/button';
import {
  Loader2, ArrowLeft, ExternalLink, Phone, Search, FileText,
  Plus, Send, ChevronRight, ChevronDown, Star, StarOff, GitCompare,
  Clock, CheckCircle2, Truck, ShoppingBag, XCircle, Clipboard,
  Sparkles, AlertTriangle, Check, X, MapPin, Download,
  ShieldCheck, Camera, Ban,
} from 'lucide-react';
import Link from 'next/link';
import { buildAnalysisView, type AnalysisView } from '@/lib/analysis-view';
import { DealerAnalysisReport } from '@/components/dealer/DealerAnalysisReport';
import { PhotoStrip } from '@/components/dealer/PhotoLightbox';
import MotorizationCard from '@/components/dealer/MotorizationCard';
import { consumeAnalyzeStream } from '@/lib/analyze-stream';

const FUEL_LABELS: Record<string, string> = {
  PETROL: 'Gasolina', DIESEL: 'Diésel', ELECTRICITY: 'Eléctrico',
  HYBRID: 'Híbrido', HYBRID_PLUGIN: 'Híbrido enchufable', PLUGINHYBRID: 'Híbrido enchufable',
};

const TRANSMISSION_LABELS: Record<string, string> = {
  AUTOMATIC_GEAR: 'Automático', MANUAL_GEAR: 'Manual',
};

const eur = (n: number) => Math.round(n).toLocaleString('es-ES');
function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}
function verdictStyle(v: string): string {
  const s = v.toLowerCase();
  if (/comprar|recomend|adelante|buena|oportunidad/.test(s)) return 'bg-d-green/10 text-d-green';
  if (/evitar|descart|huir|no comprar|malo|alto riesgo/.test(s)) return 'bg-d-red/10 text-d-red';
  return 'bg-d-amber/10 text-d-amber';
}

// The job pipeline (see docs/DEALER_PIPELINE.md). `entregado` is the terminal
// success step; `perdido` is a separate escape (not in the linear stepper).
const STAGES = [
  { key: 'solicitud', label: 'Solicitud', icon: Clock },
  { key: 'busqueda', label: 'Búsqueda', icon: Search },
  { key: 'seleccion', label: 'Selección', icon: Star },
  { key: 'propuesta', label: 'Propuesta', icon: FileText },
  { key: 'acuerdo', label: 'Acuerdo', icon: CheckCircle2 },
  { key: 'runner', label: 'Runner', icon: Truck },
  { key: 'transito', label: 'En tránsito', icon: Send },
  { key: 'entregado', label: 'Entregado', icon: ShoppingBag },
];

// The right-column workspace groups the granular stages into coherent work
// sections. Each has a `back` stage used when rolling the deal back to it.
const WORK_SECTIONS = [
  { key: 'buscar', label: 'Búsqueda y análisis', icon: Search, stages: ['solicitud', 'busqueda', 'seleccion'], back: 'seleccion' },
  { key: 'propuesta', label: 'Propuesta', icon: FileText, stages: ['propuesta'], back: 'propuesta' },
  { key: 'acuerdo', label: 'Acuerdo', icon: CheckCircle2, stages: ['acuerdo'], back: 'acuerdo' },
  { key: 'runner', label: 'Runner', icon: Truck, stages: ['runner'], back: 'runner' },
  { key: 'entrega', label: 'Entrega', icon: ShoppingBag, stages: ['transito', 'entregado'], back: 'transito' },
];

interface RunnerReport {
  submitted_at: string;
  verdict: 'comprar' | 'no_comprar' | null;
  final_price: number | null;
  real_km: number | null;
  notes: string;
  items: { id: string; title: string; phase: string; status: 'ok' | 'issue' | 'na'; note: string; photo_url: string | null }[];
  dealbreakers: { text: string; status: 'ok' | 'present' }[];
  photos: { label: string; url: string }[];
}

const TRANSIT_STEPS = [
  { key: 'comprado', label: 'Comprado en Alemania', icon: ShoppingBag },
  { key: 'en_transporte', label: 'En transporte', icon: Truck },
  { key: 'en_espana', label: 'En España', icon: MapPin },
];

const NEXT_ACTION: Record<string, string> = {
  solicitud: 'Busca en mobile.de el coche que quiere el cliente.',
  busqueda: 'Pega los enlaces de los coches candidatos para analizarlos.',
  seleccion: 'Revisa los análisis, marca finalistas y genera el presupuesto.',
  propuesta: 'Descarga el PDF del presupuesto y envíaselo al cliente.',
  acuerdo: 'El cliente respondió — registra el precio acordado y el plazo.',
  runner: 'Prepara la info del coche para el runner.',
  transito: 'El coche está en camino — recepción y cierre.',
  entregado: 'Operación cerrada. ¡Enhorabuena!',
  perdido: 'Operación descartada.',
};

interface VehicleProfile {
  make: string | null;
  model: string | null;
  max_price: number | null;
  max_km: number | null;
  min_year: number | null;
  fuel: string | null;
  transmission: string | null;
  color: string | null;
  body_type?: string | null;
  mobile_url: string | null;
}

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
  fuel: string | null;
  transmission: string | null;
  color: string | null;
  notes: string | null;
  mobile_url: string | null;
  status: string;
  stage: string;
  agreed_price: number | null;
  delivery_eta: string | null;
  runner_packet: { token?: string; lead_id?: string } | null;
  runner_report: RunnerReport | null;
  transit_progress: Record<string, string> | null;
  runner_expenses: { concept: string; amount: number }[] | null;
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
  created_at: string;
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

/** Dealer-side review of the field report the runner submitted from Germany. */
function RunnerReportReview({ report }: { report: RunnerReport }) {
  const issues = report.items.filter(i => i.status === 'issue');
  const okCount = report.items.filter(i => i.status === 'ok').length;
  const dbPresent = report.dealbreakers.filter(d => d.status === 'present');
  const buy = report.verdict === 'comprar';
  return (
    <div className="mt-4 rounded-xl border border-d-border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-d-text flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-d-accent" /> Inspección del runner</h4>
        {report.verdict && (
          <span className={`text-xs font-semibold px-2 py-1 rounded-md ${buy ? 'bg-d-green/15 text-d-green' : 'bg-d-red/15 text-d-red'}`}>
            {buy ? 'Comprar' : 'No comprar'}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {okCount > 0 && <span className="d-pill px-2 py-1 text-d-green">{okCount} OK</span>}
        {issues.length > 0 && <span className="d-pill px-2 py-1 text-amber-400">{issues.length} observaciones</span>}
        {report.real_km != null && <span className="d-pill px-2 py-1"><span className="text-d-dim mr-1">Km reales:</span><span className="d-num">{report.real_km.toLocaleString('es-ES')}</span></span>}
        {report.final_price != null && <span className="d-pill px-2 py-1"><span className="text-d-dim mr-1">Precio final:</span><span className="d-num">€{report.final_price.toLocaleString('es-ES')}</span></span>}
      </div>

      {dbPresent.length > 0 && (
        <div className="rounded-lg border border-d-red/30 bg-d-red/5 p-2.5">
          <p className="text-d-red text-xs font-semibold flex items-center gap-1.5 mb-1"><Ban className="w-3.5 h-3.5" /> Dealbreaker presente</p>
          {dbPresent.map((d, i) => <p key={i} className="text-d-text-2 text-xs">• {d.text}</p>)}
        </div>
      )}

      {issues.length > 0 && (
        <div className="space-y-1.5">
          {issues.map((it, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span className="text-d-text-2"><span className="text-d-text font-medium">{it.title}</span>{it.note ? ` — ${it.note}` : ''}</span>
            </div>
          ))}
        </div>
      )}

      {report.notes && <p className="text-d-muted text-xs italic border-l-2 border-d-border pl-2">“{report.notes}”</p>}

      {report.photos.length > 0 && (
        <div>
          <p className="text-d-dim text-[11px] mb-1.5 flex items-center gap-1"><Camera className="w-3 h-3" /> {report.photos.length} fotos</p>
          <div className="grid grid-cols-4 gap-1.5">
            {report.photos.map((p, i) => (
              <a key={i} href={p.url} target="_blank" rel="noopener" className="relative aspect-square rounded-md overflow-hidden border border-d-border">
                <img src={p.url} alt={p.label} className="w-full h-full object-cover" />
              </a>
            ))}
          </div>
        </div>
      )}
      <p className="text-d-dim text-[11px]">Enviada {new Date(report.submitted_at).toLocaleString('es-ES')}</p>
    </div>
  );
}

/** Collapsible work-section shell for the right-column timeline. */
function StageSection({
  icon: Icon, label, status, summary, open, onToggle, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  status: 'current' | 'done';
  summary?: string;
  open: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const isCurrent = status === 'current';
  const header = (
    <div className="w-full flex items-center gap-3 px-4 py-3 text-left">
      <span className={`w-7 h-7 rounded-lg grid place-items-center shrink-0 ${isCurrent ? 'bg-d-accent/15 text-d-accent' : 'bg-d-green/10 text-d-green'}`}>
        {status === 'done' ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-d-text">{label}</span>
          {isCurrent && <span className="text-[10px] uppercase tracking-wide text-d-accent bg-d-accent/10 px-1.5 py-0.5 rounded">Ahora</span>}
        </div>
        {summary && <p className="text-d-dim text-xs truncate mt-0.5">{summary}</p>}
      </div>
      {onToggle && <ChevronDown className={`w-4 h-4 text-d-dim shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />}
    </div>
  );
  return (
    <div className={`d-card overflow-hidden ${isCurrent ? 'd-card-hl border-d-accent/30' : ''}`}>
      {onToggle ? <button onClick={onToggle} className="w-full hover:bg-d-surface-2/40 transition-colors">{header}</button> : header}
      {open && <div className="px-4 pb-4 pt-1 border-t border-d-border">{children}</div>}
    </div>
  );
}

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const [client, setClient] = useState<ClientData | null>(null);
  const [leads, setLeads] = useState<LeadData[]>([]);
  const [presupuestos, setPresupuestos] = useState<PresupuestoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [batchUrls, setBatchUrls] = useState('');
  const [showBatch, setShowBatch] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);
  const [batchResults, setBatchResults] = useState<{ total: number; queued: number } | null>(null);
  const [updatingStage, setUpdatingStage] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState<any>(null);
  const [expandedLeads, setExpandedLeads] = useState<Set<string>>(new Set());
  const [openDone, setOpenDone] = useState<Set<string>>(new Set());
  const analyzingRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (!id) return;
    if (!session?.access_token) return;
    const res = await fetch(`/api/dealer/clients/${id}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setClient(data.client);
      setLeads(data.leads || []);
      setPresupuestos(data.presupuestos || []);
    }
  }, [session?.access_token, id]);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

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
      setOpenDone(new Set());
    } finally {
      setUpdatingStage(false);
    }
  };

  // ---- Acuerdo ----
  const [agreedPrice, setAgreedPrice] = useState('');
  const [deliveryEta, setDeliveryEta] = useState('');
  const [savingAcuerdo, setSavingAcuerdo] = useState(false);
  const [runnerLink, setRunnerLink] = useState<string | null>(null);
  useEffect(() => {
    if (client) {
      setAgreedPrice(client.agreed_price != null ? String(client.agreed_price) : '');
      setDeliveryEta(client.delivery_eta || '');
      setActualPurchase(client.actual_purchase != null ? String(client.actual_purchase) : '');
      setExpenses((client.runner_expenses || []).map(e => ({ concept: e.concept, amount: String(e.amount) })));
      if (client.runner_packet?.token) setRunnerLink(`${window.location.origin}/runner/${client.runner_packet.token}`);
      if (client.tracking_token) setTrackingLink(`${window.location.origin}/seguimiento/${client.tracking_token}`);
    }
  }, [client]);

  const saveAcuerdo = async () => {
    if (!id || !session?.access_token) return;
    setSavingAcuerdo(true);
    try {
      const body = {
        agreed_price: agreedPrice ? Number(agreedPrice) : null,
        agreed_at: new Date().toISOString(),
        delivery_eta: deliveryEta || null,
      };
      await fetch(`/api/dealer/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(body),
      });
      setClient(prev => prev ? { ...prev, agreed_price: body.agreed_price, delivery_eta: body.delivery_eta } : prev);
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

  // One click: generate the inspection checklist (if needed) + mint & copy the link.
  const [preparingRunner, setPreparingRunner] = useState(false);
  const prepareAndShareRunner = async () => {
    setPreparingRunner(true);
    try {
      await generateChecklist();
      await shareRunner();
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

  // ---- Send presupuesto (store-on-send PDF snapshot) ----
  const [sendingId, setSendingId] = useState<string | null>(null);
  const sendPresupuesto = async (pid: string) => {
    if (!session?.access_token) return;
    setSendingId(pid);
    try {
      const res = await fetch(`/api/dealer/presupuesto/${pid}/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const d = await res.json();
        setPresupuestos(prev => prev.map(p => p.id === pid ? { ...p, status: 'enviado', sent_pdf_path: d.sent_pdf_url, sent_at: new Date().toISOString() } : p));
      }
    } finally {
      setSendingId(null);
    }
  };

  // ---- Transit tracking ----
  const [savingTransit, setSavingTransit] = useState(false);
  const [trackingLink, setTrackingLink] = useState<string | null>(null);
  const [sharingTracking, setSharingTracking] = useState(false);
  const [trackingCopied, setTrackingCopied] = useState(false);

  const stampMilestone = async (key: string) => {
    if (!client) return;
    const progress = { ...(client.transit_progress || {}) };
    if (progress[key]) delete progress[key]; else progress[key] = new Date().toISOString();
    setSavingTransit(true);
    try {
      await putClient({ transit_progress: progress });
      setClient(prev => prev ? { ...prev, transit_progress: progress } : prev);
    } finally {
      setSavingTransit(false);
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
  const [expenses, setExpenses] = useState<{ concept: string; amount: string }[]>([]);
  const [savingActuals, setSavingActuals] = useState(false);
  const addExpense = () => setExpenses(prev => [...prev, { concept: '', amount: '' }]);
  const updateExpense = (i: number, field: 'concept' | 'amount', val: string) => setExpenses(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e));
  const removeExpense = (i: number) => setExpenses(prev => prev.filter((_, idx) => idx !== i));
  const saveActuals = async () => {
    setSavingActuals(true);
    try {
      const cleanExp = expenses.filter(e => e.concept.trim() || e.amount).map(e => ({ concept: e.concept.trim(), amount: Number(e.amount) || 0 }));
      const ap = actualPurchase ? Number(actualPurchase) : null;
      await putClient({ actual_purchase: ap, runner_expenses: cleanExp });
      setClient(prev => prev ? { ...prev, actual_purchase: ap, runner_expenses: cleanExp } : prev);
    } finally {
      setSavingActuals(false);
    }
  };

  const analyzeCarForClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !session?.access_token || analyzingRef.current) return;
    analyzingRef.current = true;
    setAnalyzing(true);
    setUrl('');
    try {
      const res = await fetch('/api/dealer/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ url: url.trim(), client_request_id: id }),
      });
      // Drain the SSE stream (shared parser — see src/lib/analyze-stream.ts):
      // the analysis runs 12–36s and the route only persists the lead's
      // analysis_id right before closing the stream, so we keep the spinner up
      // until the stream ends and refetch exactly on completion. (Without
      // reading the body, fetch resolves on headers → spinner flashed off in
      // ~1s and the old 2s refetch fired long before results existed.)
      if (res.ok && res.body) {
        await consumeAnalyzeStream(res);
        await fetchData();
      }
    } finally {
      setAnalyzing(false);
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
        setTimeout(() => fetchData(), 5000);
        setTimeout(() => fetchData(), 15000);
        setTimeout(() => fetchData(), 30000);
      } else {
        const err = await res.json();
        alert(err.error || 'Error al analizar');
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
  const toggleDone = (key: string) => setOpenDone(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const shortlistedCount = leads.filter(l => l.is_shortlisted).length;

  // The vehicle profiles the customer has in mind (one operación, N cars). New
  // rows always carry `vehicles`; fall back to the flat mirror for safety.
  const reqVehicles: VehicleProfile[] = (client?.vehicles && client.vehicles.length)
    ? client.vehicles
    : (client && (client.make || client.mobile_url || client.max_price)
        ? [{ make: client.make, model: client.model, max_price: client.max_price, max_km: client.max_km, min_year: client.min_year, fuel: client.fuel, transmission: client.transmission, color: client.color, mobile_url: client.mobile_url }]
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

  // Single-vehicle: the classic label/value chips (unchanged look).
  const prefChips: { label: string; value: string }[] = [];
  if (client && !multiVehicle) {
    const v = reqVehicles[0];
    if (v?.make) prefChips.push({ label: 'Marca', value: v.model ? `${v.make} ${v.model}` : v.make });
    if (v?.max_price) prefChips.push({ label: 'Presupuesto', value: `<${v.max_price.toLocaleString('es-ES')} €` });
    if (v?.max_km) prefChips.push({ label: 'Km máx.', value: `${(v.max_km / 1000).toFixed(0)}k km` });
    if (v?.fuel) prefChips.push({ label: 'Combustible', value: FUEL_LABELS[v.fuel] || v.fuel });
    if (v?.transmission) prefChips.push({ label: 'Cambio', value: TRANSMISSION_LABELS[v.transmission] || v.transmission });
    if (v?.min_year) prefChips.push({ label: 'Año mín.', value: String(v.min_year) });
    if (v?.color) prefChips.push({ label: 'Color', value: v.color });
  }

  // Search-link buttons — one per vehicle profile that resolved to a URL. Labeled
  // by car when there's more than one; the dealer searches all of them.
  const searchLinks = (): ReactNode => {
    const withUrl = reqVehicles.filter(v => v.mobile_url);
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
  const poolViews = leadViews.some(v => v.lead.is_shortlisted) ? leadViews.filter(v => v.lead.is_shortlisted) : leadViews;
  const bestLead = poolViews.length ? [...poolViews].sort((a, b) => (b.r.margen_bruto ?? -Infinity) - (a.r.margen_bruto ?? -Infinity))[0] : null;
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
      <div className="overflow-x-auto -mx-4 px-4">
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
  const stageLabel = client ? (STAGES.find(s => s.key === client.stage)?.label || (client.stage === 'perdido' ? 'Perdido' : client.stage)) : '';

  const summaryOf = (key: string): string => {
    if (!client) return '';
    switch (key) {
      case 'buscar': return leads.length ? `${leads.length} analizado${leads.length === 1 ? '' : 's'} · ${shortlistedCount} finalista${shortlistedCount === 1 ? '' : 's'}` : 'Sin análisis todavía';
      case 'propuesta': return presupuestos.length ? `${presupuestos.length} presupuesto${presupuestos.length === 1 ? '' : 's'}` : 'Sin presupuestos';
      case 'acuerdo': return client.agreed_price != null ? `${eur(client.agreed_price)}€${client.delivery_eta ? ` · ${new Date(client.delivery_eta).toLocaleDateString('es-ES')}` : ''}` : 'Sin acuerdo';
      case 'runner': return client.runner_packet?.token ? 'Ficha compartida con el runner' : 'Ficha sin preparar';
      case 'entrega': return client.stage === 'entregado' ? 'Entregado' : 'En tránsito';
      default: return '';
    }
  };

  const rollbackBanner = (backStage: string) => (
    <div className="flex items-center justify-between gap-2 mb-3">
      <span className="text-d-dim text-[11px]">Fase completada</span>
      <button onClick={() => updateStage(backStage)} disabled={updatingStage} className="text-d-accent text-xs hover:underline inline-flex items-center gap-1">
        <ArrowLeft className="w-3 h-3" /> Volver a esta fase
      </button>
    </div>
  );

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
        <form onSubmit={analyzeCarForClient} className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-d-dim z-10" />
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Pega el enlace del coche de mobile.de..." className="d-input w-full pl-10 pr-3 py-2.5 text-sm" />
          </div>
          <Button type="submit" disabled={analyzing || !url.trim()} className="d-btn-primary">
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1" /> Analizar</>}
          </Button>
        </form>
      )}
    </div>
  );

  const analyzedCars = (
    <div>
      <h4 className="text-d-text font-semibold text-sm mb-3">Coches analizados <span className="d-num text-d-dim">({leads.length})</span></h4>
      {leads.length === 0 ? (
        <div className="d-card-dashed py-8 text-center">
          <p className="text-d-dim text-sm">Busca en mobile.de, elige un coche y pega el enlace arriba</p>
        </div>
      ) : (
        <div className="space-y-3">
          {leads.map(lead => {
            const analysis = lead.car_analyses;
            const r = analysis ? buildAnalysisView(analysis.result_json, analysis.title) : null;
            const price = r?.precio_compra_total;
            const isExpanded = expandedLeads.has(lead.id);
            const hasReport = !!r && (!!r.razonamiento || !!r.veredicto || r.fallos.length > 0 || !!r.score_radar);
            return (
              <div key={lead.id} className={`rounded-xl border py-4 px-5 transition-colors ${lead.is_shortlisted ? 'border-d-accent/30 bg-d-accent/5' : 'border-d-border'}`}>
                <div className="flex gap-4">
                  {analysis?.car_image_url && (
                    <img src={analysis.car_image_url} alt="" className="w-24 h-16 rounded-lg object-cover shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-d-text text-sm font-semibold truncate">{analysis?.title || r?.titulo || 'Analizando...'}</p>
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
                          <Tip label={`Margen orientativo: muestra de mercado insuficiente${r.n_comparables != null ? ` (${r.n_comparables} comparables)` : ''}. No fiable para fijar el precio de venta — revisa el mercado en coches.net.`}>
                            <span className="text-amber-400 inline-flex items-center gap-1 cursor-help">
                              <AlertTriangle className="w-3 h-3" />
                              Margen ~<span className="d-num">{r.margen_porcentaje}%</span>
                            </span>
                          </Tip>
                        ) : (
                          <span className="text-d-green">Margen <span className="d-num">{r.margen_porcentaje}%</span></span>
                        )
                      )}
                      {r?.kilometraje && <span className="d-num">{(r.kilometraje / 1000).toFixed(0)}k km</span>}
                    </div>
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
                        <button onClick={() => toggleLead(lead.id)} className="text-d-dim hover:text-d-muted p-1.5 rounded-lg hover:bg-d-surface-2 transition-colors">
                          <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>
                      </Tip>
                    )}
                    <Tip label={lead.is_shortlisted ? 'Quitar de finalistas' : 'Marcar como finalista'}>
                      <button onClick={() => toggleShortlist(lead.id, lead.is_shortlisted)} className={`p-1.5 rounded-lg transition-colors ${lead.is_shortlisted ? 'text-d-accent bg-d-accent/10 hover:bg-d-accent/20' : 'text-d-dim hover:text-d-muted hover:bg-d-surface-2'}`}>
                        {lead.is_shortlisted ? <Star className="w-4 h-4 fill-d-accent" /> : <StarOff className="w-4 h-4" />}
                      </button>
                    </Tip>
                    {analysis?.source_url && (
                      <Tip label="Ver anuncio original">
                        <a href={analysis.source_url} target="_blank" rel="noopener" className="text-d-dim hover:text-d-accent p-1.5 rounded-lg hover:bg-d-surface-2 transition-colors">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </Tip>
                    )}
                    {analysis?.id && client && (
                      <Link href={`/dealer/presupuesto/nuevo?lead=${lead.id}&analysis=${analysis.id}&client=${client.id}`}>
                        <Button size="sm" className="d-btn-primary text-xs h-8">
                          <FileText className="w-3.5 h-3.5 mr-1" /> Presup.
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
                {isExpanded && r && (
                  <div className="mt-4 pt-4 border-t border-d-border space-y-4">
                    {r.car_images.length > 1 && (
                      <PhotoStrip images={r.car_images} thumbClass="h-20 w-28" />
                    )}
                    <DealerAnalysisReport view={r} mode="full" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderBody = (key: string): ReactNode => {
    if (!client) return null;
    switch (key) {
      case 'buscar':
        return (
          <div className="space-y-4">
            {client.stage === 'solicitud' && searchLinks()}
            {/* Motorization advisory — auto-loads per named model while sourcing. */}
            {['solicitud', 'busqueda'].includes(client.stage) && reqVehicles
              .filter(v => v.make && v.model)
              .map((v, i) => (
                <MotorizationCard
                  key={`${v.make}-${v.model}-${i}`}
                  make={v.make!}
                  model={v.model!}
                  minYear={v.min_year}
                  fuel={v.fuel}
                  mobileUrl={v.mobile_url}
                  token={session?.access_token || ''}
                />
              ))}
            {analyzeBox}
            {shortlistedCount > 0 && (
              <div className="rounded-xl border border-d-accent/20 bg-d-accent/5 py-3 px-4 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-d-accent" />
                  <span className="text-sm text-d-text font-medium"><span className="d-num">{shortlistedCount}</span> finalista{shortlistedCount > 1 ? 's' : ''}</span>
                </div>
                <div className="flex gap-2">
                  {shortlistedCount >= 2 && (
                    <Button onClick={compareShortlisted} disabled={comparing} size="sm" className="d-btn-ghost text-xs">
                      {comparing ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <GitCompare className="w-3.5 h-3.5 mr-1" />}
                      Comparar
                    </Button>
                  )}
                  {chosenLead?.car_analyses?.id && (
                    <Link href={`/dealer/presupuesto/nuevo?lead=${chosenLead.id}&analysis=${chosenLead.car_analyses.id}&client=${client.id}`}>
                      <Button size="sm" className="d-btn-primary text-xs"><FileText className="w-3.5 h-3.5 mr-1" /> Crear presupuesto</Button>
                    </Link>
                  )}
                </div>
              </div>
            )}
            {comparisonStrip}
            {comparison && (
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
            )}
            {analyzedCars}
          </div>
        );
      case 'propuesta':
        return (
          <div className="space-y-3">
            {chosenLead?.car_analyses?.id && (
              <Link href={`/dealer/presupuesto/nuevo?lead=${chosenLead.id}&analysis=${chosenLead.car_analyses.id}&client=${client.id}`} className="d-btn-primary inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold">
                <FileText className="w-4 h-4" /> {presupuestos.length ? 'Nuevo presupuesto' : 'Crear presupuesto'}
              </Link>
            )}
            {presupuestos.length === 0 ? (
              <p className="text-d-dim text-sm">{chosenLead ? 'Crea el presupuesto del coche elegido para enviárselo al cliente.' : 'Marca un finalista en Búsqueda para poder crear el presupuesto.'}</p>
            ) : (
              <div className="space-y-3">
                {presupuestos.map(presu => (
                  <Link key={presu.id} href={`/dealer/presupuesto/nuevo?presupuesto=${presu.id}`}>
                    <div className="rounded-xl border border-d-border hover:border-d-accent/40 py-4 px-5 cursor-pointer group transition-colors">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-d-text text-sm font-semibold">{presu.dealer_leads?.car_analyses?.title || 'Presupuesto'}</p>
                          <div className="flex items-center gap-3 mt-1 text-xs">
                            <span className="text-d-text font-semibold d-num">{presu.selling_price?.toLocaleString('es-ES')}€</span>
                            <span className="text-d-green d-num">+{presu.margin?.toLocaleString('es-ES')}€</span>
                            <LeadStatusBadge status={presu.status} />
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {presu.status !== 'enviado' ? (
                            <button onClick={e => { e.preventDefault(); e.stopPropagation(); sendPresupuesto(presu.id); }} disabled={sendingId === presu.id} className="d-btn-ghost text-xs px-2.5 py-1.5 inline-flex items-center gap-1">
                              {sendingId === presu.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Send className="w-3.5 h-3.5" /> Enviar</>}
                            </button>
                          ) : presu.sent_pdf_path ? (
                            <a href={presu.sent_pdf_path} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} className="d-btn-ghost text-xs px-2.5 py-1.5 inline-flex items-center gap-1">
                              <Download className="w-3.5 h-3.5" /> Lo enviado
                            </a>
                          ) : null}
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
      case 'acuerdo':
        return (
          <div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="block text-[11px] text-d-dim">Precio acordado (€)</span>
                <input type="number" value={agreedPrice} onChange={e => setAgreedPrice(e.target.value)} className="d-input d-num w-full px-3 py-2 text-sm font-bold" />
              </label>
              <label className="block space-y-1">
                <span className="block text-[11px] text-d-dim">Entrega estimada</span>
                <input type="date" value={deliveryEta} onChange={e => setDeliveryEta(e.target.value)} className="d-input w-full px-3 py-2 text-sm" />
              </label>
            </div>
            <div className="flex items-center gap-3 mt-3">
              <Button onClick={saveAcuerdo} disabled={savingAcuerdo} className="d-btn-primary text-sm">
                {savingAcuerdo && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />} Guardar acuerdo
              </Button>
              {client.agreed_price != null && (
                <span className="text-d-green text-xs">Guardado: <span className="d-num">{client.agreed_price.toLocaleString('es-ES')}€</span>{client.delivery_eta ? ` · ${new Date(client.delivery_eta).toLocaleDateString('es-ES')}` : ''}</span>
              )}
            </div>
          </div>
        );
      case 'runner':
        return chosenLead ? (
          <div>
            <div className="flex items-center gap-3 mb-3">
              {chosenLead.car_analyses?.car_image_url && <img src={chosenLead.car_analyses.car_image_url} alt="" className="w-16 h-12 rounded-lg object-cover" />}
              <p className="text-d-text text-sm font-medium">{chosenLead.car_analyses?.title || 'Coche elegido'}</p>
            </div>
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
                <div className="flex items-center gap-2 mt-3">
                  <Button onClick={shareRunner} disabled={sharingRunner} className="d-btn-ghost text-xs">
                    {runnerCopied ? <><Check className="w-3.5 h-3.5 mr-1" /> Copiado</> : <><Clipboard className="w-3.5 h-3.5 mr-1" /> Copiar enlace</>}
                  </Button>
                  <Button onClick={generateChecklist} disabled={genChecklist} className="d-btn-ghost text-xs">
                    {genChecklist ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null} Regenerar checklist
                  </Button>
                </div>
              </>
            )}
            {client.runner_report && <RunnerReportReview report={client.runner_report} />}
          </div>
        ) : (
          <p className="text-d-dim text-sm">Marca un coche como finalista para preparar la ficha del runner.</p>
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
              <h4 className="text-sm font-semibold text-d-text">Gastos del runner</h4>
              <p className="text-d-dim text-xs mb-3">El coste real de la operación — se convierte en tu margen real.</p>
              <label className="block space-y-1 mb-3">
                <span className="block text-[11px] text-d-dim">Precio de compra real (€)</span>
                <input type="number" value={actualPurchase} onChange={e => setActualPurchase(e.target.value)} placeholder="p. ej. 17.500" className="d-input d-num w-full px-3 py-2 text-sm" />
              </label>
              <div className="space-y-2">
                {expenses.map((e, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={e.concept} onChange={ev => updateExpense(i, 'concept', ev.target.value)} placeholder="Vuelo, gasolina, hotel…" className="d-input flex-1 px-2.5 py-1.5 text-sm" />
                    <input type="number" value={e.amount} onChange={ev => updateExpense(i, 'amount', ev.target.value)} placeholder="€" className="d-input d-num w-24 px-2.5 py-1.5 text-sm" />
                    <button onClick={() => removeExpense(i)} className="text-d-dim hover:text-d-red p-1"><X className="w-4 h-4" /></button>
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
              <Button onClick={() => updateStage('entregado')} disabled={updatingStage} className="d-btn-primary text-sm"><ShoppingBag className="w-4 h-4 mr-1.5" /> Marcar entregado</Button>
            )}
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <Link href="/dealer/operaciones" className="inline-flex items-center gap-2 text-d-muted hover:text-d-text text-sm transition-colors">
        <ArrowLeft className="w-4 h-4" /> Operaciones
      </Link>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-d-accent animate-spin" />
        </div>
      ) : !client ? (
        <p className="text-d-dim text-center py-12">Cliente no encontrado</p>
      ) : (
        <>
          {/* Compact header zone */}
          <div className="space-y-3">
            <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
              <h1 className="text-[22px] font-bold text-d-text tracking-tight">
                {client.client_name}
                {carTitle && <span className="text-d-dim font-semibold"> · {carTitle}</span>}
              </h1>
              <span className="d-tag d-tag-muted">{stageLabel}</span>
            </div>

            {/* Slim stepper */}
            <div className="flex items-center gap-0.5 overflow-x-auto pb-1">
              {STAGES.map((s, i) => {
                const StageIcon = s.icon;
                const curIdx = STAGES.findIndex(x => x.key === client.stage);
                const isActive = client.stage === s.key;
                const isPast = curIdx > i;
                return (
                  <div key={s.key} className="flex items-center shrink-0">
                    <button
                      onClick={() => updateStage(s.key)}
                      disabled={updatingStage}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] border transition-all ${
                        isActive
                          ? 'bg-d-accent/10 text-d-accent border-d-accent/30'
                          : isPast
                          ? 'bg-d-surface-2 text-d-muted border-d-border'
                          : 'text-d-dim border-d-border hover:border-d-border-strong hover:text-d-muted'
                      }`}
                    >
                      <StageIcon className="w-3 h-3" />
                      {s.label}
                    </button>
                    {i < STAGES.length - 1 && <ChevronRight className={`w-3 h-3 mx-0.5 ${isPast ? 'text-d-muted' : 'text-d-border'}`} />}
                  </div>
                );
              })}
            </div>

            {/* Slim próximo-paso bar */}
            {(() => {
              const curIdx = STAGES.findIndex(s => s.key === client.stage);
              const nextStage = curIdx >= 0 && curIdx < STAGES.length - 1 ? STAGES[curIdx + 1] : null;
              const isClosed = client.stage === 'entregado' || client.stage === 'perdido';
              return (
                <div className={`flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border ${isClosed ? 'border-d-border' : 'border-d-accent/25 bg-d-accent/[0.04]'}`}>
                  <div className="min-w-0 flex items-center gap-2 text-sm">
                    <span className="d-cap shrink-0">Ahora</span>
                    <span className="text-d-text truncate">{NEXT_ACTION[client.stage] || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {nextStage && (
                      <Button onClick={() => updateStage(nextStage.key)} disabled={updatingStage} className="d-btn-primary text-sm">
                        {updatingStage && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
                        Avanzar <ChevronRight className="w-4 h-4 ml-0.5" />
                      </Button>
                    )}
                    {!isClosed && (
                      <button onClick={() => updateStage('perdido')} disabled={updatingStage} className="text-d-dim hover:text-d-red p-1.5" title="Marcar como perdido">
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                    {client.stage === 'perdido' && <Button onClick={() => updateStage('solicitud')} className="d-btn-ghost text-sm">Reabrir</Button>}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Two-column: basics (left) + stage-driven workspace (right) */}
          <div className="grid lg:grid-cols-[300px_1fr] gap-6 items-start">
            {/* Basics */}
            <aside className="lg:sticky lg:top-6 self-start space-y-4">
              {/* Money first */}
              <div className="d-card d-card-hl p-5">
                {actualMargin != null ? (
                  <>
                    <p className="d-cap mb-1.5">Margen real</p>
                    <div className="flex items-baseline gap-2">
                      <span className={`text-[30px] font-bold tracking-tight leading-none d-num ${actualMargin >= 0 ? 'text-d-green' : 'text-d-red'}`}>{actualMargin >= 0 ? '+' : ''}€{eur(actualMargin)}</span>
                    </div>
                    {dealMargin && <p className="text-d-dim text-[11px] mt-1.5">Estimado era +€{eur(dealMargin.amount)}</p>}
                    {client.agreed_price != null && (
                      <div className="mt-3.5 pt-3.5 border-t border-d-border flex items-baseline justify-between">
                        <span className="text-d-dim text-xs">Vendido por</span>
                        <span className="text-d-text font-semibold d-num text-sm">{client.agreed_price.toLocaleString('es-ES')}€</span>
                      </div>
                    )}
                  </>
                ) : dealMargin ? (
                  <>
                    <p className="d-cap mb-1.5">{dealMargin.label}</p>
                    <div className="flex items-baseline gap-2">
                      <span className={`text-[30px] font-bold tracking-tight leading-none d-num ${dealMargin.low ? 'text-d-amber' : 'text-d-green'}`}>+€{eur(dealMargin.amount)}</span>
                      {dealMargin.pct != null && <span className="text-d-dim text-sm d-num">{dealMargin.pct}%</span>}
                    </div>
                    {dealMargin.low && <p className="text-d-amber text-[11px] mt-1.5 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Orientativo — pocos comparables</p>}
                    {client.agreed_price != null && (
                      <div className="mt-3.5 pt-3.5 border-t border-d-border flex items-baseline justify-between">
                        <span className="text-d-dim text-xs">Precio acordado</span>
                        <span className="text-d-text font-semibold d-num text-sm">{client.agreed_price.toLocaleString('es-ES')}€</span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className="d-cap mb-1.5">Margen del negocio</p>
                    <p className="text-d-muted text-sm">Analiza coches para ver el margen potencial de esta operación.</p>
                    {client.max_price && <p className="text-d-dim text-xs mt-2.5">Presupuesto del cliente: <span className="d-num text-d-text-2">{client.max_price.toLocaleString('es-ES')}€</span></p>}
                  </>
                )}
                <p className="text-d-dim text-[11px] mt-3">Abierta hace <span className="d-num">{daysSince(client.created_at)}</span> días</p>
              </div>

              {/* Fit */}
              {fit.length > 0 && (
                <div className="d-card p-4">
                  <h3 className="d-cap mb-2.5">Encaje del finalista</h3>
                  <div className="flex flex-wrap gap-2">
                    {fit.map((f, i) => (
                      <span key={i} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${f.ok ? 'bg-d-green/10 text-d-green' : 'bg-d-red/10 text-d-red'}`}>
                        {f.ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />} {f.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Contact */}
              {(client.client_phone || client.client_email) && (
                <div className="d-card p-4">
                  <h3 className="d-cap mb-2.5">Contacto</h3>
                  {client.client_phone && (
                    <div className="flex gap-2">
                      <a href={`tel:${client.client_phone}`} className="d-btn-ghost flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm"><Phone className="w-3.5 h-3.5" /> Llamar</a>
                      <a href={`https://wa.me/${client.client_phone.replace(/[^0-9+]/g, '')}`} target="_blank" rel="noopener" className="d-btn-ghost flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm"><Send className="w-3.5 h-3.5" /> WhatsApp</a>
                    </div>
                  )}
                  {client.client_email && <a href={`mailto:${client.client_email}`} className="text-d-accent text-xs hover:underline break-all block mt-2">{client.client_email}</a>}
                </div>
              )}

              {/* What they're looking for */}
              <div className="d-card p-5 space-y-5">
                {multiVehicle ? (
                  <div>
                    <h3 className="d-cap mb-2.5">Lo que busca <span className="d-num text-d-dim">({reqVehicles.length} coches)</span></h3>
                    <div className="space-y-2">
                      {reqVehicles.map((v, i) => (
                        <div key={i} className="rounded-lg border border-d-border px-3 py-2">
                          <p className="text-d-text text-sm font-medium">{v.make ? (v.model ? `${v.make} ${v.model}` : v.make) : 'Cualquier marca'}</p>
                          <p className="text-d-dim text-xs mt-0.5">{vehicleLine(v)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : prefChips.length > 0 && (
                  <div>
                    <h3 className="d-cap mb-2.5">Lo que busca</h3>
                    <div className="space-y-2">
                      {prefChips.map((chip, i) => (
                        <div key={i} className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="text-d-dim">{chip.label}</span>
                          <span className="text-d-text d-num text-right">{chip.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {client.notes && (
                  <div>
                    <h3 className="d-cap mb-1.5">Notas</h3>
                    <p className="text-d-muted text-sm italic">&quot;{client.notes}&quot;</p>
                  </div>
                )}
                {searchLinks()}
              </div>
            </aside>

            {/* Stage-driven workspace: current on top, completed below (most recent first), upcoming hidden */}
            <div className="space-y-3 min-w-0">
              {(() => {
                const curIdx = WORK_SECTIONS.findIndex(s => s.stages.includes(client.stage));
                const effIdx = curIdx >= 0 ? curIdx : 0;
                const current = WORK_SECTIONS[effIdx];
                const done = WORK_SECTIONS.slice(0, effIdx).reverse();
                return (
                  <>
                    <StageSection icon={current.icon} label={current.label} status="current" summary={summaryOf(current.key)} open>
                      {renderBody(current.key)}
                    </StageSection>
                    {done.map(sec => (
                      <StageSection key={sec.key} icon={sec.icon} label={sec.label} status="done" summary={summaryOf(sec.key)} open={openDone.has(sec.key)} onToggle={() => toggleDone(sec.key)}>
                        {rollbackBanner(sec.back)}
                        {renderBody(sec.key)}
                      </StageSection>
                    ))}
                  </>
                );
              })()}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
