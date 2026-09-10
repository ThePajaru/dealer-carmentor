'use client';

// Los dos trámites que hacemos nosotros sobre una operación ya cerrada de
// compra: el gestor presenta y paga el 576 + IVTM, y el ingeniero firma la
// ficha técnica reducida con las fotos que el runner ya sacó.
//
// Se pagan por encargo (Stripe one-off). Lo que aquí se muestra del precio sale
// de Stripe vía /api/dealer/services — nunca hay un importe escrito a mano.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Stamp, FileSignature, Loader2, Check, Clock, AlertTriangle, ExternalLink, Camera,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { calculateIEDMT, REGION_LABELS, type IEDMTInputs, type Region } from '@/lib/iedmt';
import {
  fichaExpediente, fichaMissing, SERVICE_STATUS_LABELS,
  type ServiceKey, type ServiceStatus,
} from '@/lib/dealer/services';
import type { RunnerReport } from '@/components/dealer/RunnerReportReview';

interface CatalogItem {
  key: ServiceKey;
  label: string;
  who: string;
  desc: string;
  deliverable: string;
  configured: boolean;
  amount_cents: number | null;
  currency: string;
}

/** Lo que la ficha de la operación necesita saber de un encargo. */
export interface ServiceOrderLite {
  id: string;
  kind: ServiceKey;
  status: ServiceStatus;
}

/** Documento que devuelve el colaborador, ya con URL firmada por la API. */
interface ResultFile {
  label: string;
  path: string;
  url: string | null;
}

interface ServiceOrder {
  id: string;
  kind: ServiceKey;
  status: ServiceStatus;
  amount_cents: number | null;
  paid_at: string | null;
  result: { nota?: string; files?: ResultFile[] };
  created_at: string;
}

interface Props {
  requestId: string;
  token: string | undefined;
  runnerReport: RunnerReport | null;
  /** Sube los encargos al paso, que decide con ellos si queda algo por cerrar. */
  onOrders?: (orders: ServiceOrderLite[]) => void;
  /** Datos del análisis del coche elegido, para no pedir dos veces lo que ya sabemos. */
  prefill?: {
    iedmtInputs?: Partial<IEDMTInputs> | null;
    co2?: number | null;
    año?: number | null;
    carTitle?: string | null;
  };
}

const eur = (n: number) => Math.round(n).toLocaleString('es-ES');
const money = (cents: number | null) => (cents == null ? null : `${eur(cents / 100)}€`);

function StatusPill({ status }: { status: ServiceStatus }) {
  const tone =
    status === 'completado' ? 'bg-d-green/15 text-d-green'
      : status === 'pendiente_pago' ? 'bg-d-amber/15 text-d-amber'
        : 'bg-d-accent/15 text-d-accent';
  return (
    <span className={`text-[11px] font-semibold px-2 py-1 rounded-md shrink-0 ${tone}`}>
      {SERVICE_STATUS_LABELS[status]}
    </span>
  );
}

/** Nota y documentos que ha devuelto el colaborador. */
function ResultBlock({ order }: { order: ServiceOrder }) {
  const files = order.result?.files || [];
  const nota = order.result?.nota;
  if (!nota && files.length === 0) return null;
  return (
    <>
      {nota && <p className="text-d-dim text-[12.5px] mt-2 leading-relaxed whitespace-pre-line">{nota}</p>}
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {files.map(f => (
            f.url ? (
              <a key={f.path} href={f.url} target="_blank" rel="noopener"
                className="d-btn-ghost text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1.5">
                <ExternalLink className="w-3.5 h-3.5" /> {f.label}
              </a>
            ) : (
              <span key={f.path} className="d-pill text-d-dim">{f.label} · no disponible</span>
            )
          ))}
        </div>
      )}
    </>
  );
}

