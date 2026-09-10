'use client';

// La cola de trabajo del colaborador: todos los trámites pagados, de todos los
// dealers, con lo que hace falta para resolverlos y devolver el papel.
//
// Mismo lenguaje visual que la app del dealer (d-card, d-tag, d-btn-*): es la
// misma casa vista desde dentro. Sin sidebar ni paywall — aquí no hay perfil de
// dealer, solo un correo de la lista blanca (ADMIN_EMAILS).

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import {
  Stamp, FileSignature, Loader2, Check, Clock, X, Upload, Trash2, ExternalLink,
  Lock, LogOut, ChevronDown, Car, RefreshCw, Ban,
} from 'lucide-react';
import { SERVICE_STATUS_LABELS, type ServiceKey, type ServiceStatus } from '@/lib/dealer/services';

interface ResultFile { label: string; path: string; url: string | null }

interface AdminOrder {
  id: string;
  kind: ServiceKey;
  status: ServiceStatus;
  request_id: string;
  dealer_id: string;
  amount_cents: number | null;
  paid_at: string | null;
  created_at: string;
  payload: Record<string, unknown>;
  result: { nota?: string; files?: ResultFile[] };
  dealer_profiles: { business_name: string | null; email: string | null; phone: string | null } | null;
  dealer_client_requests: { client_name: string | null; client_phone: string | null; stage: string | null } | null;
}

const KIND_ICON: Record<ServiceKey, typeof Stamp> = {
  impuestos: Stamp,
  ficha_reducida: FileSignature,
};
const KIND_LABEL: Record<ServiceKey, string> = {
  impuestos: 'Impuestos de matriculación',
  ficha_reducida: 'Ficha técnica reducida',
};
const KIND_WHO: Record<ServiceKey, string> = {
  impuestos: 'Gestor',
  ficha_reducida: 'Ingeniero',
};

const TABS: { key: string; label: string }[] = [
  { key: 'pagado', label: 'Nuevos' },
  { key: 'en_tramite', label: 'En trámite' },
  { key: 'completado', label: 'Completados' },
  { key: '', label: 'Todos' },
];

const tagClass = (s: ServiceStatus) =>
  s === 'completado' ? 'd-tag d-tag-good'
    : s === 'en_tramite' ? 'd-tag d-tag-info'
      : s === 'pagado' ? 'd-tag d-tag-warn'
        : 'd-tag d-tag-muted';

const eur = (n: number) => Math.round(n).toLocaleString('es-ES');
const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('No se pudo leer el fichero'));
    reader.readAsDataURL(file);
  });
}

/* ══════════ Detalle del encargo ══════════ */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-[13px] border-b border-d-border/60 last:border-b-0">
      <span className="text-d-dim w-[150px] shrink-0">{label}</span>
      <span className="text-d-text-2 min-w-0">{children}</span>
    </div>
  );
}

