'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ScoreRadarChart } from '@/components/ScoreRadarChart';
import { netEconomics, type AnalysisView } from '@/lib/analysis-view';
import { calculateIEDMT, REGION_LABELS, type IEDMTInputs, type Region } from '@/lib/iedmt';
import {
  AlertTriangle, TrendingUp, ShieldCheck, Wrench, ExternalLink, Lightbulb,
  FileText, Receipt, Ship, ClipboardCheck, Gauge, ArrowRight, Info,
  Check, ChevronDown, Search,
} from 'lucide-react';

/**
 * Renders a car analysis in the dealer theme (dark on screen, white on print).
 *
 * Two orthogonal axes:
 *   - mode="full"   → the dealer's own view: everything, incl. purchase cost, margin,
 *                     import costs and IEDMT.
 *   - mode="client" → the buyer's report: economics hidden, reassurance framing.
 *
 * The full report lives at /dealer/analisis/[id]. For an inline "peek" (list-row
 * dropdown) use <DealerAnalysisPeek> instead — it always carries a link to the
 * full page so a compact view is never a dead end.
 */

const eur = (n: number | null | undefined) => (n == null ? '—' : `€${Math.round(n).toLocaleString('es-ES')}`);
const kkm = (n: number | null | undefined) => (n == null ? '—' : `${(n / 1000).toFixed(0)}k km`);

function riskClass(r: string): string {
  return r === 'alto' ? 'bg-red-500/15 text-red-400'
    : r === 'medio' || r === 'bajo-medio' ? 'bg-yellow-500/15 text-yellow-400'
      : 'bg-emerald-500/15 text-emerald-400';
}
function gravedadClass(g: string | null): string {
  const s = (g || '').toLowerCase();
  return s === 'grave' ? 'bg-red-500/15 text-red-400'
    : s === 'moderado' || s === 'moderada' ? 'bg-yellow-500/15 text-yellow-400'
      : 'bg-d-surface-3 text-d-muted';
}
function verdictTagClass(v: string): string {
  return /rentab|recomend|buen|s[ií]|oportun/i.test(v) ? 'd-tag-good'
    : /da[ñn]ad|no rentable|evita|problema/i.test(v) ? 'd-tag-warn'
      : 'd-tag-info';
}

/* ══════════════════════════════ FULL REPORT ══════════════════════════════ */

export function DealerAnalysisReport({ view, mode = 'full', deductImportVat }: { view: AnalysisView; mode?: 'full' | 'client'; deductImportVat?: boolean }) {
  return mode === 'client'
    ? <ClientReport view={view} />
    : <DealerReport view={view} deductImportVat={deductImportVat} />;
}

/** The buyer's report: economics hidden, reassurance framing. */
function ClientReport({ view }: { view: AnalysisView }) {
  return (
    <div className="divide-y divide-d-border">
      <ScoreVerdict view={view} />
      <FichaTecnica view={view} />
      <Market view={view} mode="client" />
      <ModelFaults view={view} mode="client" />
      <RevisionTecnica view={view} />
    </div>
  );
}

/**
 * The dealer's own view, ordered for a 5-second buy / no-buy read:
 * veredicto -> impuesto -> que falla -> mercado -> ficha. Everything that is
 * reference material (desglose de importacion, mantenimiento, comparables uno a
 * uno, negociacion) lives behind "Ver todo el detalle", so the first screen only
 * carries the decision.
 */
function DealerReport({ view, deductImportVat }: { view: AnalysisView; deductImportVat?: boolean }) {
  const [detail, setDetail] = useState(false);
  const showEconomics = !view.is_national;
  const iva = view.iva_import;
  const net = netEconomics(iva, view.precio_compra_total, view.margen_bruto, deductImportVat);

  return (
    <div>
      <VerdictHero view={view} />

      {showEconomics && iva?.vat_deductible && (
        <div className="mt-4"><VatBreakdown iva={iva} applied={!!net} /></div>
      )}
      {showEconomics && view.iedmt && <IedmtGlance iedmt={view.iedmt} />}

      <Alerts view={view} />
      <MarketGlance view={view} />

      <div className="mt-4 rounded-xl border border-d-border px-4 py-3.5">
        <FichaTecnica view={view} bare />
      </div>

      <button
        onClick={() => setDetail(d => !d)}
        className="mt-4 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-d-border py-2.5 text-[13px] font-medium text-d-text-2 hover:text-d-text hover:bg-d-surface-2 transition-colors"
      >
        {detail ? 'Ocultar el detalle' : 'Ver todo el detalle'}
        <ChevronDown className={`w-4 h-4 transition-transform ${detail ? 'rotate-180' : ''}`} />
      </button>

      {detail && (
        <div className="divide-y divide-d-border">
          {showEconomics && <Economics view={view} deductImportVat={deductImportVat} />}
          {showEconomics && view.costes_importacion && <CostesImportacion view={view} />}
          {showEconomics && view.iedmt && <IedmtBlock iedmt={view.iedmt} />}
          <Market view={view} mode="full" />
          <ProblemasAnuncio view={view} />
          <ModelFaults view={view} mode="full" />
          <PuntosDebiles view={view} />
          <Mantenimiento view={view} />
          <RevisionTecnica view={view} />
          <Negociacion view={view} />
        </div>
      )}
    </div>
  );
}