export default function TramitesPanel({ requestId, token, runnerReport, onOrders, prefill }: Props) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordering, setOrdering] = useState<ServiceKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  // --- Formulario de impuestos (prefill desde el análisis) ---
  const pf = prefill?.iedmtInputs || null;
  const [region, setRegion] = useState<Region>((pf?.region as Region) || 'otra');
  const [valoracion, setValoracion] = useState<string>(pf?.valoracion != null ? String(Math.round(pf.valoracion)) : '');
  const [co2, setCo2] = useState<string>(
    pf?.co2 != null ? String(pf.co2) : prefill?.co2 != null ? String(prefill.co2) : '',
  );
  const [municipio, setMunicipio] = useState('');
  const [provincia, setProvincia] = useState('');
  const [cvf, setCvf] = useState('');
  const [primeraMat, setPrimeraMat] = useState<string>(() => {
    const f = pf?.fechaMatriculacion;
    if (typeof f === 'string') return f.slice(0, 10);
    if (f instanceof Date) return f.toISOString().slice(0, 10);
    return prefill?.año ? `${prefill.año}-01-01` : '';
  });

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/dealer/services?request_id=${requestId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudieron cargar los trámites');
      setCatalog(data.catalog || []);
      setOrders(data.orders || []);
      onOrders?.(data.orders || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar los trámites');
    } finally {
      setLoading(false);
    }
  }, [requestId, token, onOrders]);

  useEffect(() => { void load(); }, [load]);

  const orderOf = (kind: ServiceKey) => orders.find(o => o.kind === kind) || null;

  // El 576 estimado con los datos del formulario. Es una ESTIMACIÓN para que el
  // dealer sepa a qué se enfrenta; el importe real lo fija Hacienda con la
  // valoración oficial, y así se dice en pantalla.
  const iedmt = useMemo(() => {
    const val = Number(valoracion);
    if (!val || Number.isNaN(val)) return null;
    const inputs: IEDMTInputs = {
      vehicleType: 'coche-importado',
      valoracion: val,
      co2: co2 ? Number(co2) : null,
      region,
      fechaMatriculacion: primeraMat || null,
      potenciaFiscalCVF: cvf ? Number(cvf) : null,
    };
    try {
      return calculateIEDMT(inputs);
    } catch {
      return null;
    }
  }, [valoracion, co2, region, primeraMat, cvf]);

  const expediente = useMemo(() => fichaExpediente(runnerReport), [runnerReport]);
  const faltan = useMemo(() => fichaMissing(expediente), [expediente]);
  // La ficha se puede encargar EN CUANTO el runner manda su informe: el coche
  // sigue en Alemania y el ingeniero ya puede trabajar con esas fotos. Antes del
  // informe no hay expediente, asi que no hay nada que firmar.
  const hayInforme = !!runnerReport?.submitted_at;

  const encargar = async (kind: ServiceKey) => {
    if (!token) return;
    setOrdering(kind);
    setError(null);

    const payload: Record<string, unknown> = kind === 'impuestos'
      ? {
        region,
        region_label: REGION_LABELS[region],
        municipio: municipio.trim(),
        provincia: provincia.trim(),
        cvf: cvf ? Number(cvf) : null,
        valoracion: valoracion ? Number(valoracion) : null,
        co2: co2 ? Number(co2) : null,
        primera_matriculacion: primeraMat || null,
        iedmt_estimado: iedmt?.totalAPagar ?? null,
        coche: prefill?.carTitle ?? null,
      }
      : {
        photos: expediente.filter(p => p.url).map(p => ({ key: p.key, label: p.label, url: p.url })),
        faltan: faltan.map(p => p.label),
        coche: prefill?.carTitle ?? null,
      };

    try {
      const res = await fetch('/api/dealer/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ request_id: requestId, kind, payload }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'No se pudo iniciar el pago');
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar el pago');
      setOrdering(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-d-dim text-sm py-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando trámites…
      </div>
    );
  }

  const impuestos = catalog.find(c => c.key === 'impuestos');
  const ficha = catalog.find(c => c.key === 'ficha_reducida');
  const impuestosOrder = orderOf('impuestos');
  const fichaOrder = orderOf('ficha_reducida');

  return (
    <div className="space-y-4">
      <p className="text-d-dim text-[13px] leading-relaxed">
        Lo que va después de la compra lo hacemos nosotros: nuestro gestor presenta y paga los
        impuestos, y nuestro ingeniero firma la ficha técnica reducida con las fotos que tu runner
        ya sacó. Se pagan por operación, no van en tu cuota.
      </p>

      {error && (
        <div className="rounded-lg border border-d-red/25 bg-d-red/5 px-3 py-2 text-[13px] text-d-red">
          {error}
        </div>
      )}

      {/* ---------- Impuestos: 576 + IVTM ---------- */}
      <div className="rounded-xl border border-d-border p-4">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h4 className="text-sm font-semibold text-d-text flex items-center gap-2">
            <Stamp className="w-4 h-4 text-d-accent" /> {impuestos?.label || 'Impuestos de matriculación'}
          </h4>
          {impuestosOrder
            ? <StatusPill status={impuestosOrder.status} />
            : money(impuestos?.amount_cents ?? null) && (
              <span className="text-[13px] font-semibold text-d-text d-num shrink-0">
                {money(impuestos!.amount_cents)}
              </span>
            )}
        </div>
        <p className="text-d-dim text-xs mb-3">
          {impuestos?.desc || 'Presentamos y pagamos el modelo 576 y el IVTM del ayuntamiento.'}
          {' '}Se presentan con el coche ya comprado.
        </p>

        {impuestosOrder && impuestosOrder.status !== 'pendiente_pago' ? (
          <div className="rounded-lg bg-d-surface-2/50 px-3 py-2.5 text-[13px] text-d-text-2">
            <p className="flex items-center gap-2">
              {impuestosOrder.status === 'completado'
                ? <Check className="w-4 h-4 text-d-green shrink-0" />
                : <Clock className="w-4 h-4 text-d-accent shrink-0" />}
              {impuestosOrder.status === 'completado'
                ? 'Impuestos pagados. Tienes los justificantes abajo.'
                : 'Nuestro gestor lo tiene. Te avisamos en cuanto estén presentados.'}
            </p>
            <ResultBlock order={impuestosOrder} />
          </div>
        ) : (
          <>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="block text-[11px] text-d-dim">Comunidad donde se matricula (576)</span>
                <select value={region} onChange={e => setRegion(e.target.value as Region)} className="d-input w-full px-3 py-2 text-sm">
                  {(Object.keys(REGION_LABELS) as Region[]).map(r => (
                    <option key={r} value={r}>{REGION_LABELS[r]}</option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="block text-[11px] text-d-dim">Municipio (IVTM)</span>
                <input value={municipio} onChange={e => setMunicipio(e.target.value)} placeholder="p. ej. Valencia" className="d-input w-full px-3 py-2 text-sm" />
              </label>
              <label className="block space-y-1">
                <span className="block text-[11px] text-d-dim">Provincia</span>
                <input value={provincia} onChange={e => setProvincia(e.target.value)} placeholder="p. ej. Valencia" className="d-input w-full px-3 py-2 text-sm" />
              </label>
              <label className="block space-y-1">
                <span className="block text-[11px] text-d-dim">Potencia fiscal (CVF)</span>
                <input type="number" step="0.01" value={cvf} onChange={e => setCvf(e.target.value)} placeholder="p. ej. 11,5" className="d-input d-num w-full px-3 py-2 text-sm" />
              </label>
              <label className="block space-y-1">
                <span className="block text-[11px] text-d-dim">Valoración (€)</span>
                <input type="number" value={valoracion} onChange={e => setValoracion(e.target.value)} placeholder="p. ej. 18.000" className="d-input d-num w-full px-3 py-2 text-sm" />
              </label>
              <label className="block space-y-1">
                <span className="block text-[11px] text-d-dim">CO2 (g/km)</span>
                <input type="number" value={co2} onChange={e => setCo2(e.target.value)} placeholder="sin acreditar" className="d-input d-num w-full px-3 py-2 text-sm" />
              </label>
              <label className="block space-y-1 sm:col-span-2">
                <span className="block text-[11px] text-d-dim">1ª matriculación</span>
                <input type="date" value={primeraMat} onChange={e => setPrimeraMat(e.target.value)} className="d-input d-num w-full px-3 py-2 text-sm" />
              </label>
            </div>

            {iedmt && (
              <div className="mt-3 rounded-lg bg-d-surface-2/50 px-3 py-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-d-dim">Modelo 576 estimado</span>
                  <span className="font-semibold text-d-text d-num">
                    {iedmt.exento ? 'Exento' : `${eur(iedmt.totalAPagar)}€`}
                  </span>
                </div>
                <p className="text-d-dim text-[11px] mt-1 leading-snug">
                  {iedmt.exento
                    ? iedmt.exentoRazon
                    : `${iedmt.epigrafeDescripcion} · ${iedmt.cuotaTributariaPct}% sobre ${eur(iedmt.baseImponibleFinal)}€.`}
                  {' '}Estimación: el importe final lo fija Hacienda con su valoración oficial. El IVTM
                  depende de la ordenanza del municipio y lo calcula el gestor.
                </p>
              </div>
            )}

            {impuestos && !impuestos.configured ? (
              <p className="text-d-amber text-[13px] mt-3 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" /> Servicio aún no disponible para contratar.
              </p>
            ) : (
              <Button
                onClick={() => encargar('impuestos')}
                disabled={ordering !== null || !municipio.trim() || !valoracion}
                className="d-btn-primary text-sm mt-3"
              >
                {ordering === 'impuestos' && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
                {impuestosOrder?.status === 'pendiente_pago' ? 'Continuar el pago' : 'Encargar y pagar'}
                {money(impuestos?.amount_cents ?? null) && ` · ${money(impuestos!.amount_cents)}`}
              </Button>
            )}
          </>
        )}
      </div>

      {/* ---------- Ficha técnica reducida ---------- */}
      <div className="rounded-xl border border-d-border p-4">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h4 className="text-sm font-semibold text-d-text flex items-center gap-2">
            <FileSignature className="w-4 h-4 text-d-accent" /> {ficha?.label || 'Ficha técnica reducida'}
          </h4>
          {fichaOrder
            ? <StatusPill status={fichaOrder.status} />
            : money(ficha?.amount_cents ?? null) && (
              <span className="text-[13px] font-semibold text-d-text d-num shrink-0">
                {money(ficha!.amount_cents)}
              </span>
            )}
        </div>
        <p className="text-d-dim text-xs mb-3">
          {ficha?.desc || 'Nuestro ingeniero firma la ficha reducida con las fotos de la inspección.'}
        </p>

        {fichaOrder && fichaOrder.status !== 'pendiente_pago' ? (
          <div className="rounded-lg bg-d-surface-2/50 px-3 py-2.5 text-[13px] text-d-text-2">
            <p className="flex items-center gap-2">
              {fichaOrder.status === 'completado'
                ? <Check className="w-4 h-4 text-d-green shrink-0" />
                : <Clock className="w-4 h-4 text-d-accent shrink-0" />}
              {fichaOrder.status === 'completado'
                ? 'Ficha firmada.'
                : 'Nuestro ingeniero la está redactando con las fotos del expediente.'}
            </p>
            <ResultBlock order={fichaOrder} />
          </div>
        ) : (
          <>
            {!hayInforme ? (
              <div className="rounded-lg border border-d-border/70 p-3.5">
                <p className="text-[13px] text-d-text-2 flex items-start gap-2">
                  <Camera className="w-4 h-4 text-d-dim shrink-0 mt-0.5" />
                  <span>
                    La ficha sale de las fotos de la inspección, así que se encarga en cuanto tu
                    runner envíe su informe — con el coche todavía en Alemania. Aún no ha llegado.
                  </span>
                </p>
              </div>
            ) : (
            <>
            {/* El expediente sale del propio checklist del runner: aquí solo se
                enseña qué fotos ya están y cuáles faltarían por repetir. */}
            <div className="rounded-lg border border-d-border/70 p-3">
              <p className="text-[11px] uppercase tracking-wide text-d-dim mb-2">Expediente de fotos</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {expediente.map(p => (
                  <div key={p.key} className="flex items-center gap-2 text-[13px]">
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noopener" className="flex items-center gap-2 min-w-0 group">
                        <span className="w-5 h-5 rounded grid place-items-center bg-d-green/15 text-d-green shrink-0"><Check className="w-3 h-3" /></span>
                        <span className="text-d-text-2 truncate group-hover:text-d-accent">{p.label}</span>
                      </a>
                    ) : (
                      <>
                        <span className={`w-5 h-5 rounded grid place-items-center shrink-0 ${p.optional ? 'bg-d-surface-2 text-d-dim' : 'bg-d-amber/15 text-d-amber'}`}>
                          <Camera className="w-3 h-3" />
                        </span>
                        <span className="text-d-dim truncate">
                          {p.label}{p.optional ? ' · solo si lleva' : ''}
                        </span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {faltan.length > 0 && (
              <p className="text-d-amber text-[13px] mt-3 flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Faltan {faltan.length} foto{faltan.length === 1 ? '' : 's'} del expediente
                  ({faltan.map(p => p.label).join(', ')}). Puedes encargarla igual: te las pediremos
                  antes de firmar.
                </span>
              </p>
            )}

            {ficha && !ficha.configured ? (
              <p className="text-d-amber text-[13px] mt-3 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" /> Servicio aún no disponible para contratar.
              </p>
            ) : (
              <Button
                onClick={() => encargar('ficha_reducida')}
                disabled={ordering !== null}
                className="d-btn-primary text-sm mt-3"
              >
                {ordering === 'ficha_reducida' && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
                {fichaOrder?.status === 'pendiente_pago' ? 'Continuar el pago' : 'Encargar y pagar'}
                {money(ficha?.amount_cents ?? null) && ` · ${money(ficha!.amount_cents)}`}
              </Button>
            )}
            </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
