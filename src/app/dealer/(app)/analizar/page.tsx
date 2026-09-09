'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { useDealer } from '@/hooks/useDealer';
import { consumeAnalyzeStream } from '@/lib/analyze-stream';
import { netEconomics, type ImportVat } from '@/lib/analysis-view';
import { AnalyzeStages, stageFromProgress } from '@/components/dealer/AnalyzeStages';
import {
  Loader2, Sparkles, Search, ExternalLink, AlertTriangle, X, ArrowRight, Trash2,
  Bookmark, BookmarkCheck, Clock, Car,
} from 'lucide-react';

// Run `items` through `worker` with at most `limit` in flight — analyses hold a
// streaming connection for 12–36s each, so we don't want 15 open at once.
async function runPool<T>(items: T[], limit: number, worker: (item: T, i: number) => Promise<void>) {
  let idx = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      await worker(items[cur], cur);
    }
  });
  await Promise.all(lanes);
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

const eur = (n: number | null | undefined) => (n == null ? '—' : `€${Math.round(n).toLocaleString('es-ES')}`);

function verdictTag(v: string): string {
  return /rentab|recomend|buen|oportun/i.test(v) ? 'd-tag-good'
    : /da[ñn]|no rentable|evita|problema/i.test(v) ? 'd-tag-warn' : 'd-tag-info';
}

