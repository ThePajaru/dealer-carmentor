'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Car, Check, ShoppingBag, Truck, MapPin, PackageCheck, ShieldCheck } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Tracking {
  dealer: string | null;
  dealerLogo: string | null;
  clientName: string | null;
  car: { title: string; hero: string | null };
  stage: string;
  deliveryEta: string | null;
  progress: Record<string, string>;
  inspection: { date: string | null; pointsChecked: number; photos: { label: string; url: string }[] } | null;
}

const STEPS = [
  { key: 'comprado', label: 'Comprado en Alemania', icon: ShoppingBag },
  { key: 'en_transporte', label: 'En transporte', icon: Truck },
  { key: 'en_espana', label: 'En España', icon: MapPin },
  { key: 'entregado', label: 'Entregado', icon: PackageCheck },
];

function fmtDate(iso?: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
}

export default function TrackingPage() {
  const { token } = useParams<{ token: string }>();
  const [t, setT] = useState<Tracking | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/dealer/tracking/${token}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => setT(d.tracking))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div className="dealer-root min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 text-d-accent animate-spin" /></div>;
  if (!t) return <div className="dealer-root min-h-screen flex items-center justify-center text-d-dim">Seguimiento no encontrado</div>;

  const doneOf = (key: string) => (key === 'entregado' ? t.stage === 'entregado' : !!t.progress[key]);
  const lastDoneIdx = STEPS.reduce((acc, s, i) => (doneOf(s.key) ? i : acc), -1);

  return (
    <div className="dealer-root dealer-root--scroll min-h-screen">
      <header className="border-b border-d-border">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          {t.dealerLogo ? <img src={t.dealerLogo} alt="" className="w-9 h-9 rounded-lg object-cover" /> : <span className="w-9 h-9 rounded-lg bg-d-surface-2 grid place-items-center text-d-accent"><Car className="w-4 h-4" /></span>}
          <div>
            <p className="text-d-dim text-xs">{t.dealer || 'Tu concesionario'}</p>
            <h1 className="text-d-text font-bold leading-tight">Seguimiento de tu coche</h1>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-5">
        <div className="d-card d-card-hl overflow-hidden">
          {t.car.hero ? <img src={t.car.hero} alt="" className="w-full h-48 object-cover" /> : <div className="w-full h-48 bg-d-surface-2 grid place-items-center"><Car className="w-8 h-8 text-d-dim" /></div>}
          <div className="p-4">
            {t.clientName && <p className="text-d-dim text-xs">Hola {t.clientName.split(' ')[0]},</p>}
            <h2 className="text-d-text font-bold text-base mt-0.5">{t.car.title}</h2>
            {t.deliveryEta && t.stage !== 'entregado' && (
              <p className="text-d-accent text-sm mt-2">Entrega estimada: <span className="d-num font-semibold">{fmtDate(t.deliveryEta)}</span></p>
            )}
          </div>
        </div>

        <div className="d-card p-5">
          <h3 className="d-cap mb-4">Estado</h3>
          <ol className="relative">
            {STEPS.map((s, i) => {
              const done = doneOf(s.key);
              const current = i === lastDoneIdx;
              const Icon = s.icon;
              const date = fmtDate(t.progress[s.key]) || (s.key === 'entregado' && t.stage === 'entregado' ? 'Completado' : null);
              return (
                <li key={s.key} className="flex gap-3 pb-6 last:pb-0 relative">
                  {i < STEPS.length - 1 && <span className={`absolute left-[15px] top-8 bottom-0 w-px ${done ? 'bg-d-green/40' : 'bg-d-border'}`} />}
                  <span className={`w-8 h-8 rounded-full grid place-items-center shrink-0 z-10 ${done ? 'bg-d-green/15 text-d-green' : current ? 'bg-d-accent/15 text-d-accent' : 'bg-d-surface-2 text-d-dim'}`}>
                    {done ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                  </span>
                  <div className="pt-1">
                    <p className={`text-sm font-medium ${done ? 'text-d-text' : 'text-d-dim'}`}>{s.label}</p>
                    {date && <p className="text-d-dim text-xs mt-0.5">{date}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Proof of inspection — buyer lens: it happened + real photos, no economics */}
        {t.inspection && (
          <div className="d-card p-5">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-8 h-8 rounded-full bg-d-green/15 text-d-green grid place-items-center shrink-0"><ShieldCheck className="w-4 h-4" /></span>
              <h3 className="text-d-text font-semibold text-sm">Inspeccionado en persona</h3>
            </div>
            <p className="text-d-dim text-xs mb-4">
              Revisamos tu coche en Alemania antes de comprarlo
              {t.inspection.pointsChecked > 0 && <> · <span className="d-num text-d-text">{t.inspection.pointsChecked}</span> puntos comprobados</>}
              {fmtDate(t.inspection.date) && <> · {fmtDate(t.inspection.date)}</>}.
            </p>
            {t.inspection.photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {t.inspection.photos.map((p, i) => (
                  <figure key={i} className="relative aspect-square rounded-lg overflow-hidden border border-d-border">
                    <img src={p.url} alt={p.label} className="w-full h-full object-cover" />
                    {p.label && <figcaption className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[10px] px-1 py-0.5 truncate">{p.label}</figcaption>}
                  </figure>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="text-center text-d-dim text-xs">Seguimiento en tiempo real · CarMentor</p>
      </main>
    </div>
  );
}
