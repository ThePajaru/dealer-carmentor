'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Loader2, Car, ExternalLink, AlertTriangle, Ban, Camera, Check, X, Minus,
  CheckCircle2, Send, ChevronLeft, ChevronRight, Wrench, Sparkles, Plus, StickyNote,
  Receipt,
} from 'lucide-react';
import { GUIDED_STEPS, INSPECTION_TOOLS, type GuidedItem, type GuidedPhoto, type GuidedStep } from '@/lib/dealer/inspection-master';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface RunnerExpense { concept: string; amount: number; ticket_url: string | null }
interface Packet {
  dealer: string | null;
  car: { title: string; hero: string | null; images: string[]; specs: Record<string, any> };
  listing_url: string | null;
  country: string | null;
  checklist: any | null;
  report: any | null;
  expenses: RunnerExpense[];
}

const SPEC_LABELS: Record<string, string> = {
  año: 'Año', km: 'Km', combustible: 'Combustible', potencia: 'Potencia', cambio: 'Cambio', carroceria: 'Carrocería',
};

function dealbreakerText(d: any): string {
  if (typeof d === 'string') return d;
  return d?.title || d?.problema || d?.text || JSON.stringify(d);
}

// Downscale a phone photo to keep uploads small before base64 → server.
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

type ItemState = { status?: 'ok' | 'issue' | 'na'; note: string; photo_url: string | null };
type CustomFinding = { text: string; photo_url: string | null };

// Model-specific endemic-fault items from the AI checklist, merged as one step.
function buildModelStep(checklist: any): GuidedStep | null {
  if (!checklist) return null;
  const items: GuidedItem[] = [];
  const seen = new Set<string>();
  (Array.isArray(checklist.phases) ? checklist.phases : []).forEach((ph: any, pi: number) =>
    (ph.items || []).forEach((it: any, ii: number) => {
      if (!it?.title) return;
      if (!((Number(it.discount) || 0) > 0 || it.priority === 'high')) return;
      const id = `ai_${it.id || `${pi}_${ii}`}`;
      if (seen.has(id)) return;
      seen.add(id);
      items.push({ id, title: String(it.title), hint: it.howToCheck || undefined, badSignal: it.badSignal || undefined, discount: Number(it.discount) || 0 });
    }));
  const dbCount = Array.isArray(checklist.dealbreakers) ? checklist.dealbreakers.length : 0;
  if (items.length === 0 && dbCount === 0) return null;
  return {
    id: 'modelo',
    title: 'Puntos críticos de este modelo',
    short: 'Modelo',
    intro: 'Fallos conocidos de este motor y modelo concretos. Aunque alguno repita algo ya revisado, compruébalo otra vez con este foco.',
    items: items.slice(0, 20),
  };
}

// One SCREEN at a time: every guided photo is its own page ("Foto: Frontal" →
// Continuar → "Foto: VIN" → …); a section's checks are one page after its photos.
type WizStep =
  | { kind: 'photo'; step: GuidedStep; photo: GuidedPhoto; first: boolean; last: boolean }
  | { kind: 'checks'; step: GuidedStep; isModel: boolean; first: boolean; last: boolean }
  | { kind: 'custom' }
  | { kind: 'final' };