/* ---------------------- GLANCE BLOCKS (dealer only) ---------------------- */

/** Buy / do not buy, in one line, with the score beside it. */
function VerdictHero({ view }: { view: AnalysisView }) {
  const [more, setMore] = useState(false);
  if (!view.veredicto && !view.razonamiento && view.score_global == null) return null;
  const good = view.veredicto ? /rentab|recomend|buen|s[ií]|oportun/i.test(view.veredicto) : false;
  const bad = view.veredicto ? /da[ñn]ad|no rentable|evita|problema/i.test(view.veredicto) : false;
  const shell = good ? 'border-d-green/30 bg-d-green/[.07]'
    : bad ? 'border-red-500/30 bg-red-500/[.07]'
      : 'border-d-border bg-d-surface-2';
  return (
    <div className={`rounded-xl border px-4 py-3.5 sm:px-5 sm:py-4 ${shell}`}>
      <div className="flex items-start gap-3">
        <span className={`shrink-0 grid place-items-center w-9 h-9 rounded-full ${good ? 'bg-d-green/15 text-d-green' : bad ? 'bg-red-500/15 text-red-400' : 'bg-d-surface-3 text-d-muted'}`}>
          {good ? <Check className="w-5 h-5" /> : bad ? <AlertTriangle className="w-5 h-5" /> : <Info className="w-5 h-5" />}
        </span>
        <div className="min-w-0 flex-1">
          {view.veredicto && (
            <p className={`text-[17px] sm:text-[19px] font-semibold leading-snug ${good ? 'text-d-green' : bad ? 'text-red-400' : 'text-d-text'}`}>
              {view.veredicto}
            </p>
          )}
          {view.razonamiento && (
            <>
              <p className={`text-d-text-2 text-[13.5px] leading-relaxed mt-1 whitespace-pre-line ${more ? '' : 'line-clamp-2'}`}>
                {view.razonamiento}
              </p>
              {view.razonamiento.length > 160 && (
                <button onClick={() => setMore(m => !m)} className="d-link text-xs mt-1">
                  {more ? 'menos' : 'leer más'}
                </button>
              )}
            </>
          )}
        </div>
        {view.score_global != null && (
          <div className="shrink-0 text-right">
            <div className="text-[26px] font-bold text-d-accent leading-none d-num">{view.score_global}</div>
            <div className="text-[11px] text-d-dim mt-0.5">/ 10</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** IEDMT in three numbers: base imponible, epigrafe, lo que se paga. */
function IedmtGlance({ iedmt }: { iedmt: { inputs: IEDMTInputs; source: string | null; co2Estimated: boolean } }) {
  let res;
  try { res = calculateIEDMT(iedmt.inputs); } catch { return null; }
  return (
    <div className="mt-4 rounded-xl border border-d-border bg-d-surface-2 px-4 py-3">
      <div className="flex items-center gap-2 mb-2.5">
        <Receipt className="w-3.5 h-3.5 text-d-accent" />
        <span className="text-[13px] font-semibold text-d-text">Impuesto de matriculación</span>
        <span className="ml-auto text-[11px] text-d-dim">solo tú</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="d-cap">Base imponible</div>
          <div className="text-d-text font-semibold d-num mt-0.5">{eur(res.baseImponibleFinal)}</div>
        </div>
        <div>
          <div className="d-cap">Epígrafe</div>
          <div className="text-d-text font-semibold d-num mt-0.5">{res.epigrafe}.º · {res.cuotaTributariaPct.toFixed(2)}%</div>
        </div>
        <div>
          <div className="d-cap">A pagar</div>
          <div className="text-d-green font-bold text-[17px] d-num mt-0.5">{eur(res.totalAPagar)}</div>
        </div>
      </div>
      {iedmt.co2Estimated && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          CO₂ estimado — la cuota real puede variar.
        </p>
      )}
    </div>
  );
}

/**
 * What is wrong, in three buckets: this ad, the model's typical failures, and
 * what these cars are known to suffer from. An empty bucket says so in green --
 * "nothing found" is information too.
 */
function Alerts({ view }: { view: AnalysisView }) {
  const anuncio = view.problemas_anuncio;
  const fallos = [...view.fallos].sort((a, b) => riskRank(b.riesgo) - riskRank(a.riesgo));
  const pd = view.puntos_debiles;
  const pecan = pd ? [...pd.electrica, ...pd.electronica, ...pd.interiores] : [];
  if (anuncio.length === 0 && fallos.length === 0 && pecan.length === 0) return null;
  return (
    <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
      <AlertCard
        title="En este anuncio"
        empty="Nada raro en el anuncio"
        items={anuncio.slice(0, 3).map(p => ({
          badge: p.gravedad || null,
          badgeClass: gravedadClass(p.gravedad),
          text: p.traduccion || p.problema,
        }))}
        extra={anuncio.length - 3}
      />
      <AlertCard
        title="Fallos típicos del modelo"
        empty="Sin fallos típicos registrados"
        items={fallos.slice(0, 3).map(f => ({
          badge: f.riesgo,
          badgeClass: riskClass(f.riesgo),
          text: f.componente,
          sub: (f.coste_min != null || f.coste_max != null) ? `${eur(f.coste_min)}–${eur(f.coste_max)}` : null,
        }))}
        extra={fallos.length - 3}
      />
      <AlertCard
        title="De qué pecan estos coches"
        empty="Sin puntos débiles conocidos"
        items={pecan.slice(0, 3).map(t => ({ badge: null, badgeClass: '', text: t }))}
        extra={pecan.length - 3}
      />
    </div>
  );
}

function riskRank(riesgo: string): number {
  return riesgo === 'alto' ? 3 : riesgo === 'medio' || riesgo === 'bajo-medio' ? 2 : 1;
}

function AlertCard({ title, items, empty, extra }: {
  title: string;
  items: { badge: string | null; badgeClass: string; text: string; sub?: string | null }[];
  empty: string;
  extra: number;
}) {
  return (
    <div className="rounded-xl border border-d-border bg-d-surface-2 px-3.5 py-3">
      <div className="d-cap mb-2">{title}</div>
      {items.length === 0 ? (
        <p className="text-d-green text-[12.5px] inline-flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5 shrink-0" /> {empty}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="text-[12.5px] leading-snug">
              {it.badge && (
                <span className={`mr-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${it.badgeClass}`}>{it.badge}</span>
              )}
              <span className="text-d-text-2">{it.text}</span>
              {it.sub && <span className="text-d-dim d-num"> · {it.sub}</span>}
            </li>
          ))}
        </ul>
      )}
      {extra > 0 && <p className="text-d-dim text-[11px] mt-1.5">+{extra} más en el detalle</p>}
    </div>
  );
}

