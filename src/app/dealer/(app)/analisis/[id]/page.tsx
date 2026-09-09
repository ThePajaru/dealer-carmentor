'use client';

import { useEffect, useState, Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { useDealer } from '@/hooks/useDealer';
import { buildAnalysisView, netEconomics, type AnalysisView } from '@/lib/analysis-view';
import { DealerAnalysisReport } from '@/components/dealer/DealerAnalysisReport';
import { PhotoLightbox } from '@/components/dealer/PhotoLightbox';
import { Loader2, ArrowLeft, ExternalLink, AlertTriangle, Images } from 'lucide-react';

interface Analysis {
  id: string;
  title: string | null;
  source_url: string | null;
  result_json: unknown;
  car_image_url: string | null;
  created_at: string;
}

function fmt(n: number | null) { return n == null ? '—' : Math.round(n).toLocaleString('es-ES'); }

function AnalisisContent() {
  const { session } = useAuth();
  const { dealerProfile } = useDealer();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const token = session?.access_token;
  const deductImportVat = dealerProfile?.deduct_import_vat ?? undefined;

  // Where the "back" link returns to — the embed passes ?from=/dealer/clientes/xyz.
  const from = searchParams.get('from');
  const backHref = from && from.startsWith('/dealer/') ? from : '/dealer/analizar';
  const backLabel = from && from.includes('/clientes/') ? 'Ficha del cliente'
    : from && from.includes('/operaciones') ? 'Operaciones' : 'Analizar';

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [view, setView] = useState<AnalysisView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // Photos open over the report (see PhotoLightbox) instead of in a new tab.
  const [photoIdx, setPhotoIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/analyses/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok) { if (!cancelled) setNotFound(true); return null; }
        return r.json();
      })
      .then((a) => {
        if (cancelled || !a) return;
        setAnalysis(a);
        setView(a.result_json ? buildAnalysisView(a.result_json, a.title) : null);
      })
      .catch(() => { if (!cancelled) setNotFound(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, id]);

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-7 h-7 text-d-accent animate-spin" /></div>;
  }

  if (notFound || !analysis || !view) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <AlertTriangle className="w-10 h-10 text-d-dim mx-auto mb-3" />
        <p className="text-d-text-2 text-sm font-medium">No se pudo cargar el análisis</p>
        <Link href={backHref} className="d-link text-sm mt-3 inline-block">← Volver</Link>
      </div>
    );
  }

  // The hero shot lives on the analysis row; the gallery in result_json. Merge
  // them so the hero is just photo #1 of the same viewer.
  const photos = Array.from(new Set([
    ...(analysis.car_image_url ? [analysis.car_image_url] : []),
    ...view.car_images,
  ]));
  const heroSrc = analysis.car_image_url || photos[0] || null;

  return (
    <div className="max-w-4xl mx-auto">
      <Link href={backHref} className="inline-flex items-center gap-2 text-d-muted hover:text-d-text text-sm transition-colors mb-4">
        <ArrowLeft className="w-4 h-4" /> {backLabel}
      </Link>

      <div className="flex items-start gap-4 mb-6">
        {heroSrc && (
          <button
            type="button"
            onClick={() => setPhotoIdx(photos.indexOf(heroSrc) >= 0 ? photos.indexOf(heroSrc) : 0)}
            className="relative shrink-0 rounded-xl overflow-hidden ring-1 ring-white/[.06] group"
            aria-label="Ver fotos"
          >
            <img src={heroSrc} alt="" className="w-28 h-20 sm:w-36 sm:h-24 object-cover transition-transform group-hover:scale-[1.03]" />
            {photos.length > 1 && (
              <span className="absolute bottom-1 right-1 inline-flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white">
                <Images className="w-3 h-3" /> <span className="d-num">{photos.length}</span>
              </span>
            )}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] sm:text-[24px] font-semibold text-d-text tracking-tight leading-tight">{analysis.title || view.titulo || 'Análisis'}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[13px] text-d-muted">
            {view.año != null && <span className="d-num">{view.año}</span>}
            {view.kilometraje != null && <span className="d-num">{(view.kilometraje / 1000).toFixed(0)}k km</span>}
            {view.ficha.combustible && <span>{view.ficha.combustible}</span>}
            {view.score_global != null && <span className="text-d-accent font-semibold d-num">{view.score_global}/10</span>}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
            {analysis.source_url && (
              <a href={analysis.source_url} target="_blank" rel="noopener" className="d-link text-xs inline-flex items-center gap-1">
                Ver anuncio original <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {view.url_busqueda_mercado && (
              <a href={view.url_busqueda_mercado} target="_blank" rel="noopener" className="d-link text-xs inline-flex items-center gap-1">
                Ver precios de mercado <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Key numbers first — Compra, venta, margen and mercado at a glance */}
      <KeyNumbers view={view} deductImportVat={deductImportVat} />

      {/* Photo strip — opens the in-page viewer, never a new tab */}
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 mb-6">
          {photos.map((src, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setPhotoIdx(i)}
              aria-label={`Ver foto ${i + 1}`}
              className="shrink-0 rounded-lg overflow-hidden border border-d-border hover:border-d-accent transition-colors"
            >
              <img src={src} alt="" loading="lazy" className="h-24 w-32 object-cover" />
            </button>
          ))}
        </div>
      )}

      <DealerAnalysisReport view={view} mode="full" deductImportVat={deductImportVat} />

      <p className="text-d-dim text-xs mt-6 d-num">
        Analizado el {new Date(analysis.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
        {view.precio_compra_total != null && !view.is_national && <> · anuncio €{fmt(view.precio_compra_total)}</>}
      </p>

      {photoIdx !== null && photos.length > 0 && (
        <PhotoLightbox images={photos} index={photoIdx} onIndex={setPhotoIdx} onClose={() => setPhotoIdx(null)} />
      )}
    </div>
  );
}

// The decision numbers, front and center — like the Operaciones hero band.
// "Compra" (real cash cost, net when the dealer buys sin IVA) leads, then venta,
// margen and the Spanish market price with a direct link to the comparables.
function KeyNumbers({ view, deductImportVat }: { view: AnalysisView; deductImportVat?: boolean }) {
  const net = netEconomics(view.iva_import, view.precio_compra_total, view.margen_bruto, deductImportVat);
  const dealer = !view.is_national;
  const compra = net ? net.costeNeto : view.precio_compra_total;
  const margenPct = net ? net.margenPctNeto : view.margen_porcentaje;

  const stats: { label: string; value: string; accent?: 'green' | 'amber'; caveat?: string; link?: string | null; big?: boolean }[] = [];
  if (compra != null) stats.push({ label: 'Compra', value: `€${fmt(compra)}`, big: true });
  if (dealer && view.precio_venta_estimado != null) stats.push({ label: 'Venta estimada', value: `€${fmt(view.precio_venta_estimado)}` });
  if (dealer && margenPct != null) stats.push({
    label: 'Margen',
    value: `${margenPct}%`,
    accent: view.low_confidence ? 'amber' : 'green',
    caveat: view.low_confidence ? 'no fiable' : undefined,
  });
  if (view.precio_medio != null) stats.push({ label: 'Mercado ES', value: `€${fmt(view.precio_medio)}`, link: view.url_busqueda_mercado });

  if (stats.length === 0) return null;
  return (
    <div className="mb-6 border-y border-d-border py-4 grid grid-cols-2 gap-x-4 gap-y-4 sm:flex sm:items-stretch sm:gap-0">
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col gap-1.5 min-w-0 sm:flex-1 sm:px-6 sm:border-l sm:border-d-border sm:first:border-l-0 sm:first:pl-0">
          <span className="text-xs font-medium text-d-muted">{s.label}</span>
          <span className={`font-semibold leading-none tabular-nums truncate ${s.big ? 'text-[24px] sm:text-[28px]' : 'text-[20px]'} ${s.accent === 'green' ? 'text-d-green' : s.accent === 'amber' ? 'text-d-amber' : 'text-d-text'}`}>
            {s.value}
          </span>
          {s.caveat && <span className="text-[11px] text-d-amber">{s.caveat}</span>}
          {s.link && (
            <a href={s.link} target="_blank" rel="noopener" className="d-link text-[11px] inline-flex items-center gap-0.5 w-fit">
              ver anuncios <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

export default function DealerAnalisisPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-7 h-7 text-d-accent animate-spin" /></div>}>
      <AnalisisContent />
    </Suspense>
  );
}