export default function RunnerPacketPage() {
  const { token } = useParams<{ token: string }>();
  const [packet, setPacket] = useState<Packet | null>(null);
  const [loading, setLoading] = useState(true);

  // Wizard position: -1 = landing, then one screen per step.
  const [stepIdx, setStepIdx] = useState(-1);
  // Set while reviewing a pending point jumped-to from the final summary.
  const [fromSummary, setFromSummary] = useState(false);

  // Capture state
  const [items, setItems] = useState<Record<string, ItemState>>({});
  const [obs, setObs] = useState<Record<string, string>>({});
  const [photoObs, setPhotoObs] = useState<Record<string, string>>({});
  const [dealbreakers, setDealbreakers] = useState<Record<string, 'ok' | 'present'>>({});
  const [proof, setProof] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<CustomFinding[]>([]);
  const [realKm, setRealKm] = useState('');
  const [finalPrice, setFinalPrice] = useState('');
  const [verdict, setVerdict] = useState<'comprar' | 'no_comprar' | null>(null);
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Trip expenses (independent of the inspection wizard — the runner adds
  // receipts as they spend, and can come back to the same link to add more).
  // Auto-saved: instantly to localStorage (nothing typed is ever lost, even a
  // half-filled row), and debounced to the server for every row that has a
  // concept — so leaving the link never loses progress and no manual save is
  // needed. 'idle' | 'saving' | 'saved' drives the little status line.
  const [expenses, setExpenses] = useState<{ concept: string; amount: string; ticket_url: string | null }[]>([]);
  const [expStatus, setExpStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [expensesOpen, setExpensesOpen] = useState(false);
  const restored = useRef(false);
  const expensesRestored = useRef(false);
  const expensesDirty = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);

  const draftKey = `runner_draft_${token}`;
  const expensesKey = `runner_expenses_${token}`;

  const wizSteps: WizStep[] = useMemo(() => {
    const modelStep = buildModelStep(packet?.checklist);
    const out: WizStep[] = [];
    const pushSection = (step: GuidedStep, isModel: boolean) => {
      const screens: WizStep[] = [];
      (step.photos || []).forEach(photo => screens.push({ kind: 'photo', step, photo, first: false, last: false }));
      if ((step.items || []).length > 0 || isModel) screens.push({ kind: 'checks', step, isModel, first: false, last: false });
      if (screens.length > 0) {
        (screens[0] as { first: boolean }).first = true;
        (screens[screens.length - 1] as { last: boolean }).last = true;
        out.push(...screens);
      }
    };
    GUIDED_STEPS.forEach(s => pushSection(s, false));
    if (modelStep) pushSection(modelStep, true);
    out.push({ kind: 'custom' }, { kind: 'final' });
    return out;
  }, [packet?.checklist]);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/dealer/runner/${token}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => {
        setPacket(d.packet);
        // Restore expenses: a local draft (most recent, may hold half-typed
        // rows) wins over the server copy so nothing typed before leaving is lost.
        let localExp: any = null;
        try { const raw = localStorage.getItem(expensesKey); localExp = raw ? JSON.parse(raw) : null; } catch { /* corrupt — ignore */ }
        const serverExp = Array.isArray(d.packet?.expenses) ? d.packet.expenses : [];
        if (Array.isArray(localExp) && localExp.length > 0) {
          setExpenses(localExp.map((e: any) => ({ concept: e.concept || '', amount: e.amount != null ? String(e.amount) : '', ticket_url: e.ticket_url || null })));
        } else if (serverExp.length > 0) {
          setExpenses(serverExp.map((e: any) => ({ concept: e.concept || '', amount: e.amount != null ? String(e.amount) : '', ticket_url: e.ticket_url || null })));
        }
        expensesRestored.current = true;
        const rep = d.packet?.report;
        if (rep) {
          setSubmitted(true);
          setVerdict(rep.verdict || null);
          setFinalPrice(rep.final_price != null ? String(rep.final_price) : '');
          setRealKm(rep.real_km != null ? String(rep.real_km) : '');
          setNotes(rep.notes || '');
          const im: Record<string, ItemState> = {};
          const cf: CustomFinding[] = [];
          (rep.items || []).forEach((it: any) => {
            if (String(it.id).startsWith('custom_')) cf.push({ text: it.note || it.title || '', photo_url: it.photo_url || null });
            else im[it.id] = { status: it.status, note: it.note || '', photo_url: it.photo_url || null };
          });
          setItems(im);
          setCustom(cf);
          const ob: Record<string, string> = {};
          const pob: Record<string, string> = {};
          (rep.observations || []).forEach((o: any) => {
            if (!o?.step) return;
            const [sec, photoKey] = String(o.step).split(':');
            if (photoKey) pob[photoKey] = o.text || '';
            else ob[sec] = o.text || '';
          });
          setObs(ob);
          setPhotoObs(pob);
          const db: Record<string, 'ok' | 'present'> = {};
          (rep.dealbreakers || []).forEach((d: any, i: number) => { db[String(i)] = d.status; });
          setDealbreakers(db);
          const labelToKey: Record<string, string> = {};
          GUIDED_STEPS.forEach(s => (s.photos || []).forEach(p => { labelToKey[p.label] = p.key; }));
          const pr: Record<string, string> = {};
          (rep.photos || []).forEach((p: any) => { const key = labelToKey[p.label]; if (key && !pr[key]) pr[key] = p.url; });
          setProof(pr);
        } else {
          // Resume an unfinished inspection from this phone.
          try {
            const raw = localStorage.getItem(draftKey);
            if (raw) {
              const dft = JSON.parse(raw);
              setItems(dft.items || {}); setObs(dft.obs || {}); setPhotoObs(dft.photoObs || {}); setDealbreakers(dft.dealbreakers || {});
              setProof(dft.proof || {}); setCustom(dft.custom || []);
              setRealKm(dft.realKm || ''); setFinalPrice(dft.finalPrice || '');
              setVerdict(dft.verdict || null); setNotes(dft.notes || '');
              if (typeof dft.stepIdx === 'number') setStepIdx(-1); // land, but offer "Continuar"
            }
          } catch { /* corrupt draft — start clean */ }
        }
        restored.current = true;
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Persist the draft so a dropped connection or closed tab loses nothing.
  useEffect(() => {
    if (!restored.current || submitted) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ items, obs, photoObs, dealbreakers, proof, custom, realKm, finalPrice, verdict, notes, stepIdx }));
    } catch { /* storage full — keep going without draft */ }
  }, [items, obs, photoObs, dealbreakers, proof, custom, realKm, finalPrice, verdict, notes, stepIdx, submitted, draftKey]);

  const draftStep: number | null = useMemo(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return null;
      const dft = JSON.parse(raw);
      return typeof dft.stepIdx === 'number' && dft.stepIdx >= 0 ? Math.min(dft.stepIdx, wizSteps.length - 1) : null;
    } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, wizSteps.length]);

  const uploadPhoto = async (key: string, file: File): Promise<string | null> => {
    setUploading(u => ({ ...u, [key]: true }));
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await fetch(`/api/dealer/runner/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upload', dataUrl }),
      });
      if (!res.ok) throw new Error();
      const { url } = await res.json();
      return url as string;
    } catch {
      setError('No se pudo subir la foto. Reinténtalo.');
      return null;
    } finally {
      setUploading(u => ({ ...u, [key]: false }));
    }
  };

  const setItem = (id: string, patch: Partial<ItemState>) =>
    setItems(prev => {
      const base: ItemState = prev[id] || { note: '', photo_url: null };
      return { ...prev, [id]: { ...base, ...patch } };
    });

  const goTo = (idx: number) => {
    setStepIdx(idx);
    setError(null);
    topRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
  };

  // Unanswered = the photo of a photo screen, or checks without status.
  const pendingInStep = (w: WizStep): number => {
    // Las fotos `optional` (enganche, extras) solo existen en coches que llevan
    // la pieza: nunca cuentan como pendientes, o un coche sin ella no cerraría.
    if (w.kind === 'photo') return proof[w.photo.key] || w.photo.optional ? 0 : 1;
    if (w.kind === 'checks') {
      const missingItems = (w.step.items || []).filter(it => !items[it.id]?.status).length;
      const missingDb = w.isModel
        ? (Array.isArray(packet?.checklist?.dealbreakers) ? packet!.checklist.dealbreakers : []).filter((_: any, i: number) => !dealbreakers[String(i)]).length
        : 0;
      return missingItems + missingDb;
    }
    return 0;
  };

  const next = () => {
    setFromSummary(false);
    goTo(Math.min(stepIdx + 1, wizSteps.length - 1));
  };

  const submit = async () => {
    if (!verdict) { setError('Marca tu recomendación: comprar o no comprar.'); return; }
    setSubmitting(true); setError(null);
    try {
      const modelStep = buildModelStep(packet?.checklist);
      const allSteps: GuidedStep[] = [...GUIDED_STEPS, ...(modelStep ? [modelStep] : [])];

      const itemPayload: any[] = [];
      allSteps.forEach(step => (step.items || []).forEach(it => {
        const st = items[it.id];
        if (st?.status && st.status !== 'na') itemPayload.push({ id: it.id, title: it.title, phase: step.title, status: st.status, note: st.note, photo_url: st.photo_url });
      }));
      custom.forEach((c, i) => {
        if (!c.text.trim() && !c.photo_url) return;
        itemPayload.push({ id: `custom_${i}`, title: c.text.trim().slice(0, 120) || 'Hallazgo adicional', phase: 'Hallazgos adicionales', status: 'issue', note: c.text.trim(), photo_url: c.photo_url });
      });

      const dbList: any[] = Array.isArray(packet?.checklist?.dealbreakers) ? packet!.checklist.dealbreakers : [];
      const dbPayload = dbList.map((d, i) => ({ text: dealbreakerText(d), status: dealbreakers[String(i)] || 'ok' }));

      const photos = [
        ...allSteps.flatMap(s => (s.photos || []).filter(p => proof[p.key]).map(p => ({ label: p.label, url: proof[p.key] }))),
        ...custom.filter(c => c.photo_url).map(c => ({ label: c.text.trim().slice(0, 60) || 'Hallazgo', url: c.photo_url! })),
      ];

      const observations = [
        ...allSteps
          .filter(s => (obs[s.id] || '').trim())
          .map(s => ({ step: s.id, title: s.title, text: obs[s.id].trim() })),
        ...allSteps.flatMap(s => (s.photos || [])
          .filter(p => (photoObs[p.key] || '').trim())
          .map(p => ({ step: `${s.id}:${p.key}`, title: `Foto ${p.label}`, text: photoObs[p.key].trim() }))),
      ];

      const res = await fetch(`/api/dealer/runner/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'submit',
          report: {
            verdict, final_price: finalPrice ? Number(finalPrice) : null, real_km: realKm ? Number(realKm) : null,
            notes, items: itemPayload, dealbreakers: dbPayload, photos, observations,
          },
        }),
      });
      if (!res.ok) throw new Error();
      setSubmitted(true);
      setStepIdx(-1);
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      topRef.current?.scrollIntoView({ behavior: 'smooth' });
    } catch {
      setError('No se pudo enviar la inspección. Reinténtalo.');
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Trip expenses (auto-saved) ----
  const markDirty = () => { expensesDirty.current = true; setExpStatus('idle'); };
  const addExpense = () => { setExpenses(prev => [...prev, { concept: '', amount: '', ticket_url: null }]); markDirty(); };
  const updateExpense = (i: number, patch: Partial<{ concept: string; amount: string; ticket_url: string | null }>) => {
    setExpenses(prev => prev.map((e, idx) => idx === i ? { ...e, ...patch } : e));
    markDirty();
  };
  const removeExpense = (i: number) => { setExpenses(prev => prev.filter((_, idx) => idx !== i)); markDirty(); };
  const expensesTotal = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  // A gasto counts (and gets pushed) only with BOTH concept and ticket photo.
  const isCompleteExpense = (e: { concept: string; ticket_url: string | null }) => !!e.concept.trim() && !!e.ticket_url;
  // Rows the runner started but that still miss concept or ticket — kept
  // locally so nothing typed is lost, but not sent to the dealer yet.
  const expensesIncomplete = expenses.some(e => (e.concept.trim() || e.amount || e.ticket_url) && !isCompleteExpense(e));

  // Instant local backup: every keystroke lands in localStorage, so closing or
  // leaving the link never loses what's been typed (even half-filled rows).
  useEffect(() => {
    if (!expensesRestored.current) return;
    try { localStorage.setItem(expensesKey, JSON.stringify(expenses)); } catch { /* storage full — keep going */ }
  }, [expenses, expensesKey]);

  // Debounced server auto-save: pushes every COMPLETE row (concept + ticket)
  // so the dealer sees them and progress survives even a new device. No button.
  useEffect(() => {
    if (!expensesRestored.current || !expensesDirty.current) return;
    const clean = expenses
      .filter(isCompleteExpense)
      .map(e => ({ concept: e.concept.trim(), amount: Number(e.amount) || 0, ticket_url: e.ticket_url }));
    const handle = setTimeout(async () => {
      setExpStatus('saving');
      try {
        const res = await fetch(`/api/dealer/runner/${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'expenses', expenses: clean }),
        });
        if (!res.ok) throw new Error();
        expensesDirty.current = false;
        setExpStatus('saved');
      } catch {
        setExpStatus('idle');
      }
    }, 1000);
    return () => clearTimeout(handle);
  }, [expenses, token, expensesKey]);

  if (loading) {
    return <div className="dealer-root min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 text-d-accent animate-spin" /></div>;
  }
  if (!packet) {
    return <div className="dealer-root min-h-screen flex items-center justify-center text-d-dim">Ficha no encontrada</div>;
  }

  const { car } = packet;
  const specs = Object.entries(car.specs).filter(([, v]) => v != null && String(v).trim());
  const totalSteps = wizSteps.length;
  const current = stepIdx >= 0 ? wizSteps[stepIdx] : null;
  const answered = Object.values(items).filter(s => s.status).length;
  const issues = Object.values(items).filter(s => s.status === 'issue').length;

  return (
    <div className="dealer-root dealer-root--scroll runner-black min-h-screen bg-black">
      <header className="border-b border-d-border sticky top-0 z-10 bg-black/95 backdrop-blur">
        <div className="max-w-2xl mx-auto px-4 py-3">
          {current ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <button onClick={() => goTo(stepIdx - 1 >= 0 ? stepIdx - 1 : -1)} className="text-d-dim hover:text-d-text p-1 -ml-1"><ChevronLeft className="w-5 h-5" /></button>
                <p className="text-d-text text-sm font-semibold truncate">
                  {current.kind === 'custom' ? 'Hallazgos adicionales' : current.kind === 'final' ? 'Cierre' : current.step.title}
                </p>
                <span className="text-d-dim text-xs d-num shrink-0">{stepIdx + 1}/{totalSteps}</span>
              </div>
              <div className="h-1 rounded-full bg-d-surface-2 mt-2 overflow-hidden">
                <div className="h-full bg-d-accent transition-all" style={{ width: `${((stepIdx + 1) / totalSteps) * 100}%` }} />
              </div>
            </>
          ) : (
            <>
              <p className="text-d-dim text-xs">{packet.dealer || 'Concesionario'}</p>
              <h1 className="text-lg font-bold text-d-text">Inspección guiada</h1>
            </>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5 pb-28" ref={topRef}>
        {/* ——— Pantalla final: revisión enviada (el FAB ＋ Gastos sigue disponible) ——— */}
        {stepIdx === -1 && submitted && (
          <div className="space-y-5">
            <div className="d-card d-card-hl p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-d-green/15 grid place-items-center mx-auto mb-4"><CheckCircle2 className="w-9 h-9 text-d-green" /></div>
              <h2 className="text-xl font-bold text-d-text">Revisión enviada</h2>
              <p className="text-d-muted text-sm mt-2">El concesionario ya tiene tu inspección de <span className="text-d-text font-medium">{car.title}</span>. El cliente ha recibido el aviso con las fotos.</p>
              <button onClick={() => goTo(0)} className="text-d-accent text-sm hover:underline mt-4">Revisar / editar la inspección</button>
            </div>

            <div className="d-card p-4 flex items-start gap-3">
              <Receipt className="w-4 h-4 text-d-accent shrink-0 mt-0.5" />
              <p className="text-d-muted text-xs">¿Aún te quedan gastos por anotar (gasolina de vuelta, peajes, hotel…)? Añádelos cuando quieras con el botón <span className="text-d-text font-medium">＋ Gastos</span> de abajo a la derecha — sigue disponible siempre, también después de enviar la revisión.</p>
            </div>
          </div>
        )}

        {/* ——— Landing (antes de enviar) ——— */}
        {stepIdx === -1 && !submitted && (
          <>
            <div className="d-card d-card-hl overflow-hidden">
              {car.hero ? (
                <img src={car.hero} alt="" className="w-full h-48 object-cover" />
              ) : (
                <div className="w-full h-48 bg-d-surface-2 grid place-items-center"><Car className="w-8 h-8 text-d-dim" /></div>
              )}
              <div className="p-4">
                <h2 className="text-base font-bold text-d-text">{car.title}</h2>
                <div className="flex flex-wrap gap-2 mt-2">
                  {specs.map(([k, v]) => (
                    <span key={k} className="d-pill px-2.5 py-1 text-xs">
                      <span className="text-d-dim mr-1">{SPEC_LABELS[k] || k}:</span>
                      <span className="d-num">{k === 'km' ? Number(v).toLocaleString('es-ES') : String(v)}</span>
                    </span>
                  ))}
                </div>
                {packet.listing_url && (
                  <a href={packet.listing_url} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 text-d-accent text-xs hover:underline mt-3">
                    <ExternalLink className="w-3.5 h-3.5" /> Ver anuncio original
                  </a>
                )}
              </div>
            </div>

            {/* Qué necesitas */}
            <div className="d-card d-card-hl p-4">
              <h3 className="text-d-text font-semibold text-sm mb-1 flex items-center gap-2"><Wrench className="w-4 h-4 text-d-accent" /> Qué necesitas</h3>
              <p className="text-d-muted text-xs mb-3">Revisa esto antes de empezar. Con este equipo la inspección es completa; sin él, irás a ciegas en varios pasos.</p>
              <div className="space-y-2.5">
                {INSPECTION_TOOLS.map((t, i) => (
                  <div key={i} className="flex items-start gap-2.5 border-t border-d-border pt-2.5 first:border-t-0 first:pt-0">
                    <Check className="w-3.5 h-3.5 text-d-green shrink-0 mt-0.5" />
                    <div>
                      <p className="text-d-text text-xs font-medium">{t.name}</p>
                      <p className="text-d-dim text-[11px] mt-0.5">{t.why}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {buildModelStep(packet.checklist) && (
              <div className="d-card p-4 flex items-start gap-3">
                <Sparkles className="w-4 h-4 text-d-accent shrink-0 mt-0.5" />
                <p className="text-d-muted text-xs">Esta inspección incluye un paso extra con los <span className="text-d-text font-medium">fallos conocidos de este modelo concreto</span>, generado para este coche.</p>
              </div>
            )}

            <div className="space-y-2">
              <button onClick={() => goTo(draftStep != null && !submitted ? draftStep : 0)} className="d-btn-primary w-full py-3.5 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-2">
                {draftStep != null && !submitted ? <>Continuar inspección (paso {draftStep + 1} de {totalSteps}) <ChevronRight className="w-4 h-4" /></> : <>Iniciar inspección <ChevronRight className="w-4 h-4" /></>}
              </button>
              {draftStep != null && !submitted && (
                <button onClick={() => goTo(0)} className="w-full py-2 text-d-dim text-xs hover:text-d-text">Empezar desde el principio</button>
              )}
            </div>

            <p className="text-d-muted text-xs flex items-start gap-2">
              <Receipt className="w-4 h-4 text-d-accent shrink-0 mt-0.5" />
              ¿Gastos del viaje (vuelo, gasolina, peajes…)? Añádelos cuando quieras con el botón <span className="text-d-text font-medium">＋ Gastos</span> de abajo a la derecha — está siempre a mano, también durante la inspección.
            </p>
          </>
        )}

        {/* ——— One guided photo per screen ——— */}
        {current?.kind === 'photo' && (
          <PhotoScreen
            step={current.step}
            photo={current.photo}
            showIntro={current.first}
            url={proof[current.photo.key]}
            busy={!!uploading[current.photo.key]}
            onPick={async f => { const url = await uploadPhoto(current.photo.key, f); if (url) setProof(prev => ({ ...prev, [current.photo.key]: url })); }}
            onClear={() => setProof(prev => { const n = { ...prev }; delete n[current.photo.key]; return n; })}
            note={photoObs[current.photo.key] || ''}
            setNote={t => setPhotoObs(p => ({ ...p, [current.photo.key]: t }))}
            realKm={realKm}
            setRealKm={setRealKm}
          />
        )}

        {/* ——— Section checks (one section per screen) ——— */}
        {current?.kind === 'checks' && (
          <ChecksScreen
            step={current.step}
            isModel={current.isModel}
            showIntro={current.first}
            items={items}
            setItem={setItem}
            obs={obs[current.step.id] || ''}
            setObsText={t => setObs(p => ({ ...p, [current.step.id]: t }))}
            uploading={uploading}
            uploadPhoto={uploadPhoto}
            dealbreakers={current.isModel ? (Array.isArray(packet.checklist?.dealbreakers) ? packet.checklist.dealbreakers : []) : []}
            dbState={dealbreakers}
            setDbState={setDealbreakers}
          />
        )}

        {/* ——— Custom findings ——— */}
        {current?.kind === 'custom' && (
          <div className="space-y-4">
            <p className="text-d-muted text-xs">¿Has visto algo que no estaba en la guía? Añádelo aquí con foto y descripción. Si no hay nada más, pasa al cierre.</p>
            {custom.map((c, i) => (
              <div key={i} className="d-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-d-text text-sm font-medium">Hallazgo {i + 1}</p>
                  <button onClick={() => setCustom(prev => prev.filter((_, idx) => idx !== i))} className="text-d-dim hover:text-d-red p-1 -m-1"><X className="w-4 h-4" /></button>
                </div>
                <textarea value={c.text} onChange={e => setCustom(prev => prev.map((f, idx) => idx === i ? { ...f, text: e.target.value } : f))}
                  rows={2} placeholder="¿Qué has visto? Dónde está, cómo de grave es…" className="d-input w-full px-3 py-2 text-sm resize-none" />
                {c.photo_url ? (
                  <div className="relative w-28 h-20 rounded-md overflow-hidden border border-d-border">
                    <img src={c.photo_url} alt="" className="w-full h-full object-cover" />
                    <button onClick={() => setCustom(prev => prev.map((f, idx) => idx === i ? { ...f, photo_url: null } : f))} className="absolute top-1 right-1 bg-black/60 rounded-full p-1 text-white"><X className="w-3 h-3" /></button>
                  </div>
                ) : (
                  <label className="inline-flex items-center gap-1.5 text-d-accent text-xs cursor-pointer hover:underline">
                    {uploading[`custom_${i}`] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />} Añadir foto
                    <input type="file" accept="image/*" capture="environment" className="hidden"
                      onChange={async e => { const f = e.target.files?.[0]; if (f) { const url = await uploadPhoto(`custom_${i}`, f); if (url) setCustom(prev => prev.map((fi, idx) => idx === i ? { ...fi, photo_url: url } : fi)); } e.target.value = ''; }} />
                  </label>
                )}
              </div>
            ))}
            <button onClick={() => setCustom(prev => [...prev, { text: '', photo_url: null }])}
              className="d-card-dashed w-full py-4 text-d-dim text-sm inline-flex items-center justify-center gap-2 hover:text-d-text">
              <Plus className="w-4 h-4" /> Añadir hallazgo
            </button>
          </div>
        )}

        {/* ——— Final ——— */}
        {current?.kind === 'final' && (
          <div className="space-y-4">
            <div className="d-card p-4">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="d-pill px-2 py-1 text-d-green d-num">{answered - issues} OK</span>
                <span className={`d-pill px-2 py-1 d-num ${issues > 0 ? 'text-amber-400' : 'text-d-dim'}`}>{issues} problemas</span>
                <span className="d-pill px-2 py-1 text-d-dim d-num">{Object.keys(proof).length} fotos guiadas</span>
                {custom.filter(c => c.text.trim() || c.photo_url).length > 0 && (
                  <span className="d-pill px-2 py-1 text-d-dim d-num">{custom.filter(c => c.text.trim() || c.photo_url).length} hallazgos extra</span>
                )}
              </div>
            </div>

            {/* Repaso: everything still pending, tap to jump there */}
            {(() => {
              const pending = wizSteps
                .map((w, idx) => ({ w, idx, n: pendingInStep(w) }))
                .filter(x => x.n > 0);
              if (pending.length === 0) {
                return (
                  <div className="d-card border-d-green/30 bg-d-green/5 p-4 flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-d-green shrink-0" />
                    <p className="text-d-green text-sm font-medium">Inspección completa: no te has dejado nada.</p>
                  </div>
                );
              }
              return (
                <div className="d-card border-amber-400/30 bg-amber-400/5 p-4">
                  <h3 className="text-amber-400 font-semibold text-sm flex items-center gap-2 mb-1"><AlertTriangle className="w-4 h-4" /> Te falta por completar</h3>
                  <p className="text-d-dim text-xs mb-3">Puedes enviar igualmente, pero cuanto más completo, mejor informe. Toca para ir directo.</p>
                  <div className="space-y-1.5">
                    {pending.map(({ w, idx, n }) => (
                      <button key={idx} onClick={() => { setFromSummary(true); goTo(idx); }}
                        className="w-full flex items-center justify-between gap-2 text-left px-3 py-2.5 rounded-lg bg-d-surface-2 hover:bg-d-surface-3">
                        <span className="text-d-text text-xs font-medium flex items-center gap-2">
                          {w.kind === 'photo'
                            ? <><Camera className="w-3.5 h-3.5 text-d-dim shrink-0" /> Foto: {w.photo.label}</>
                            : <>{w.kind === 'checks' ? w.step.title : ''} — {n} {n === 1 ? 'punto' : 'puntos'} sin marcar</>}
                        </span>
                        <ChevronRight className="w-4 h-4 text-d-dim shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="d-card d-card-hl p-4 space-y-3">
              <h3 className="text-d-text font-semibold text-sm">Tu recomendación</h3>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setVerdict('comprar')} className={`py-3 rounded-lg text-sm font-semibold border ${verdict === 'comprar' ? 'bg-d-green/15 border-d-green/40 text-d-green' : 'border-d-border text-d-dim hover:bg-d-surface-2'}`}>Comprar ✅</button>
                <button onClick={() => setVerdict('no_comprar')} className={`py-3 rounded-lg text-sm font-semibold border ${verdict === 'no_comprar' ? 'bg-d-red/15 border-d-red/40 text-d-red' : 'border-d-border text-d-dim hover:bg-d-surface-2'}`}>No comprar ⛔</button>
              </div>
              <label className="block space-y-1">
                <span className="block text-xs text-d-dim">Km reales (los del cuadro)</span>
                <input type="number" inputMode="numeric" value={realKm} onChange={e => setRealKm(e.target.value)} placeholder="p. ej. 148.500" className="d-input d-num w-full px-3 py-2 text-sm" />
              </label>
              <label className="block space-y-1">
                <span className="block text-xs text-d-dim">Precio final negociado (€)</span>
                <input type="number" inputMode="numeric" value={finalPrice} onChange={e => setFinalPrice(e.target.value)} placeholder="p. ej. 8.400" className="d-input d-num w-full px-3 py-2 text-sm" />
              </label>
              <label className="block space-y-1">
                <span className="block text-xs text-d-dim">Notas para el concesionario</span>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Cualquier detalle importante…" className="d-input w-full px-3 py-2 text-sm resize-none" />
              </label>
            </div>

            {error && <p className="text-d-red text-sm text-center">{error}</p>}

            <button onClick={submit} disabled={submitting} className="d-btn-primary w-full py-3 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60">
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando…</> : <><Send className="w-4 h-4" /> Enviar inspección</>}
            </button>
          </div>
        )}

        {stepIdx === -1 && <p className="text-center text-d-dim text-xs pt-2">Ficha generada por CarMentor</p>}
      </main>

      {/* Sticky footer nav during steps */}
      {current && current.kind !== 'final' && (
        <div className="fixed bottom-0 inset-x-0 border-t border-d-border bg-black/95 backdrop-blur z-10">
          <div className="max-w-2xl mx-auto px-4 py-3 space-y-2">
            {error && <p className="text-d-red text-xs text-center">{error}</p>}
            <button onClick={next} className="d-btn-primary w-full py-3 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-2">
              Siguiente <ChevronRight className="w-4 h-4" />
            </button>
            {fromSummary && (
              <button onClick={() => { setFromSummary(false); goTo(wizSteps.length - 1); }} className="w-full py-2 text-d-accent text-xs font-medium hover:underline">
                Volver al resumen
              </button>
            )}
          </div>
        </div>
      )}

      {/* Floating "+ Gastos": always reachable, even mid-inspection. Sits above
          the sticky step footer when it's showing. */}
      {!expensesOpen && (
        <button
          onClick={() => setExpensesOpen(true)}
          className={`fixed right-4 z-20 d-btn-primary rounded-full shadow-lg shadow-black/40 pl-4 pr-5 py-3 inline-flex items-center gap-2 text-sm font-semibold ${current && current.kind !== 'final' ? 'bottom-24' : 'bottom-6'}`}
          aria-label="Añadir gasto del viaje"
        >
          <Plus className="w-5 h-5" /> Gastos
          {expenses.length > 0 && (
            <span className="ml-0.5 min-w-5 h-5 px-1 rounded-full bg-black/25 grid place-items-center text-[11px] d-num">{expenses.length}</span>
          )}
        </button>
      )}

      {/* Trip-expenses bottom sheet */}
      {expensesOpen && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setExpensesOpen(false)} />
          <div className="relative bg-d-surface border-t border-d-border rounded-t-2xl max-w-2xl w-full mx-auto max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-d-border">
              <h3 className="text-d-text font-semibold text-sm flex items-center gap-2"><Receipt className="w-4 h-4 text-d-accent" /> Gastos del viaje</h3>
              <div className="flex items-center gap-2">
                {expStatus === 'saving' ? (
                  <span className="text-d-dim text-[11px] inline-flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Guardando…</span>
                ) : expStatus === 'saved' ? (
                  <span className="text-d-green text-[11px] inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Guardado</span>
                ) : null}
                <button onClick={() => setExpensesOpen(false)} className="text-d-dim hover:text-d-text p-1 -m-1" aria-label="Cerrar"><X className="w-5 h-5" /></button>
              </div>
            </div>

            <div className="overflow-y-auto px-4 py-4 space-y-3">
              <p className="text-d-muted text-xs">Vuelo, gasolina, peajes, hotel… Cada gasto con su ticket. Se guarda solo y suma al coste real del coche; el concesionario lo ve al instante.</p>
              {expenses.map((e, i) => (
                <div key={i} className="d-card p-3 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-d-dim text-[11px] font-medium uppercase tracking-wider mt-1">Gasto {i + 1}</span>
                    <button onClick={() => removeExpense(i)} className="text-d-dim hover:text-d-red p-1 -m-1 shrink-0" aria-label="Quitar gasto"><X className="w-4 h-4" /></button>
                  </div>
                  <label className="block space-y-1">
                    <span className="block text-xs text-d-dim">¿Qué es este gasto? <span className="text-d-red">*</span></span>
                    <input value={e.concept} onChange={ev => updateExpense(i, { concept: ev.target.value })} placeholder="p. ej. vuelo, gasolina, peaje, hotel, comida…" className={`d-input w-full px-3 py-2 text-sm ${!e.concept.trim() && (e.amount || e.ticket_url) ? 'border-d-red/50' : ''}`} />
                  </label>
                  <label className="block space-y-1">
                    <span className="block text-xs text-d-dim">Importe</span>
                    <div className="relative w-32">
                      <input type="number" inputMode="decimal" value={e.amount} onChange={ev => updateExpense(i, { amount: ev.target.value })} placeholder="0" className="d-input d-num w-full pl-3 pr-7 py-2 text-sm" />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-d-dim text-xs">€</span>
                    </div>
                  </label>
                  <div className="space-y-1">
                    <span className="block text-xs text-d-dim">Foto del ticket <span className="text-d-red">*</span></span>
                    {e.ticket_url ? (
                      <div className="relative w-24 h-20 rounded-md overflow-hidden border border-d-border">
                        <img src={e.ticket_url} alt="" className="w-full h-full object-cover" />
                        <button onClick={() => updateExpense(i, { ticket_url: null })} className="absolute top-1 right-1 bg-black/60 rounded-full p-1 text-white"><X className="w-3 h-3" /></button>
                      </div>
                    ) : (
                      <label className={`flex items-center justify-center gap-2 w-full py-4 rounded-lg border border-dashed cursor-pointer text-xs hover:bg-d-surface-2 ${(e.concept.trim() || e.amount) ? 'border-d-red/50 text-d-red' : 'border-d-border text-d-accent'}`}>
                        {uploading[`ticket_${i}`] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />} Hacer foto del ticket
                        <input type="file" accept="image/*" capture="environment" className="hidden"
                          onChange={async ev => { const f = ev.target.files?.[0]; if (f) { const url = await uploadPhoto(`ticket_${i}`, f); if (url) updateExpense(i, { ticket_url: url }); } ev.target.value = ''; }} />
                      </label>
                    )}
                  </div>
                </div>
              ))}
              <button onClick={addExpense} className="d-card-dashed w-full py-3 text-d-dim text-sm inline-flex items-center justify-center gap-2 hover:text-d-text">
                <Plus className="w-4 h-4" /> Añadir gasto
              </button>
              {expensesIncomplete && (
                <p className="text-amber-400/90 text-xs flex gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Cada gasto necesita <span className="font-medium">concepto y foto del ticket</span> para guardarse y que el concesionario lo vea.
                </p>
              )}
            </div>

            <div className="border-t border-d-border px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-d-dim text-[11px]">Total gastos</p>
                <p className="text-d-text font-semibold d-num">{expensesTotal.toLocaleString('es-ES')} €</p>
              </div>
              <button onClick={() => setExpensesOpen(false)} className="d-btn-primary rounded-lg px-5 py-2.5 text-sm font-semibold">Listo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ————— One guided photo per screen: big slot, clear instruction, Continuar —————
function PhotoScreen({ step, photo, showIntro, url, busy, onPick, onClear, note, setNote, realKm, setRealKm }: {
  step: GuidedStep;
  photo: GuidedPhoto;
  showIntro: boolean;
  url?: string;
  busy: boolean;
  onPick: (f: File) => void;
  onClear: () => void;
  note: string;
  setNote: (t: string) => void;
  realKm: string;
  setRealKm: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      {showIntro && step.intro && <p className="text-d-muted text-xs">{step.intro}</p>}
      <div className="d-card d-card-hl p-4">
        <p className="text-d-accent text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5 mb-1"><Camera className="w-3.5 h-3.5" /> Haz esta foto</p>
        <h2 className="text-d-text text-xl font-bold">{photo.label}</h2>
        {photo.optional && (
          <span className="inline-block mt-1.5 text-[11px] font-medium text-d-dim border border-d-border rounded-md px-2 py-0.5">
            Solo si el coche lo lleva — si no, pasa a la siguiente
          </span>
        )}
        {photo.hint && <p className="text-d-muted text-xs mt-1 mb-3">{photo.hint}</p>}
        {url ? (
          <div className="relative rounded-lg overflow-hidden border border-d-border mt-3">
            <img src={url} alt={photo.label} className="w-full max-h-80 object-cover" />
            <button onClick={onClear} className="absolute top-2 right-2 bg-black/60 rounded-full p-1.5 text-white"><X className="w-3.5 h-3.5" /></button>
            <span className="absolute bottom-2 left-2 bg-d-green/20 text-d-green text-[11px] font-medium px-2 py-0.5 rounded-md inline-flex items-center gap-1"><Check className="w-3 h-3" /> Hecha</span>
          </div>
        ) : (
          <label className="block w-full py-16 mt-3 rounded-lg border border-dashed border-d-border text-center cursor-pointer hover:bg-d-surface-2 text-d-dim">
            {busy ? <Loader2 className="w-8 h-8 animate-spin mx-auto" /> : (
              <span className="inline-flex flex-col items-center gap-2"><Camera className="w-8 h-8" /><span className="text-sm">Abrir cámara</span></span>
            )}
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />
          </label>
        )}
        {photo.key === 'int_cuadro' && (
          <label className="block space-y-1 mt-4">
            <span className="block text-xs text-d-dim">Km reales (los del cuadro)</span>
            <input type="number" inputMode="numeric" value={realKm} onChange={e => setRealKm(e.target.value)} placeholder="p. ej. 148.500" className="d-input d-num w-full px-3 py-2 text-sm" />
          </label>
        )}
      </div>
      <label className="block space-y-1">
        <span className="block text-xs text-d-dim">Observaciones (opcional)</span>
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="¿Algo que anotar sobre lo que ves aquí?" className="d-input w-full px-3 py-2 text-sm resize-none" />
      </label>
    </div>
  );
}

// ————— A section's checks on one screen + section observations —————
function ChecksScreen({ step, isModel, showIntro, items, setItem, obs, setObsText, uploading, uploadPhoto, dealbreakers, dbState, setDbState }: {
  step: GuidedStep;
  isModel: boolean;
  showIntro: boolean;
  items: Record<string, ItemState>;
  setItem: (id: string, patch: Partial<ItemState>) => void;
  obs: string;
  setObsText: (t: string) => void;
  uploading: Record<string, boolean>;
  uploadPhoto: (key: string, file: File) => Promise<string | null>;
  dealbreakers: any[];
  dbState: Record<string, 'ok' | 'present'>;
  setDbState: React.Dispatch<React.SetStateAction<Record<string, 'ok' | 'present'>>>;
}) {
  const [noteOpen, setNoteOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="space-y-4">
      {showIntro && step.intro && <p className="text-d-muted text-xs">{step.intro}</p>}
      {step.tool && (
        <p className="text-d-accent text-xs flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5" /> Herramienta: {step.tool}</p>
      )}

      {/* Dealbreakers (model step only) */}
      {isModel && dealbreakers.length > 0 && (
        <div className="d-card border-d-red/30 bg-d-red/5 p-4">
          <h3 className="text-d-red font-semibold text-sm flex items-center gap-2 mb-3"><Ban className="w-4 h-4" /> No compres si…</h3>
          <div className="space-y-2.5">
            {dealbreakers.map((d, i) => {
              const st = dbState[String(i)];
              return (
                <div key={i} className="border-t border-d-border pt-2.5 first:border-t-0 first:pt-0">
                  <p className="text-d-text-2 text-sm">{dealbreakerText(d)}</p>
                  {d?.howToCheck && <p className="text-d-dim text-xs mt-1">{d.howToCheck}</p>}
                  <div className="flex gap-1.5 mt-2">
                    <button onClick={() => setDbState(p => ({ ...p, [String(i)]: 'ok' }))} className={`px-3 py-1.5 rounded-md text-xs font-medium ${st === 'ok' ? 'bg-d-green/20 text-d-green' : 'bg-d-surface-2 text-d-dim'}`}>Ausente</button>
                    <button onClick={() => setDbState(p => ({ ...p, [String(i)]: 'present' }))} className={`px-3 py-1.5 rounded-md text-xs font-medium ${st === 'present' ? 'bg-d-red/20 text-d-red' : 'bg-d-surface-2 text-d-dim'}`}>Presente</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Checks */}
      {(step.items || []).length > 0 && (
        <div className="d-card d-card-hl p-4">
          <div className="space-y-4">
            {(step.items || []).map(it => {
              const st = items[it.id];
              const status = st?.status;
              const showNote = status === 'issue' || noteOpen[it.id] || !!st?.note;
              return (
                <div key={it.id} className="border-t border-d-border pt-3 first:border-t-0 first:pt-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-d-text text-sm font-medium">{it.title}</p>
                    {(it.discount || 0) > 0 && <span className="text-d-green text-xs font-semibold shrink-0 d-num">−€{Number(it.discount).toLocaleString('es-ES')}</span>}
                  </div>
                  {it.hint && <p className="text-d-muted text-xs mt-1">{it.hint}</p>}
                  {it.badSignal && (
                    <p className="text-amber-400/90 text-xs mt-1.5 flex gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {it.badSignal}
                    </p>
                  )}
                  <div className="flex items-center gap-1.5 mt-2.5">
                    <StatusBtn active={status === 'ok'} tone="green" onClick={() => setItem(it.id, { status: status === 'ok' ? undefined : 'ok' })}><Check className="w-3.5 h-3.5" /> OK</StatusBtn>
                    <StatusBtn active={status === 'issue'} tone="red" onClick={() => setItem(it.id, { status: status === 'issue' ? undefined : 'issue' })}><X className="w-3.5 h-3.5" /> Problema</StatusBtn>
                    <StatusBtn active={status === 'na'} tone="dim" onClick={() => setItem(it.id, { status: status === 'na' ? undefined : 'na' })}><Minus className="w-3.5 h-3.5" /> N/A</StatusBtn>
                    <button onClick={() => setNoteOpen(p => ({ ...p, [it.id]: !p[it.id] }))} className={`ml-auto p-2.5 rounded-md hover:bg-d-surface-2 ${st?.note ? 'text-d-accent' : 'text-d-dim'}`} aria-label="Añadir observación">
                      <StickyNote className="w-4 h-4" />
                    </button>
                    <label className={`cursor-pointer p-2.5 rounded-md ${st?.photo_url ? 'text-d-accent' : 'text-d-dim'} hover:bg-d-surface-2`}>
                      {uploading[it.id] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async e => { const f = e.target.files?.[0]; if (f) { const url = await uploadPhoto(it.id, f); if (url) setItem(it.id, { photo_url: url }); } e.target.value = ''; }} />
                    </label>
                  </div>
                  {showNote && (
                    <input value={st?.note || ''} onChange={e => setItem(it.id, { note: e.target.value })} placeholder="Observación (opcional)" className="d-input w-full px-3 py-2 text-xs mt-2" />
                  )}
                  {st?.photo_url && <img src={st.photo_url} alt="" className="mt-2 w-24 h-18 rounded-md object-cover border border-d-border" />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Section-level observations */}
      <label className="block space-y-1">
        <span className="block text-xs text-d-dim">Observaciones de esta sección (opcional)</span>
        <textarea value={obs} onChange={e => setObsText(e.target.value)} rows={2} placeholder="Cualquier cosa que quieras dejar anotada de este apartado…" className="d-input w-full px-3 py-2 text-sm resize-none" />
      </label>
    </div>
  );
}

function StatusBtn({ active, tone, onClick, children }: { active: boolean; tone: 'green' | 'red' | 'dim'; onClick: () => void; children: React.ReactNode }) {
  const toneCls = active
    ? tone === 'green' ? 'bg-d-green/20 text-d-green' : tone === 'red' ? 'bg-d-red/20 text-d-red' : 'bg-d-surface-3 text-d-text'
    : 'bg-d-surface-2 text-d-dim';
  return <button onClick={onClick} className={`inline-flex items-center gap-1 px-3 py-2.5 rounded-md text-xs font-medium ${toneCls}`}>{children}</button>;
}