/** Spanish market price, with the coches.net search as a full-width button. */
function MarketGlance({ view }: { view: AnalysisView }) {
  if (view.precio_medio == null && view.comparables.length === 0) return null;
  return (
    <div className="mt-4 rounded-xl border border-d-border px-4 py-3.5">
      <div className="flex items-baseline gap-2 mb-3 flex-wrap">
        <span className="text-[13px] font-semibold text-d-text">Precio de mercado en España</span>
        {view.n_comparables != null && (
          <span className="text-[11px] text-d-dim d-num">{view.n_comparables} anuncios</span>
        )}
        {view.low_confidence && (
          <span className="text-[11px] text-amber-400 inline-flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> muestra corta
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="d-cap">Mínimo</div>
          <div className="text-d-text-2 font-semibold d-num mt-0.5">{eur(view.precio_minimo)}</div>
        </div>
        <div>
          <div className="d-cap">Medio</div>
          <div className="text-d-text font-bold text-[20px] d-num mt-0.5">{eur(view.precio_medio)}</div>
        </div>
        <div>
          <div className="d-cap">Máximo</div>
          <div className="text-d-text-2 font-semibold d-num mt-0.5">{eur(view.precio_maximo)}</div>
        </div>
      </div>
      {view.url_busqueda_mercado && (
        <a
          href={view.url_busqueda_mercado}
          target="_blank"
          rel="noopener"
          className="mt-3.5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-d-accent/[.12] border border-d-accent/30 py-2.5 text-[13.5px] font-semibold text-d-accent hover:bg-d-accent/20 transition-colors"
        >
          <Search className="w-4 h-4" />
          Ver estos anuncios en coches.net
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  );
}

/* ══════════════════════════════ COMPACT PEEK ══════════════════════════════ */

/**
 * The inline "peek" used in list rows. Shows just enough to triage, and ALWAYS
 * links to the full analysis page — a compact view is never a dead end.
 */
export function DealerAnalysisPeek({ view, fullHref, mode = 'full', deductImportVat }: {
  view: AnalysisView; fullHref: string; mode?: 'full' | 'client'; deductImportVat?: boolean;
}) {
  const isFull = mode === 'full';
  const topFaults = view.fallos.slice(0, 3);
  const net = netEconomics(view.iva_import, view.precio_compra_total, view.margen_bruto, deductImportVat);
  return (
    <div className="space-y-3">
      {(view.veredicto || view.razonamiento || view.score_radar) && (
        <div className="flex gap-4 items-start">
          {view.score_radar && (
            <div className="w-24 h-24 shrink-0 hidden sm:block">
              <ScoreRadarChart
                score={view.score_radar}
                heightClass="h-full" showLabels={false} centerClassName="text-xl"
                accentColor="#AABEF5" fillColor="rgba(170,190,245,0.16)"
                gridColor="rgba(255,255,255,0.10)" labelColor="#8290aa" centerColor="#eef2f9"
              />
            </div>
          )}
          <div className="min-w-0 flex-1">
            {view.veredicto && (
              <span className={`d-tag mb-1.5 ${verdictTagClass(view.veredicto)}`}>{view.veredicto}</span>
            )}
            {view.razonamiento && (
              <p className="text-d-text-2 text-[13px] leading-relaxed line-clamp-3">{view.razonamiento}</p>
            )}
          </div>
        </div>
      )}

      {/* one-line economics / market summary */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
        {isFull && !view.is_national && view.precio_compra_total != null && (
          <span className="text-d-muted">Coste <span className="text-d-text font-semibold d-num">{eur(net ? net.costeNeto : view.precio_compra_total)}</span>{net && <span className="text-d-green text-[11px] ml-1">sin IVA</span>}</span>
        )}
        {view.precio_medio != null && (
          <span className="text-d-muted">Mercado <span className="text-d-text font-semibold d-num">{eur(view.precio_medio)}</span></span>
        )}
        {isFull && !view.is_national && view.margen_porcentaje != null && (
          view.low_confidence ? (
            <span className="text-amber-400 inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Margen no fiable</span>
          ) : (
            <span className="text-d-green font-semibold d-num">Margen {net ? net.margenPctNeto : view.margen_porcentaje}%</span>
          )
        )}
        {view.score_global != null && <span className="text-d-accent font-semibold d-num">{view.score_global}/10</span>}
      </div>

      {topFaults.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {topFaults.map((f, i) => (
            <span key={i} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] ${riskClass(f.riesgo)}`}>
              {f.componente}
            </span>
          ))}
          {view.fallos.length > 3 && <span className="text-d-dim text-[11px] self-center">+{view.fallos.length - 3}</span>}
        </div>
      )}

      <Link href={fullHref} className="d-link text-[13px] font-medium inline-flex items-center gap-1">
        Ver análisis completo <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}

/* ══════════════════════════════ SECTIONS ══════════════════════════════ */

function ScoreVerdict({ view }: { view: AnalysisView }) {
  if (!view.score_radar && !view.veredicto && !view.razonamiento) return null;
  return (
    <section className="py-6 first:pt-0 last:pb-0">
      <div className="flex flex-col sm:flex-row gap-5 sm:gap-7 items-center">
        {view.score_radar && (
          <div className="w-full max-w-[210px] aspect-square mx-auto sm:mx-0 sm:w-[200px] shrink-0">
            <ScoreRadarChart
              score={view.score_radar}
              heightClass="h-full" compactLabels centerClassName="text-[38px]"
              accentColor="#AABEF5" fillColor="rgba(170,190,245,0.16)"
              gridColor="rgba(255,255,255,0.10)" labelColor="#8290aa" centerColor="#eef2f9"
            />
          </div>
        )}
        <div className="min-w-0 flex-1">
          {view.veredicto && (
            <span className={`d-tag mb-2.5 ${verdictTagClass(view.veredicto)}`}>{view.veredicto}</span>
          )}
          {view.razonamiento && (
            <p className="text-d-text-2 text-sm sm:text-[15px] leading-relaxed whitespace-pre-line">{view.razonamiento}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function FichaTecnica({ view, bare }: { view: AnalysisView; bare?: boolean }) {
  const f = view.ficha;
  const rows: [string, string | null][] = [
    ['Año', f.año != null ? String(f.año) : null],
    ['Kilometraje', f.kilometraje != null ? `${f.kilometraje.toLocaleString('es-ES')} km` : null],
    ['Potencia', f.potencia],
    ['Combustible', f.combustible],
    ['Transmisión', f.transmision],
    ['Carrocería', f.carroceria],
    ['Tracción', f.traccion],
    ['CO₂', f.emisiones_co2 != null ? `${f.emisiones_co2} g/km` : null],
    ['Etiqueta', f.etiqueta_ambiental],
    ['Estado', f.estado_general],
  ];
  const filled = rows.filter(([, v]) => v);
  if (filled.length === 0 && !f.resumen) return null;
  const body = (
    <>
      {f.resumen && <p className="text-d-text-2 text-[13.5px] leading-relaxed mb-3">{f.resumen}</p>}
      {filled.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5">
          {filled.map(([k, v]) => (
            <div key={k}>
              <div className="d-cap">{k}</div>
              <div className="text-d-text text-sm font-medium mt-0.5">{v}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
  // `bare` drops the <Section> chrome: the glance layout already puts the ficha
  // inside its own card, and nesting two headers reads like a bug.
  if (bare) {
    return (
      <>
        <div className="flex items-center gap-2 mb-2.5">
          <FileText className="w-3.5 h-3.5 text-d-accent" />
          <span className="text-[13px] font-semibold text-d-text">Ficha técnica</span>
        </div>
        {body}
      </>
    );
  }
  return (
    <Section icon={<FileText className="w-3.5 h-3.5" />} title="Ficha técnica">
      {body}
    </Section>
  );
}

/**
 * Import-VAT breakdown for deductible listings ("MwSt ausweisbar" / IVA esposta).
 * When the dealer buys sin IVA (`applied`), the net is the real cash cost and the
 * margin above is computed on it. When the setting is off we still surface both
 * prices so the deductible saving is visible, with a nudge to enable it.
 */
function VatBreakdown({ iva, applied }: { iva: NonNullable<AnalysisView['iva_import']>; applied: boolean }) {
  return (
    <div className="mb-4 rounded-lg bg-d-surface-2 border border-d-border px-3.5 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        <span className="d-tag d-tag-good shrink-0">sin IVA</span>
        <span className="text-d-muted">Anuncio (con IVA) <span className="text-d-text font-semibold d-num">{eur(iva.precio_bruto)}</span></span>
        <ArrowRight className="w-3.5 h-3.5 text-d-dim shrink-0" />
        <span className="text-d-muted">Compra neta <span className="text-d-green font-semibold d-num">{eur(iva.precio_neto)}</span></span>
        <span className="text-d-dim">· IVA {iva.vat_rate}% deducible</span>
      </div>
      {!applied && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-d-muted">
          <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
          Activa <b className="font-semibold">Comprar sin IVA</b> en ajustes para calcular el margen sobre el precio neto.
        </p>
      )}
    </div>
  );
}

function Economics({ view, deductImportVat }: { view: AnalysisView; deductImportVat?: boolean }) {
  if (view.precio_compra_total == null && view.precio_venta_estimado == null && view.margen_porcentaje == null) return null;
  const iva = view.iva_import;
  const net = netEconomics(iva, view.precio_compra_total, view.margen_bruto, deductImportVat);
  const marginPct = net ? net.margenPctNeto : view.margen_porcentaje;
  const marginBruto = net ? net.margenBrutoNeto : view.margen_bruto;
  return (
    <Section icon={<TrendingUp className="w-3.5 h-3.5" />} title="Rentabilidad" dealerOnly>
      {iva?.vat_deductible && <VatBreakdown iva={iva} applied={!!net} />}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Metric
          label="Coste total"
          value={eur(net ? net.costeNeto : view.precio_compra_total)}
          caveat={net ? `${eur(view.precio_compra_total)} con IVA` : undefined}
        />
        <Metric label="Venta estimada" value={eur(view.precio_venta_estimado)} />
        <Metric
          label={net ? 'Margen (sin IVA)' : 'Margen'}
          value={marginPct != null ? `${marginPct}%${marginBruto != null ? ` · ${eur(marginBruto)}` : ''}` : '—'}
          accent={view.low_confidence ? 'amber' : 'green'}
          caveat={view.low_confidence ? `Orientativo — muestra insuficiente${view.n_comparables != null ? ` (${view.n_comparables} comp.)` : ''}` : undefined}
        />
      </div>
      {view.factores_valoracion.length > 0 && (
        <ul className="mt-4 pt-4 border-t border-d-border space-y-1.5">
          {view.factores_valoracion.map((t, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-d-text-2"><span className="text-d-accent">·</span> {t}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function CostesImportacion({ view }: { view: AnalysisView }) {
  const ci = view.costes_importacion!;
  if (ci.lines.length === 0 && ci.total == null) return null;
  return (
    <Section icon={<Ship className="w-3.5 h-3.5" />} title="Costes de importación" dealerOnly>
      <div className="divide-y divide-d-border">
        {ci.lines.map((l, i) => (
          <div key={i} className="flex justify-between items-center py-2 text-sm">
            <span className="text-d-muted">{l.label}</span>
            <span className="text-d-text font-medium d-num">{eur(l.amount)}</span>
          </div>
        ))}
        {ci.total != null && (
          <div className="flex justify-between items-center pt-2.5 mt-0.5 text-sm">
            <span className="text-d-text font-semibold">Coste total puesto en España</span>
            <span className="text-d-text font-bold d-num">{eur(ci.total)}</span>
          </div>
        )}
      </div>
    </Section>
  );
}

function IedmtBlock({ iedmt }: { iedmt: { inputs: IEDMTInputs; source: string | null; co2Estimated: boolean } }) {
  let res;
  try {
    res = calculateIEDMT(iedmt.inputs);
  } catch {
    return null;
  }
  const regionLabel = REGION_LABELS[iedmt.inputs.region as Region] || '';
  return (
    <Section icon={<Receipt className="w-3.5 h-3.5" />} title="Impuesto de matriculación (IEDMT)" dealerOnly>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Metric label="Base imponible" value={eur(res.baseImponibleFinal)} caveat={`Valoración: ${eur(res.valoracionInicial)}`} />
        <Metric label={`Epígrafe ${res.epigrafe}.º`} value={`${res.cuotaTributariaPct.toFixed(2)}%`} caveat={res.epigrafeDescripcion} />
        <Metric label="Total a pagar" value={eur(res.totalAPagar)} accent="green" caveat={res.exento ? res.exentoRazon : regionLabel} />
      </div>
      {iedmt.co2Estimated && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-amber-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          CO₂ estimado por cilindrada y combustible — la cuota real puede variar.
        </p>
      )}
    </Section>
  );
}

function Market({ view, mode }: { view: AnalysisView; mode: 'full' | 'client' }) {
  const isFull = mode === 'full';
  if (view.precio_medio == null && view.comparables.length === 0) return null;
  return (
    <Section title="Precio de mercado en España">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-3">
        <Metric label="Mínimo" value={eur(view.precio_minimo)} />
        <Metric label="Medio" value={eur(view.precio_medio)} />
        <Metric label="Máximo" value={eur(view.precio_maximo)} />
      </div>
      {view.n_comparables != null && (
        <p className="text-d-dim text-xs">
          Basado en {view.n_comparables} anuncios comparables de coches.net
          {isFull && view.url_busqueda_mercado && (
            <> · <a href={view.url_busqueda_mercado} target="_blank" rel="noopener" className="d-link inline-flex items-center gap-0.5">ver todos <ExternalLink className="w-3 h-3" /></a></>
          )}
        </p>
      )}
      {view.analisis_comparativo && <p className="text-d-text-2 text-sm leading-relaxed mt-3">{view.analisis_comparativo}</p>}
      {/* Per-comparable list links out to competitor ads — dealer-only. */}
      {isFull && view.comparables.length > 0 && <Comparables view={view} />}
    </Section>
  );
}

/**
 * The coches.net sample, as scannable cards. Each one is a single link target
 * with a visible "Ver anuncio" affordance -- the old row ended in a bare arrow
 * icon nobody read as clickable.
 */
function Comparables({ view }: { view: AnalysisView }) {
  const [all, setAll] = useState(false);
  const list = all ? view.comparables : view.comparables.slice(0, 6);
  const medio = view.precio_medio;
  return (
    <div className="mt-4">
      <div className="d-cap mb-2">Anuncios comparables</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {list.map((c, i) => {
          const delta = medio != null && c.precio != null ? Math.round(((c.precio - medio) / medio) * 100) : null;
          const inner = (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-d-text font-bold text-[15px] d-num">{eur(c.precio)}</span>
                {delta != null && delta !== 0 && (
                  <span className={`text-[11px] font-medium d-num ${delta < 0 ? 'text-d-green' : 'text-d-muted'}`}>
                    {delta > 0 ? '+' : ''}{delta}% vs medio
                  </span>
                )}
              </div>
              {c.titulo && <p className="text-d-muted text-[12px] truncate mt-0.5">{c.titulo}</p>}
              <div className="flex items-center gap-2.5 mt-1 text-[11.5px] text-d-dim d-num">
                <span>{c.año ?? '—'}</span>
                <span>{kkm(c.km)}</span>
                {c.cv != null && <span>{c.cv} CV</span>}
                {c.url && (
                  <span className="ml-auto inline-flex items-center gap-1 text-d-accent font-medium">
                    Ver anuncio <ExternalLink className="w-3 h-3" />
                  </span>
                )}
              </div>
            </>
          );
          return c.url ? (
            <a
              key={i}
              href={c.url}
              target="_blank"
              rel="noopener"
              className="rounded-lg border border-d-border px-3 py-2.5 hover:border-d-accent/40 hover:bg-d-surface-2 transition-colors"
            >
              {inner}
            </a>
          ) : (
            <div key={i} className="rounded-lg border border-d-border px-3 py-2.5">{inner}</div>
          );
        })}
      </div>
      {view.comparables.length > 6 && (
        <button onClick={() => setAll(a => !a)} className="d-link text-[12.5px] mt-2">
          {all ? 'Ver menos' : `Ver los ${view.comparables.length} anuncios`}
        </button>
      )}
    </div>
  );
}

function ProblemasAnuncio({ view }: { view: AnalysisView }) {
  if (view.problemas_anuncio.length === 0 && view.advertencias_vendedor.length === 0 && !view.comentario_anuncio) return null;
  return (
    <Section icon={<AlertTriangle className="w-3.5 h-3.5" />} title="Detectado en este anuncio">
      {view.problemas_anuncio.length > 0 && (
        <div className="space-y-2">
          {view.problemas_anuncio.map((p, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              {p.gravedad && <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wide ${gravedadClass(p.gravedad)}`}>{p.gravedad}</span>}
              <span className="text-d-text-2 min-w-0">{p.traduccion || p.problema}</span>
            </div>
          ))}
        </div>
      )}
      {view.advertencias_vendedor.length > 0 && (
        <ul className="mt-3 space-y-1">
          {view.advertencias_vendedor.map((a, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-d-muted"><span className="text-d-amber">·</span> {a}</li>
          ))}
        </ul>
      )}
      {view.comentario_anuncio && <p className="text-d-dim text-[13px] leading-relaxed mt-3">{view.comentario_anuncio}</p>}
    </Section>
  );
}

function ModelFaults({ view, mode }: { view: AnalysisView; mode: 'full' | 'client' }) {
  if (view.fallos.length === 0) return null;
  const isFull = mode === 'full';
  return (
    <Section
      icon={isFull ? <Wrench className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
      title={isFull ? 'Fallos típicos del modelo' : 'Puntos a verificar (fallos conocidos del modelo)'}
    >
      {view.motorizacion && <p className="text-d-dim text-xs mb-3">Motorización: <span className="text-d-muted">{view.motorizacion}</span></p>}
      <div className="space-y-3">
        {view.fallos.map((f, i) => {
          const hasRange = f.coste_min != null || f.coste_max != null || f.km_min != null || f.km_max != null;
          return (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wide ${riskClass(f.riesgo)}`}>{f.riesgo}</span>
              <div className="min-w-0">
                <span className="text-d-text font-medium">{f.componente}:</span>{' '}
                <span className="text-d-muted">{f.descripcion || f.problema}</span>
                {hasRange && (
                  <div className="text-d-dim text-[11px] mt-0.5 d-num">
                    {(f.coste_min != null || f.coste_max != null) && <>Reparación {eur(f.coste_min)}–{eur(f.coste_max)}</>}
                    {(f.km_min != null || f.km_max != null) && <> · aparece {kkm(f.km_min)}–{kkm(f.km_max)}</>}
                    {f.frecuencia && <> · {f.frecuencia.replace(/_/g, ' ')}</>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {isFull && view.historial_motor && <p className="text-d-dim text-[13px] leading-relaxed mt-4 pt-4 border-t border-d-border">{view.historial_motor}</p>}
    </Section>
  );
}

function PuntosDebiles({ view }: { view: AnalysisView }) {
  const pd = view.puntos_debiles;
  if (!pd) return null;
  const groups: [string, string[]][] = [['Eléctrica', pd.electrica], ['Electrónica', pd.electronica], ['Interiores', pd.interiores]];
  const filled = groups.filter(([, arr]) => arr.length > 0);
  if (filled.length === 0) return null;
  return (
    <Section icon={<Info className="w-3.5 h-3.5" />} title="Puntos débiles conocidos">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {filled.map(([label, arr]) => (
          <div key={label}>
            <div className="d-cap mb-1.5">{label}</div>
            <ul className="space-y-1">
              {arr.map((t, i) => <li key={i} className="text-d-muted text-[13px] flex items-start gap-1.5"><span className="text-d-dim">·</span> {t}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Mantenimiento({ view }: { view: AnalysisView }) {
  const m = view.mantenimiento;
  if (!m || (m.items.length === 0 && !m.comparativa_segmento && !m.depreciacion_esperada)) return null;
  return (
    <Section icon={<Gauge className="w-3.5 h-3.5" />} title="Coste de mantenimiento">
      {m.motor_identificado && <p className="text-d-dim text-xs mb-3">Motor: <span className="text-d-muted">{m.motor_identificado}</span></p>}
      {m.items.length > 0 && (
        <div className="divide-y divide-d-border">
          {m.items.map((it, i) => {
            const cost = it.coste_min != null || it.coste_max != null
              ? `${eur(it.coste_min)}–${eur(it.coste_max)}`
              : it.coste_estimado != null ? eur(it.coste_estimado) : '—';
            const vencido = it.km_restantes != null && it.km_restantes <= 0;
            const pronto = it.km_restantes != null && it.km_restantes > 0 && it.km_restantes < 5000;
            return (
              <div key={i} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-d-text text-sm font-medium">{it.componente}</p>
                  {it.descripcion && <p className="text-d-dim text-xs mt-0.5">{it.descripcion}</p>}
                  {it.km_restantes != null && (
                    <p className={`text-[11px] mt-0.5 d-num ${vencido ? 'text-d-red' : pronto ? 'text-d-amber' : 'text-d-dim'}`}>
                      {vencido ? 'Vencido' : `en ${kkm(it.km_restantes)}`}
                    </p>
                  )}
                </div>
                <span className="text-d-text font-semibold text-sm d-num shrink-0">{cost}</span>
              </div>
            );
          })}
        </div>
      )}
      {(m.coste_total_min != null || m.coste_total_max != null) && (
        <div className="flex justify-between items-center pt-3 mt-1 border-t border-d-border text-sm">
          <span className="text-d-text font-semibold">Próximas revisiones</span>
          <span className="text-d-text font-bold d-num">{eur(m.coste_total_min)}–{eur(m.coste_total_max)}</span>
        </div>
      )}
      {(m.comparativa_segmento || m.depreciacion_esperada) && (
        <div className="mt-3 pt-3 border-t border-d-border space-y-1.5 text-[13px]">
          {m.comparativa_segmento && <p className="text-d-muted"><span className="text-d-dim">Vs. segmento: </span>{m.comparativa_segmento}</p>}
          {m.depreciacion_esperada && <p className="text-d-muted"><span className="text-d-dim">Depreciación: </span>{m.depreciacion_esperada}</p>}
        </div>
      )}
    </Section>
  );
}

function RevisionTecnica({ view }: { view: AnalysisView }) {
  const r = view.revision;
  if (!r || (r.elementos.length === 0 && r.consejos.length === 0)) return null;
  return (
    <Section icon={<ClipboardCheck className="w-3.5 h-3.5" />} title="Revisión recomendada antes de comprar">
      {r.elementos.length > 0 && (
        <div className="space-y-2.5">
          {r.elementos.map((e, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              {e.importancia && <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-semibold uppercase tracking-wide ${e.importancia === 'alta' ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/15 text-yellow-400'}`}>{e.importancia}</span>}
              <div className="min-w-0">
                <span className="text-d-text font-medium">{e.elemento}</span>
                {e.descripcion && <span className="text-d-muted">: {e.descripcion}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
      {r.consejos.length > 0 && (
        <ul className="mt-3 pt-3 border-t border-d-border space-y-1.5">
          {r.consejos.map((c, i) => <li key={i} className="flex items-start gap-2 text-[13px] text-d-text-2"><span className="text-d-accent">·</span> {c}</li>)}
        </ul>
      )}
    </Section>
  );
}

function Negociacion({ view }: { view: AnalysisView }) {
  if (view.tips_negociacion.length === 0 && view.precio_maximo_compra == null && view.precio_objetivo_venta == null && !view.estrategia_compra) return null;
  return (
    <Section icon={<Lightbulb className="w-3.5 h-3.5" />} title="Negociación y objetivos" dealerOnly>
      {view.estrategia_compra && <p className="text-d-text-2 text-sm leading-relaxed mb-3">{view.estrategia_compra}</p>}
      {view.tips_negociacion.length > 0 && (
        <ul className="space-y-1.5">
          {view.tips_negociacion.map((t, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-d-text-2"><span className="text-d-accent">·</span> {t}</li>
          ))}
        </ul>
      )}
      {(view.precio_maximo_compra != null || view.precio_objetivo_venta != null) && (
        <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-d-border">
          <Metric label="Precio máx. de compra" value={eur(view.precio_maximo_compra)} />
          <Metric label="Precio objetivo de venta" value={eur(view.precio_objetivo_venta)} />
        </div>
      )}
    </Section>
  );
}

/* ══════════════════════════════ PRIMITIVES ══════════════════════════════ */

function Section({ icon, title, children, dealerOnly }: {
  icon?: React.ReactNode; title: string; children: React.ReactNode; dealerOnly?: boolean;
}) {
  return (
    <section className="py-6 first:pt-0 last:pb-0">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold text-d-text mb-3.5">
        {icon && <span className="text-d-accent shrink-0">{icon}</span>}
        <span>{title}</span>
        {dealerOnly && <span className="ml-auto text-[11px] font-normal text-d-dim">solo tú</span>}
      </h3>
      {children}
    </section>
  );
}

function Metric({ label, value, accent, caveat }: { label: string; value: string; accent?: 'green' | 'amber'; caveat?: string }) {
  const color = accent === 'green' ? 'text-d-green' : accent === 'amber' ? 'text-amber-400' : 'text-d-text';
  return (
    <div>
      <div className="d-cap mb-1">{label}</div>
      <div className={`text-lg font-bold d-num ${color} inline-flex items-center gap-1`}>
        {accent === 'amber' && <AlertTriangle className="w-3.5 h-3.5" />}
        {value}
      </div>
      {caveat && <div className="text-d-dim text-[11px] mt-0.5 line-clamp-2">{caveat}</div>}
    </div>
  );
}
