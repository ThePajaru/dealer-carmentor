'use client';

import { useEffect, useState, useMemo, Suspense, type ReactNode } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useDealer } from '@/hooks/useDealer';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, Save, Download, Plus, Trash2, ImageIcon } from 'lucide-react';
import Link from 'next/link';
import {
  renderPresupuestoHtml,
  buildInitialPresupuestoData,
  type PresupuestoData,
} from '@/lib/presupuesto-template';
import type { ImportVat } from '@/lib/analysis-view';

interface OtherCost { label: string; amount: number }

function fmt(n: number) { return Math.round(n || 0).toLocaleString('es-ES'); }
function todayEs() {
  return new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

function EditorContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { session } = useAuth();
  const { dealerProfile } = useDealer();

  const leadId = searchParams.get('lead');
  const analysisId = searchParams.get('analysis');
  const clientId = searchParams.get('client');
  const presupuestoParam = searchParams.get('presupuesto');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [presupuestoId, setPresupuestoId] = useState<string | null>(presupuestoParam);

  const [data, setData] = useState<PresupuestoData | null>(null);
  const [images, setImages] = useState<string[]>([]);

  // private dealer economics (never rendered in the PDF)
  const [purchase, setPurchase] = useState(0);
  const [transport, setTransport] = useState(0);
  const [gestoria, setGestoria] = useState(0);
  const [itv, setItv] = useState(0);
  const [plates, setPlates] = useState(0);
  const [insurance, setInsurance] = useState(0);
  const [otherCosts, setOtherCosts] = useState<OtherCost[]>([]);

  // Import VAT (MwSt): net-vs-gross purchase basis for intra-community imports.
  const [ivaImport, setIvaImport] = useState<ImportVat | null>(null);
  const [purchaseIsNet, setPurchaseIsNet] = useState(false);

  // ---------------------------------------------------------------- load
  useEffect(() => {
    if (!session?.access_token) return;

    const dealerForBuild = dealerProfile || {};
    const applyImages = (rj: any) => {
      const imgs: string[] = Array.isArray(rj?.car_images)
        ? rj.car_images.filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
        : [];
      setImages(imgs);
    };

    async function load() {
      try {
        // Edit an existing presupuesto
        if (presupuestoParam) {
          const res = await fetch(`/api/dealer/presupuesto/${presupuestoParam}`, {
            headers: { Authorization: `Bearer ${session!.access_token}` },
          });
          const { presupuesto: p } = await res.json();
          if (p) {
            const ca = p.car_analyses || {};
            applyImages(ca.result_json);
            const iva: ImportVat | null = ca.result_json?.analisis_rentabilidad?.iva_import ?? null;
            setIvaImport(iva);
            setPurchaseIsNet(!!p.purchase_price_is_net);
            setPurchase(p.purchase_price || 0);
            setTransport(p.transport_cost || 0);
            setGestoria(p.gestoria_cost || 0);
            setItv(p.itv_cost || 0);
            setPlates(p.plates_cost || 0);
            setInsurance(p.insurance_cost || 0);
            setOtherCosts(Array.isArray(p.other_costs) ? p.other_costs : []);
            if (p.presupuesto_data) {
              setData(p.presupuesto_data as PresupuestoData);
            } else {
              setData(buildInitialPresupuestoData({
                analysis: ca, dealer: dealerForBuild, sellingPrice: p.selling_price || 0,
                docDate: todayEs(), ref: '',
              }));
            }
          }
          return;
        }

        // New presupuesto from a lead's analysis
        if (leadId) {
          const res = await fetch(`/api/dealer/leads/${leadId}`, {
            headers: { Authorization: `Bearer ${session!.access_token}` },
          });
          const { lead } = await res.json();
          const ca = lead?.car_analyses;
          if (ca) {
            const rj = ca.result_json || {};
            applyImages(rj);
            const rent = rj.analisis_rentabilidad || {};
            const reco = rj.recomendacion_final || {};
            const dp: any = dealerProfile;
            // Import VAT: for deductible listings, seed the purchase from the NET
            // (real cash cost) when the dealer buys sin IVA; otherwise from gross.
            // Old analyses lack iva_import → fall back to the AI's max-buy target.
            const iva: ImportVat | null = rent.iva_import ?? null;
            setIvaImport(iva);
            const useNet = !!(iva?.vat_deductible && dp?.deduct_import_vat);
            setPurchaseIsNet(useNet);
            const fallbackPrice = reco.precio_maximo_compra ?? rj.precio_publicado ?? rj.precio ?? 0;
            const price = iva
              ? Math.round(useNet ? iva.precio_neto : iva.precio_bruto)
              : fallbackPrice;
            setPurchase(price);
            setTransport(dp?.default_transport ?? 0);
            setGestoria(dp?.default_gestoria ?? 0);
            setItv(dp?.default_itv ?? 0);
            setPlates(dp?.default_plates ?? 0);
            const estVenta = rent.precio_venta_estimado ?? reco.precio_objetivo_venta ?? rj.precio_venta_estimado ?? null;
            const selling = estVenta
              ? Math.round(estVenta)
              : Math.round((price + (dp?.default_transport || 500) + (dp?.default_gestoria || 180) + (dp?.default_itv || 160) + (dp?.default_plates || 60)) * (1 + (dp?.default_margin_pct || 15) / 100));
            setData(buildInitialPresupuestoData({
              analysis: ca, dealer: dealerForBuild, sellingPrice: selling,
              docDate: todayEs(), ref: '',
            }));
          }
        }
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token, leadId, presupuestoParam, dealerProfile]);

  // ---------------------------------------------------------------- economics
  const otherTotal = otherCosts.reduce((s, c) => s + (c.amount || 0), 0);
  const totalCost = purchase + transport + gestoria + itv + plates + insurance + otherTotal;
  const sellingPrice = data?.price ?? 0;
  const margin = sellingPrice - totalCost;
  const marginPct = totalCost > 0 ? (margin / totalCost) * 100 : 0;
  // Presupuestos saved before the toggle existed have no flag → price shown.
  const showPrice = data?.showPrice !== false;

  // ---------------------------------------------------------------- preview (debounced)
  const html = useMemo(() => (data ? renderPresupuestoHtml(data) : ''), [data]);
  const [previewHtml, setPreviewHtml] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setPreviewHtml(html), 180);
    return () => clearTimeout(t);
  }, [html]);

  // ---------------------------------------------------------------- helpers
  const set = <K extends keyof PresupuestoData>(k: K, v: PresupuestoData[K]) =>
    setData(d => (d ? { ...d, [k]: v } : d));

  // Per-car override: flip the purchase basis between net and gross and reseed
  // the Compra field from the listing's iva_import breakdown.
  const setNetBasis = (useNet: boolean) => {
    setPurchaseIsNet(useNet);
    if (ivaImport) {
      setPurchase(Math.round(useNet ? ivaImport.precio_neto : ivaImport.precio_bruto));
    }
  };

  const setHero = (src: string) =>
    setData(d => (d ? { ...d, heroImage: src, gallery: d.gallery.filter(g => g !== src) } : d));
  const toggleGallery = (src: string) =>
    setData(d => {
      if (!d || src === d.heroImage) return d;
      if (d.gallery.includes(src)) return { ...d, gallery: d.gallery.filter(g => g !== src) };
      if (d.gallery.length >= 5) return d;
      return { ...d, gallery: [...d.gallery, src] };
    });

  const save = async () => {
    if (!session?.access_token || !data) return null;
    setSaving(true);
    try {
      const payload: any = {
        lead_id: leadId,
        analysis_id: analysisId,
        purchase_price: purchase,
        transport_cost: transport,
        gestoria_cost: gestoria,
        itv_cost: itv,
        plates_cost: plates,
        insurance_cost: insurance,
        other_costs: otherCosts,
        selling_price: data.price,
        presupuesto_data: data,
        purchase_price_is_net: purchaseIsNet,
      };

      let id = presupuestoId;
      if (id) {
        await fetch(`/api/dealer/presupuesto/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify(payload),
        });
      } else {
        const res = await fetch('/api/dealer/presupuesto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        id = json.presupuesto?.id || null;
        setPresupuestoId(id);
      }
      return id;
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = async () => {
    if (!session?.access_token || !data) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/dealer/presupuesto-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ data, filename: `presupuesto-${(data.title || 'coche').slice(0, 40)}` }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `presupuesto-${(data.title || 'coche').slice(0, 40).replace(/[^a-z0-9]/gi, '_')}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setGenerating(false);
    }
  };

  // ---------------------------------------------------------------- render
  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 text-d-accent animate-spin" /></div>;
  }
  if (!data) {
    return <p className="text-d-dim text-center py-20">No se pudo cargar el presupuesto.</p>;
  }

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* header */}
      <div className="mb-5">
        <Link
          href={clientId ? `/dealer/clientes/${clientId}` : '/dealer/clientes'}
          className="inline-flex items-center gap-2 text-d-muted hover:text-d-text text-sm transition-colors mb-3"
        >
          <ArrowLeft className="w-4 h-4" /> {clientId ? 'Ficha del cliente' : 'Operaciones'}
        </Link>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <h1 className="text-[22px] font-semibold text-d-text tracking-tight leading-none">Editar presupuesto</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => save()} disabled={saving} className="d-btn-ghost h-9 text-sm">
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Save className="w-4 h-4 mr-1.5" />} Guardar
            </Button>
            <Button onClick={downloadPdf} disabled={generating} className="d-btn-primary h-9 text-sm">
              {generating ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Download className="w-4 h-4 mr-1.5" />} PDF
            </Button>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,440px)_1fr] gap-6 items-start">
        {/* -------- controls -------- */}
        <div className="space-y-4 lg:max-h-[calc(100vh-140px)] lg:overflow-y-auto lg:pr-2 pb-8">

          {/* Private economics — what they want to see first */}
          <Panel title="Rentabilidad (privado)" accent>
            <p className="text-d-dim text-[11px] mb-3">Solo tú ves esto — nunca aparece en el presupuesto del cliente.</p>
            {ivaImport && (
              ivaImport.vat_deductible ? (
                <div className="mb-3 rounded-lg border border-d-border bg-d-surface-2 px-3 py-2.5">
                  <p className="text-[11px] text-d-muted leading-snug">
                    Anuncio <span className="d-num font-semibold text-d-text">{fmt(ivaImport.precio_bruto)} €</span>
                    <span className="text-d-dim"> (bruto, {ivaImport.vat_rate}% MwSt)</span>
                    {' → '}Compra neta <span className="d-num font-semibold text-d-green">{fmt(ivaImport.precio_neto)} €</span>
                  </p>
                  <div className="mt-1.5">
                    <Toggle label="Comprar sin IVA (usar precio neto)" on={purchaseIsNet} set={setNetBasis} />
                  </div>
                </div>
              ) : (
                <div className="mb-3 rounded-lg border border-d-border bg-d-surface-2 px-3 py-2">
                  <p className="text-[11px] text-d-muted">IVA no deducible (§25a diferencia) — el precio del anuncio es el de compra.</p>
                </div>
              )
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Field label="Compra (€)"><input type="number" value={purchase} onChange={e => setPurchase(Number(e.target.value))} className="d-input d-num w-full px-2.5 py-1.5 text-sm" /></Field>
              <Field label="Transporte (€)"><input type="number" value={transport} onChange={e => setTransport(Number(e.target.value))} className="d-input d-num w-full px-2.5 py-1.5 text-sm" /></Field>
              <Field label="Gestoría (€)"><input type="number" value={gestoria} onChange={e => setGestoria(Number(e.target.value))} className="d-input d-num w-full px-2.5 py-1.5 text-sm" /></Field>
              <Field label="ITV (€)"><input type="number" value={itv} onChange={e => setItv(Number(e.target.value))} className="d-input d-num w-full px-2.5 py-1.5 text-sm" /></Field>
              <Field label="Matriculación (€)"><input type="number" value={plates} onChange={e => setPlates(Number(e.target.value))} className="d-input d-num w-full px-2.5 py-1.5 text-sm" /></Field>
              <Field label="Seguro (€)"><input type="number" value={insurance} onChange={e => setInsurance(Number(e.target.value))} className="d-input d-num w-full px-2.5 py-1.5 text-sm" /></Field>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-d-border text-center">
              <div><p className="text-d-dim text-[10px]">Coste</p><p className="d-num text-d-text font-bold">€{fmt(totalCost)}</p></div>
              <div><p className="text-d-dim text-[10px]">Margen</p><p className={`d-num font-bold ${margin >= 0 ? 'text-d-green' : 'text-d-red'}`}>€{fmt(margin)}</p></div>
              <div><p className="text-d-dim text-[10px]">Margen %</p><p className={`d-num font-bold ${marginPct >= 0 ? 'text-d-green' : 'text-d-red'}`}>{marginPct.toFixed(1)}%</p></div>
            </div>
          </Panel>

          {/* Main content */}
          <Panel title="Contenido">
            <Field label="Título">
              <input value={data.title} onChange={e => set('title', e.target.value)} className="d-input w-full px-3 py-2 text-sm" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Precio al cliente (€)">
                <input type="number" value={data.price} onChange={e => set('price', Number(e.target.value))} className="d-input d-num w-full px-3 py-2 text-sm font-bold" />
              </Field>
              <Field label="Color de marca">
                <input type="color" value={data.brandColor} onChange={e => set('brandColor', e.target.value)} className="h-9 w-full rounded-lg bg-d-surface-2 border border-d-border cursor-pointer" />
              </Field>
            </div>
            <div className="mt-1 mb-2 rounded-lg border border-d-border bg-d-surface-2 px-3 py-2">
              <Toggle label="Mostrar el precio al cliente" on={showPrice} set={v => set('showPrice', v)} />
              {!showPrice && (
                <div className="mt-2 space-y-1.5">
                  <Field label="Texto en lugar del precio (vacío = sin bloque de precio)">
                    <input value={data.priceHiddenLabel ?? ''} onChange={e => set('priceHiddenLabel', e.target.value)}
                      placeholder="A consultar" className="d-input w-full px-2.5 py-1.5 text-sm" />
                  </Field>
                  <p className="text-d-dim text-[11px] leading-snug">
                    El precio se sigue usando para tu margen (€{fmt(data.price)}), pero no aparece en el documento del cliente.
                  </p>
                </div>
              )}
            </div>
            {showPrice && (
              <Field label="Nota bajo el precio">
                <input value={data.priceNote} onChange={e => set('priceNote', e.target.value)} className="d-input w-full px-3 py-2 text-sm" />
              </Field>
            )}
          </Panel>

          {/* Photos */}
          <Panel title="Fotos">
            {images.length === 0 ? (
              <p className="text-d-dim text-xs flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> El análisis no guardó fotos.</p>
            ) : (
              <>
                <p className="d-cap mb-1.5">Foto principal</p>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 mb-3">
                  {images.map(src => (
                    <button key={src} onClick={() => setHero(src)}
                      className={`relative aspect-[4/3] rounded-md overflow-hidden border-2 transition-colors ${data.heroImage === src ? 'border-d-accent' : 'border-transparent hover:border-d-border-strong'}`}>
                      <img src={src} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
                <p className="d-cap mb-1.5">Galería <span className="text-d-dim normal-case">({data.gallery.length}/5)</span></p>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                  {images.filter(s => s !== data.heroImage).map(src => {
                    const idx = data.gallery.indexOf(src);
                    return (
                      <button key={src} onClick={() => toggleGallery(src)}
                        className={`relative aspect-[4/3] rounded-md overflow-hidden border-2 transition-colors ${idx >= 0 ? 'border-d-accent' : 'border-transparent hover:border-d-border-strong'}`}>
                        <img src={src} alt="" className="w-full h-full object-cover" />
                        {idx >= 0 && <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-d-accent text-white text-[9px] font-bold flex items-center justify-center">{idx + 1}</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </Panel>

          {/* Description */}
          <Panel title="Descripción">
            <textarea value={data.resumen} onChange={e => set('resumen', e.target.value)} rows={5}
              className="d-input w-full px-3 py-2 text-sm resize-y" placeholder="Descripción del coche para el cliente..." />
          </Panel>

          {/* Included */}
          <Panel title="Todo incluido en el precio">
            <div className="space-y-2">
              {data.included.map((it, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input value={it.label} onChange={e => { const u = [...data.included]; u[i] = { ...u[i], label: e.target.value }; set('included', u); }}
                    className="d-input flex-1 min-w-0 px-2.5 py-1.5 text-xs" placeholder="Concepto" />
                  <input value={it.sub || ''} onChange={e => { const u = [...data.included]; u[i] = { ...u[i], sub: e.target.value }; set('included', u); }}
                    className="d-input flex-1 min-w-0 px-2.5 py-1.5 text-xs text-d-muted" placeholder="detalle (opcional)" />
                  <button onClick={() => set('included', data.included.filter((_, j) => j !== i))} className="text-d-dim hover:text-d-red p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <button onClick={() => set('included', [...data.included, { label: '', sub: '' }])} className="d-btn-ghost text-xs inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg"><Plus className="w-3.5 h-3.5" /> Añadir</button>
            </div>
          </Panel>

          {/* Sections + equip + checks */}
          <Panel title="Secciones">
            <div className="space-y-1.5">
              <Toggle label="Por qué este coche" on={data.showWhy} set={v => set('showWhy', v)} />
              <Toggle label="Score CarMentor" on={data.showScore} set={v => set('showScore', v)} />
              <Toggle label="Ficha técnica" on={data.showFicha} set={v => set('showFicha', v)} />
              <Toggle label="Equipamiento" on={data.showEquip} set={v => set('showEquip', v)} />
              <Toggle label="Análisis mecánico" on={data.showChecks} set={v => set('showChecks', v)} />
            </div>
          </Panel>

          {data.showEquip && (
            <Panel title="Equipamiento (uno por línea)">
              <textarea value={data.equip.join('\n')} onChange={e => set('equip', e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
                rows={5} className="d-input w-full px-3 py-2 text-sm resize-y" placeholder="Faros LED&#10;Techo panorámico&#10;..." />
            </Panel>
          )}

          {data.showChecks && (
            <Panel title="Análisis mecánico">
              <div className="space-y-2.5">
                {data.checks.map((c, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <div className="flex-1 min-w-0 space-y-1">
                      <input value={c.title} onChange={e => { const u = [...data.checks]; u[i] = { ...u[i], title: e.target.value }; set('checks', u); }} className="d-input w-full px-2.5 py-1.5 text-xs font-medium" placeholder="Componente" />
                      <input value={c.note} onChange={e => { const u = [...data.checks]; u[i] = { ...u[i], note: e.target.value }; set('checks', u); }} className="d-input w-full px-2.5 py-1.5 text-xs text-d-muted" placeholder="Nota" />
                    </div>
                    <button onClick={() => set('checks', data.checks.filter((_, j) => j !== i))} className="text-d-dim hover:text-d-red p-1 mt-1"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
                <button onClick={() => set('checks', [...data.checks, { title: '', note: '' }])} className="d-btn-ghost text-xs inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg"><Plus className="w-3.5 h-3.5" /> Añadir punto</button>
              </div>
            </Panel>
          )}
        </div>

        {/* -------- live preview -------- */}
        <div className="lg:sticky lg:top-5">
          <div className="rounded-xl overflow-hidden border border-d-border bg-white lg:h-[calc(100vh-140px)]">
            <iframe title="Vista previa" srcDoc={previewHtml} className="w-full h-[900px] lg:h-full border-0" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- small local UI helpers (dealer theme) ---- */
function Panel({ title, children, accent }: { title: string; children: ReactNode; accent?: boolean }) {
  if (accent) {
    return (
      <div className="d-card p-4 border-d-accent/20 bg-d-accent/[0.03]">
        <h3 className="text-[13px] font-semibold text-d-text mb-3">{title}</h3>
        {children}
      </div>
    );
  }
  return (
    <section className="border-t border-d-border pt-4">
      <h3 className="text-[13px] font-semibold text-d-text mb-3">{title}</h3>
      {children}
    </section>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] text-d-dim">{label}</span>
      {children}
    </label>
  );
}
function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <button onClick={() => set(!on)} className="flex items-center justify-between w-full text-sm text-d-text-2 py-1">
      <span>{label}</span>
      <span className={`w-9 h-5 rounded-full transition-colors relative ${on ? 'bg-d-accent' : 'bg-d-surface-3'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

export default function EditorPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 className="h-6 w-6 animate-spin text-d-accent" /></div>}>
      <EditorContent />
    </Suspense>
  );
}