// Relative "when analyzed" — good deals fly on mobile.de, so freshness is loud.
function timeAgo(iso: string): { text: string; hot: boolean } {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return { text: 'ahora mismo', hot: true };
  if (m < 60) return { text: `hace ${m} min`, hot: true };
  const h = Math.floor(m / 60);
  if (h < 24) return { text: `hace ${h} h`, hot: h < 6 };
  const d = Math.floor(h / 24);
  if (d === 1) return { text: 'ayer', hot: false };
  if (d < 30) return { text: `hace ${d} días`, hot: false };
  const mo = Math.floor(d / 30);
  if (mo < 12) return { text: `hace ${mo} ${mo === 1 ? 'mes' : 'meses'}`, hot: false };
  const y = Math.floor(d / 365);
  return { text: `hace ${y} ${y === 1 ? 'año' : 'años'}`, hot: false };
}
function absDate(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface WorkResult {
  key: string;
  url: string;
  status: 'analyzing' | 'error';
  progress: string;
  error?: string;
}

interface AnalysisSummary {
  score_global: number | null;
  margen_porcentaje: number | null;
  margen_bruto: number | null;
  veredicto: string | null;
  low_confidence: boolean;
  is_national: boolean;
  precio_compra_total: number | null;
  precio_medio: number | null;
  kilometraje: number | null;
  año: number | null;
  iva_import: ImportVat | null;
}
interface AnalysisRowData {
  id: string;
  title: string | null;
  car_image_url: string | null;
  source_url: string | null;
  created_at: string;
  saved: boolean;
  stock_id: string | null;
  stock_status: string | null;
  summary: AnalysisSummary | null;
}

export default function AnalizarPage() {
  const { session } = useAuth();
  const { dealerProfile } = useDealer();
  const router = useRouter();
  const deductImportVat = dealerProfile?.deduct_import_vat ?? undefined;
  const token = session?.access_token;

  // Seed from the React Query cache so pressing «back» from an analysis paints
  // the list instantly; the effect below still revalidates in the background.
  const queryClient = useQueryClient();
  const cachedList = queryClient.getQueryData<AnalysisRowData[]>(['dealer', 'analyses']);

  const [urls, setUrls] = useState('');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<WorkResult[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisRowData[]>(cachedList ?? []);
  const [loadingList, setLoadingList] = useState(!cachedList);
  const [query, setQuery] = useState('');
  const [promoteFor, setPromoteFor] = useState<{ analysisId: string; sourceUrl: string | null; stockId: string | null } | null>(null);

  const authHeaders = useCallback(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  const loadAnalyses = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch('/api/dealer/analyses', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setAnalyses(d.analyses || []);
      // Write-through, so the next visit starts warm too.
      queryClient.setQueryData(['dealer', 'analyses'], d.analyses || []);
    } finally {
      setLoadingList(false);
    }
  }, [token, queryClient]);

  useEffect(() => { loadAnalyses(); }, [loadAnalyses]);

  const patchResult = (key: string, patch: Partial<WorkResult>) =>
    setResults(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)));

  const analyzeOne = useCallback(async (key: string, url: string) => {
    patchResult(key, { status: 'analyzing', progress: 'Iniciando análisis…' });
    try {
      const res = await fetch('/api/dealer/analyze', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ url, stock: true }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        patchResult(key, { status: 'error', error: e.error || `Error ${res.status}` });
        return;
      }
      const analysisId = await consumeAnalyzeStream(res, {
        onProgress: m => patchResult(key, { progress: m }),
      });
      if (!analysisId) {
        patchResult(key, { status: 'error', error: 'El análisis no devolvió resultado' });
        return;
      }
      // Completed → it now lives permanently in the list; drop the live card.
      await loadAnalyses();
      setResults(prev => prev.filter(x => x.key !== key));
    } catch (err) {
      patchResult(key, { status: 'error', error: err instanceof Error ? err.message : 'Error inesperado' });
    }
  }, [authHeaders, loadAnalyses]);

  const analyze = async () => {
    if (!token) return;
    const list = Array.from(new Set(urls.split('\n').map(u => u.trim()).filter(Boolean)));
    if (list.length === 0) return;
    setRunning(true);
    const fresh: WorkResult[] = list.map((url, i) => ({
      key: `${Date.now()}-${i}`, url, status: 'analyzing', progress: 'En cola…',
    }));
    setResults(prev => [...fresh, ...prev]);
    setUrls('');
    // Pull the live pipeline into view: pressing Analizar with the page scrolled
    // down felt like nothing had happened until the car popped into the history.
    requestAnimationFrame(() => liveRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await runPool(fresh, 3, (r) => analyzeOne(r.key, r.url));
    setRunning(false);
  };

  const dismissError = (key: string) => setResults(prev => prev.filter(x => x.key !== key));

  const toggleSaved = async (a: AnalysisRowData) => {
    if (a.saved && a.stock_id) {
      await fetch(`/api/dealer/stock/${a.stock_id}`, {
        method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status: 'descartado' }),
      });
      setAnalyses(prev => prev.map(x => (x.id === a.id ? { ...x, saved: false } : x)));
    } else {
      const res = await fetch('/api/dealer/stock', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ analysis_id: a.id, source_url: a.source_url || a.id }),
      });
      const d = res.ok ? await res.json() : null;
      setAnalyses(prev => prev.map(x => (x.id === a.id ? { ...x, saved: true, stock_id: d?.id ?? x.stock_id } : x)));
    }
  };

  const deleteAnalysis = async (a: AnalysisRowData) => {
    setAnalyses(prev => prev.filter(x => x.id !== a.id));
    await fetch(`/api/dealer/analyses/${a.id}`, { method: 'DELETE', headers: authHeaders() });
  };

  const submitPromote = async (name: string, phone: string) => {
    if (!promoteFor) return;
    let stockId = promoteFor.stockId;
    if (!stockId) {
      const res = await fetch('/api/dealer/stock', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ analysis_id: promoteFor.analysisId, source_url: promoteFor.sourceUrl || promoteFor.analysisId }),
      });
      if (res.ok) stockId = (await res.json()).id;
    }
    if (!stockId) { setPromoteFor(null); return; }
    const res = await fetch(`/api/dealer/stock/${stockId}/promote`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ client_name: name, client_phone: phone }),
    });
    setPromoteFor(null);
    if (res.ok) {
      const d = await res.json();
      router.push(`/dealer/clientes/${d.request_id}`);
    }
  };

  const liveRef = useRef<HTMLDivElement | null>(null);
  const urlCount = urls.split('\n').filter(u => u.trim()).length;
  const live = results; // only ever analyzing / error
  const q = query.trim().toLowerCase();
  const filtered = q
    ? analyses.filter(a => (a.title || '').toLowerCase().includes(q) || (a.source_url || '').toLowerCase().includes(q))
    : analyses;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-[24px] font-semibold text-d-text tracking-tight">Analizar</h1>
        <p className="text-d-muted text-sm mt-1">Estudia coches para comprar — sin cliente. Todo lo que analices queda guardado aquí.</p>
      </div>

      {/* Paste + analyze */}
      <div className="d-card p-5">
        <textarea
          value={urls}
          onChange={e => setUrls(e.target.value)}
          placeholder={"Pega uno o varios links (uno por línea):\nhttps://suchen.mobile.de/...\nhttps://suchen.mobile.de/..."}
          className="d-input w-full h-28 px-3 py-2.5 text-sm resize-none font-mono"
        />
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-d-dim"><span className="d-num">{urlCount}</span> {urlCount === 1 ? 'coche' : 'coches'}</span>
          <button onClick={analyze} disabled={running || urlCount === 0} className="d-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg disabled:opacity-50">
            {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Analizando…</> : <><Sparkles className="w-4 h-4" /> Analizar</>}
          </button>
        </div>
      </div>

      {/* Live pipeline — only in-flight / failed analyses */}
      {live.length > 0 && (
        <div ref={liveRef} className="space-y-3 scroll-mt-24">
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-medium text-d-text">Analizando ahora</span>
            <span className="text-[13px] text-d-dim d-num">{live.length}</span>
          </div>
          <div className="rounded-xl border border-d-border bg-d-surface overflow-hidden divide-y divide-d-border">
            {live.map(r => (
              r.status === 'error'
                ? <ErrorRow key={r.key} r={r} onDismiss={() => dismissError(r.key)} />
                : <div key={r.key} className="d-analyzing py-4 px-5"><AnalyzingRow progress={r.progress} url={r.url} /></div>
            ))}
          </div>
        </div>
      )}

      {/* Persistent, searchable history */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-medium text-d-text">Mis análisis</span>
            <span className="text-[13px] text-d-dim d-num">{analyses.length}</span>
          </div>
          {analyses.length > 0 && (
            <div className="relative ml-auto w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-d-dim" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Buscar por modelo o enlace…"
                className="d-input w-full pl-9 pr-3 py-2 text-sm"
              />
            </div>
          )}
        </div>

        {loadingList ? (
          <div className="d-card-dashed py-10 text-center"><Loader2 className="w-5 h-5 animate-spin text-d-dim mx-auto" /></div>
        ) : analyses.length === 0 ? (
          <div className="d-card-dashed py-12 text-center">
            <Sparkles className="w-8 h-8 text-d-dim mx-auto mb-3" />
            <p className="text-d-text-2 text-sm font-medium">Aún no has analizado ningún coche</p>
            <p className="text-d-dim text-xs mt-1">Pega un enlace arriba y cada análisis quedará aquí, listo para revisar.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="d-card-dashed py-10 text-center">
            <p className="text-d-dim text-sm">Nada coincide con «{query}».</p>
          </div>
        ) : (
          <div className="rounded-xl border border-d-border bg-d-surface overflow-hidden divide-y divide-d-border">
            {filtered.map(a => (
              <AnalysisRow
                key={a.id}
                a={a}
                deductImportVat={deductImportVat}
                onToggleSave={toggleSaved}
                onPromote={() => setPromoteFor({ analysisId: a.id, sourceUrl: a.source_url, stockId: a.stock_id })}
                onDelete={deleteAnalysis}
              />
            ))}
          </div>
        )}
      </div>

      {promoteFor && <PromoteModal onClose={() => setPromoteFor(null)} onSubmit={submitPromote} />}
    </div>
  );
}