/** Lo que el dealer aportó al encargar — distinto en cada servicio. */
function Payload({ order }: { order: AdminOrder }) {
  const p = order.payload || {};
  if (order.kind === 'impuestos') {
    const v = p as {
      region_label?: string; municipio?: string; provincia?: string; cvf?: number;
      valoracion?: number; co2?: number; primera_matriculacion?: string;
      iedmt_estimado?: number; coche?: string;
    };
    return (
      <div>
        {v.coche && <Row label="Coche">{v.coche}</Row>}
        <Row label="Comunidad (576)">{v.region_label || '—'}</Row>
        <Row label="Municipio (IVTM)">
          {v.municipio || '—'}{v.provincia ? ` · ${v.provincia}` : ''}
        </Row>
        <Row label="Potencia fiscal">{v.cvf != null ? <span className="d-num">{v.cvf} CVF</span> : '—'}</Row>
        <Row label="Valoración">{v.valoracion != null ? <span className="d-num">{eur(v.valoracion)}€</span> : '—'}</Row>
        <Row label="CO2">{v.co2 != null ? <span className="d-num">{v.co2} g/km</span> : 'sin acreditar'}</Row>
        <Row label="1ª matriculación">{v.primera_matriculacion || '—'}</Row>
        <Row label="576 estimado">
          {v.iedmt_estimado != null
            ? <span className="d-num text-d-text">{eur(v.iedmt_estimado)}€</span>
            : '—'}
          <span className="text-d-dim"> · lo fija Hacienda con su valoración</span>
        </Row>
      </div>
    );
  }

  const v = p as { photos?: { key: string; label: string; url: string }[]; faltan?: string[]; coche?: string };
  const photos = v.photos || [];
  const faltan = v.faltan || [];
  return (
    <div>
      {v.coche && <Row label="Coche">{v.coche}</Row>}
      <Row label="Fotos del expediente">
        <span className="d-num">{photos.length}</span>
        {faltan.length > 0 && <span className="text-d-amber"> · faltan {faltan.join(', ')}</span>}
      </Row>
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-3">
          {photos.map(ph => (
            <a key={ph.key} href={ph.url} target="_blank" rel="noopener"
              className="w-[104px] rounded-lg overflow-hidden border border-d-border hover:border-d-border-strong transition-colors">
              <img src={ph.url} alt={ph.label} className="w-full h-[74px] object-cover" />
              <span className="block px-1.5 py-1 text-[10px] text-d-dim truncate">{ph.label}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function OrderCard({ order, token, onChanged }: {
  order: AdminOrder;
  token: string;
  onChanged: (o: AdminOrder) => void;
}) {
  const [open, setOpen] = useState(order.status === 'pagado');
  const [nota, setNota] = useState(order.result?.nota || '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const Icon = KIND_ICON[order.kind];
  const files = order.result?.files || [];
  const notaDirty = nota !== (order.result?.nota || '');

  const patch = useCallback(async (body: Record<string, unknown>, tag: string) => {
    setBusy(tag);
    setError(null);
    try {
      const res = await fetch(`/api/admin/services/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar');
      onChanged(data.order);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setBusy(null);
    }
  }, [order.id, token, onChanged]);

  const subirFichero = async (file: File) => {
    setBusy('upload');
    try {
      const dataUrl = await fileToDataUrl(file);
      await patch({ add_file: { dataUrl, label: file.name }, nota }, 'upload');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo subir');
      setBusy(null);
    }
  };

  return (
    <div className="d-card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-d-surface-2/40 transition-colors"
      >
        <span className={`d-ic w-9 h-9 shrink-0 ${order.kind === 'ficha_reducida' ? 'd-ic-purple' : ''}`}>
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-semibold text-d-text">{KIND_LABEL[order.kind]}</span>
            <span className="d-pill">{KIND_WHO[order.kind]}</span>
          </div>
          <p className="text-[13px] text-d-dim mt-1 truncate">
            {order.dealer_profiles?.business_name || 'Dealer'}
            {order.dealer_client_requests?.client_name && ` · cliente ${order.dealer_client_requests.client_name}`}
            {' · pagado '}<span className="d-num">{fecha(order.paid_at)}</span>
            {order.amount_cents != null && <> · <span className="d-num">{eur(order.amount_cents / 100)}€</span></>}
          </p>
        </div>
        <span className={`${tagClass(order.status)} shrink-0`}>{SERVICE_STATUS_LABELS[order.status]}</span>
        <ChevronDown className={`w-4 h-4 text-d-dim shrink-0 mt-1 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-d-border pt-4">
          <Payload order={order} />

          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Link
              href={`/dealer/clientes/${order.request_id}`}
              target="_blank"
              className="d-btn-ghost px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 text-xs"
            >
              <Car className="w-3.5 h-3.5" /> Ver la operación
            </Link>
            {order.dealer_profiles?.email && (
              <a href={`mailto:${order.dealer_profiles.email}`} className="d-link text-xs">
                {order.dealer_profiles.email}
              </a>
            )}
            {order.dealer_profiles?.phone && (
              <a href={`tel:${order.dealer_profiles.phone}`} className="d-link text-xs d-num">
                {order.dealer_profiles.phone}
              </a>
            )}
          </div>

          {/* Documentos que devuelve el colaborador */}
          <div className="rounded-xl border border-d-border p-3.5">
            <p className="text-[11px] uppercase tracking-wide text-d-dim mb-2">
              {order.kind === 'impuestos' ? 'Justificantes de pago' : 'Ficha firmada'}
            </p>
            {files.length > 0 ? (
              <div className="space-y-1.5 mb-2.5">
                {files.map(f => (
                  <div key={f.path} className="flex items-center gap-2">
                    {f.url ? (
                      <a href={f.url} target="_blank" rel="noopener"
                        className="d-link text-[13px] inline-flex items-center gap-1.5 min-w-0">
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{f.label}</span>
                      </a>
                    ) : (
                      <span className="text-d-dim text-[13px] truncate">{f.label}</span>
                    )}
                    <button
                      onClick={() => patch({ remove_path: f.path, nota }, `rm-${f.path}`)}
                      disabled={busy !== null}
                      className="text-d-dim hover:text-d-red p-1 ml-auto shrink-0 disabled:opacity-50"
                      aria-label="Borrar documento"
                    >
                      {busy === `rm-${f.path}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-d-dim text-[13px] mb-2.5">Todavía no has subido nada.</p>
            )}

            <label className="d-btn-ghost text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 cursor-pointer">
              {busy === 'upload' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Subir PDF o foto
              <input
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                disabled={busy !== null}
                onChange={async e => {
                  const f = e.target.files?.[0];
                  if (f) await subirFichero(f);
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          {/* Nota para el dealer */}
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-d-dim mb-1.5">
              Nota para el dealer <span className="normal-case tracking-normal">(va en el correo al completar)</span>
            </label>
            <textarea
              value={nota}
              onChange={e => setNota(e.target.value)}
              rows={2}
              placeholder="p. ej. 576 presentado el 12/09, IVTM domiciliado en el ayuntamiento."
              className="d-input w-full px-3 py-2 text-sm resize-y"
            />
            {notaDirty && (
              <Button onClick={() => patch({ nota }, 'nota')} disabled={busy !== null} className="d-btn-ghost text-xs mt-2">
                {busy === 'nota' && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />} Guardar nota
              </Button>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-d-red/25 bg-d-red/5 px-3 py-2 text-[13px] text-d-red">{error}</div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {order.status !== 'en_tramite' && order.status !== 'completado' && (
              <Button onClick={() => patch({ status: 'en_tramite', nota }, 'en_tramite')} disabled={busy !== null} className="d-btn-ghost text-sm">
                {busy === 'en_tramite' ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Clock className="w-4 h-4 mr-1.5" />}
                Marcar en trámite
              </Button>
            )}
            {order.status !== 'completado' && (
              <Button onClick={() => patch({ status: 'completado', nota }, 'completado')} disabled={busy !== null} className="d-btn-green text-sm">
                {busy === 'completado' ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Check className="w-4 h-4 mr-1.5" />}
                Completar y avisar al dealer
              </Button>
            )}
            {order.status !== 'cancelado' && (
              <Button onClick={() => patch({ status: 'cancelado', nota }, 'cancelado')} disabled={busy !== null} className="d-btn-ghost text-sm ml-auto">
                {busy === 'cancelado' ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Ban className="w-4 h-4 mr-1.5" />}
                Cancelar
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════ Página ══════════ */

export default function AdminTramitesPage() {
  const { user, session, loading: authLoading, signOut } = useAuth();
  const router = useRouter();
  const token = session?.access_token;

  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<string>('pagado');
  const [kind, setKind] = useState<'' | ServiceKey>('');
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login?redirect=/admin/tramites');
  }, [authLoading, user, router]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (tab) params.set('status', tab);
      if (kind) params.set('kind', kind);
      const res = await fetch(`/api/admin/services?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) { setDenied(true); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al cargar');
      setOrders(data.orders || []);
      setCounts(data.counts || {});
      setDenied(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [token, tab, kind]);

  useEffect(() => { void load(); }, [load]);

  const onChanged = useCallback((updated: AdminOrder) => {
    setOrders(prev => prev.map(o => (o.id === updated.id ? { ...o, ...updated } : o)));
    // Los contadores y la pestaña dejan de cuadrar en cuanto cambia un estado.
    void load();
  }, [load]);

  const pendientes = useMemo(() => counts.pagado || 0, [counts]);

  if (authLoading || (loading && orders.length === 0 && !denied && !error)) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="w-8 h-8 text-d-accent animate-spin" />
      </div>
    );
  }

  if (denied) {
    return (
      <div className="min-h-screen grid place-items-center px-4">
        <div className="d-card max-w-md w-full p-8 text-center">
          <span className="d-ic d-ic-muted w-11 h-11 mx-auto"><Lock className="w-5 h-5" /></span>
          <h1 className="text-d-text text-lg font-semibold mt-4">Panel de colaborador</h1>
          <p className="text-d-dim text-sm mt-2">
            La cuenta <span className="text-d-text-2">{user?.email}</span> no está en la lista de
            colaboradores. Si deberías estarlo, pide que añadan tu correo a <code>ADMIN_EMAILS</code>.
          </p>
          <Button onClick={() => signOut()} className="d-btn-ghost text-sm mt-5">
            <LogOut className="w-4 h-4 mr-1.5" /> Cambiar de cuenta
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 md:px-10 py-8 w-full mx-auto max-w-5xl">
      {/* Cabecera — mismo gesto que la sidebar del dealer: marca + chapa de rol */}
      <div className="flex items-center gap-3 flex-wrap mb-6">
        <span className="d-ic w-9 h-9 shrink-0"><Stamp className="w-4 h-4" /></span>
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold text-d-text leading-tight flex items-center gap-2">
            Trámites
            <span className="d-pill">Colaborador</span>
          </h1>
          <p className="text-d-dim text-[13px] mt-0.5">
            {pendientes > 0
              ? <>Tienes <span className="text-d-amber font-medium d-num">{pendientes}</span> encargo{pendientes === 1 ? '' : 's'} sin empezar.</>
              : 'Nada sin empezar. Todo al día.'}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => load()} className="d-btn-ghost px-2.5 py-1.5 rounded-lg text-xs inline-flex items-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar
          </button>
          <button onClick={() => signOut()} className="text-d-dim hover:text-d-text p-2" aria-label="Salir">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {TABS.map(t => (
          <button
            key={t.key || 'todos'}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-[13px] transition-colors ${
              tab === t.key ? 'bg-d-surface-2 text-d-text' : 'text-d-dim hover:text-d-text-2'
            }`}
          >
            {t.label}
            {t.key && counts[t.key] != null && <span className="d-num text-d-dim ml-1.5">{counts[t.key]}</span>}
          </button>
        ))}
        <span className="w-px h-5 bg-d-border mx-1" />
        {([['', 'Los dos'], ['impuestos', 'Impuestos'], ['ficha_reducida', 'Ficha']] as const).map(([k, label]) => (
          <button
            key={k || 'all'}
            onClick={() => setKind(k as '' | ServiceKey)}
            className={`px-3 py-1.5 rounded-lg text-[13px] transition-colors ${
              kind === k ? 'bg-d-surface-2 text-d-text' : 'text-d-dim hover:text-d-text-2'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-d-red/25 bg-d-red/5 px-3 py-2 text-[13px] text-d-red mb-4 flex items-center gap-2">
          <X className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {orders.length === 0 && !loading ? (
        <div className="d-card-dashed p-10 text-center">
          <p className="text-d-dim text-sm">No hay encargos aquí.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map(o => (
            <OrderCard key={o.id} order={o} token={token!} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}