function AnalyzingRow({ progress, url }: { progress: string; url: string }) {
  const queued = stageFromProgress(progress) < 0;
  return (
    <div className="flex gap-4">
      <div className="w-20 h-14 sm:w-24 sm:h-16 rounded-lg d-shimmer shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-d-accent animate-pulse-slow shrink-0" />
          <span className="text-sm text-d-text font-medium">{queued ? 'En cola…' : 'Analizando'}</span>
          <span className="text-xs text-d-dim truncate">{hostOf(url)}</span>
        </div>
        <div className="mt-3"><AnalyzeStages progress={progress} /></div>
      </div>
    </div>
  );
}

function ErrorRow({ r, onDismiss }: { r: WorkResult; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-3 py-4 px-5">
      <AlertTriangle className="w-4 h-4 text-d-red shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-d-red text-sm font-medium">No se pudo analizar</p>
        <p className="text-d-dim text-xs mt-0.5 truncate">{r.error} · {hostOf(r.url)}</p>
      </div>
      <button onClick={onDismiss} className="text-d-dim hover:text-d-text p-1.5 rounded-lg" title="Quitar"><X className="w-4 h-4" /></button>
    </div>
  );
}

function AnalysisRow({ a, deductImportVat, onToggleSave, onPromote, onDelete }: {
  a: AnalysisRowData;
  deductImportVat?: boolean;
  onToggleSave: (a: AnalysisRowData) => void;
  onPromote: (a: AnalysisRowData) => void;
  onDelete: (a: AnalysisRowData) => void;
}) {
  const s = a.summary;
  const t = timeAgo(a.created_at);
  const href = `/dealer/analisis/${a.id}?from=/dealer/analizar`;
  const net = netEconomics(s?.iva_import, s?.precio_compra_total, s?.margen_bruto, deductImportVat);
  return (
    <div className="relative flex items-center gap-3.5 py-3.5 px-4 sm:px-5 hover:bg-d-surface-2 transition-colors group">
      {/* Stretched link makes the whole row navigate; action buttons sit above it. */}
      <Link href={href} className="absolute inset-0 z-0" aria-label={`Ver análisis${a.title ? ` de ${a.title}` : ''}`} />

      {a.car_image_url ? (
        <img src={a.car_image_url} alt="" className="w-16 h-12 sm:w-20 sm:h-14 rounded-lg object-cover shrink-0 ring-1 ring-white/[.06] pointer-events-none" />
      ) : (
        <div className="w-16 h-12 sm:w-20 sm:h-14 rounded-lg bg-d-surface-2 grid place-items-center shrink-0 ring-1 ring-white/[.06] pointer-events-none"><Car className="w-4 h-4 text-d-dim" /></div>
      )}

      <div className="min-w-0 flex-1 pointer-events-none">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-d-text font-semibold text-[15px] sm:text-base leading-snug truncate">{a.title || 'Coche'}</p>
          {s?.veredicto && <span className={`d-tag shrink-0 ${verdictTag(s.veredicto)}`}>{s.veredicto.split(/[:.–-]/)[0].trim().slice(0, 20)}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs">
          <span className={`inline-flex items-center gap-1 font-medium d-num ${t.hot ? 'text-d-accent' : 'text-d-dim'}`} title={absDate(a.created_at)}>
            <Clock className="w-3 h-3" />{t.text}
          </span>
          {s?.año != null && <span className="text-d-muted d-num">{s.año}</span>}
          {s?.kilometraje != null && <span className="text-d-muted d-num">{(s.kilometraje / 1000).toFixed(0)}k km</span>}
          {s?.precio_medio != null && <span className="text-d-muted">Mercado <span className="d-num">{eur(s.precio_medio)}</span></span>}
          {!s?.is_national && s?.margen_porcentaje != null && (
            s.low_confidence
              ? <span className="text-amber-400 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> margen no fiable</span>
              : <span className="text-d-green font-semibold d-num">margen {net ? net.margenPctNeto : s.margen_porcentaje}%{net && <span className="text-d-green/70 font-normal ml-1">sin IVA</span>}</span>
          )}
          {s?.score_global != null && <span className="text-d-accent font-semibold d-num">{s.score_global}/10</span>}
        </div>
      </div>

      <div className="relative z-10 flex items-center gap-0.5 sm:gap-1 shrink-0">
        <button onClick={() => onToggleSave(a)} title={a.saved ? 'Quitar de guardados' : 'Guardar'} className={`p-2 rounded-lg transition-colors ${a.saved ? 'text-d-accent hover:bg-d-surface-3' : 'text-d-dim hover:text-d-accent hover:bg-d-surface-3'}`}>
          {a.saved ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
        </button>
        {a.source_url && (
          <a href={a.source_url} target="_blank" rel="noopener" title="Ver anuncio" className="p-2 rounded-lg text-d-dim hover:text-d-accent hover:bg-d-surface-3 transition-colors hidden sm:inline-flex">
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
        <button onClick={() => onPromote(a)} title="Crear operación con cliente" className="d-btn-primary inline-flex items-center gap-1 text-xs h-8 px-2.5 rounded-lg">
          <span className="hidden sm:inline">Operación</span> <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => onDelete(a)} title="Eliminar análisis" className="p-2 rounded-lg text-d-dim hover:text-d-red hover:bg-d-surface-3 transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function PromoteModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (name: string, phone: string) => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onSubmit(name.trim(), phone.trim());
    setSaving(false);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div className="d-card w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-d-text font-semibold">Nueva operación</h3>
          <button onClick={onClose} className="text-d-dim hover:text-d-text"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-d-dim text-xs mb-4">El coche analizado se adjunta a la operación en la etapa «Selección».</p>
        <div className="space-y-3">
          <div>
            <label className="text-d-muted text-xs">Cliente *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre del cliente" className="d-input w-full px-3 py-2 text-sm mt-1" autoFocus />
          </div>
          <div>
            <label className="text-d-muted text-xs">Teléfono</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Opcional" className="d-input w-full px-3 py-2 text-sm mt-1" />
          </div>
        </div>
        <button onClick={submit} disabled={!name.trim() || saving} className="d-btn-primary w-full mt-4 inline-flex items-center justify-center gap-1.5 py-2 text-sm rounded-lg disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Crear operación <ArrowRight className="w-4 h-4" /></>}
        </button>
      </div>
    </div>
  );
}
