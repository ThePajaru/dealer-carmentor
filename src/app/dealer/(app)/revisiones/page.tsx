'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';
import { Car, ChevronRight, ChevronDown, ClipboardCheck, AlertTriangle, ShieldCheck } from 'lucide-react';
import RunnerReportReview, { type RunnerReport } from '@/components/dealer/RunnerReportReview';
import { OperacionesSkeleton } from '@/components/dealer/DealerSkeletons';

interface Revision {
  id: string;
  client_name: string;
  stage: string;
  updated_at: string;
  car: { title: string | null; image: string | null; source_url: string | null } | null;
  report: RunnerReport;
}

function agoText(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return 'hoy';
  if (d === 1) return 'ayer';
  if (d < 30) return `hace ${d}d`;
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export default function RevisionesPage() {
  const { session } = useAuth();
  const token = session?.access_token;
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['dealer', 'revisiones'],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch('/api/dealer/revisiones', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error('Error al cargar revisiones');
      return r.json();
    },
  });

  const reports: Revision[] = data?.reports || [];
  const loading = isPending && !!token;

  return (
    <div className="max-w-4xl mx-auto">
      <div>
        <h1 className="text-[24px] font-semibold text-d-text tracking-tight">Revisiones</h1>
        <p className="text-d-muted text-sm mt-1">Todas las inspecciones que el runner ha enviado en persona, en un solo sitio.</p>
      </div>

      {loading ? (
        <OperacionesSkeleton />
      ) : reports.length === 0 ? (
        <div className="d-card-dashed py-16 text-center mt-8">
          <ClipboardCheck className="w-10 h-10 text-d-dim mx-auto mb-3" />
          <p className="text-d-text-2 text-sm font-medium">Aún no hay revisiones</p>
          <p className="text-d-dim text-xs mt-1">Cuando un runner envíe la inspección de un coche desde el terreno, aparecerá aquí.</p>
        </div>
      ) : (
        <div className="mt-8 rounded-xl border border-d-border bg-d-surface overflow-hidden divide-y divide-d-border">
          {reports.map(rev => {
            const r = rev.report;
            const issues = r.items.filter(i => i.status === 'issue').length;
            const dbPresent = r.dealbreakers.filter(d => d.status === 'present').length;
            const buy = r.verdict === 'comprar';
            const open = openId === rev.id;
            return (
              <div key={rev.id}>
                <button
                  onClick={() => setOpenId(open ? null : rev.id)}
                  className="w-full flex items-center gap-3.5 px-3.5 py-3 text-left hover:bg-d-surface-2 transition-colors group"
                >
                  {rev.car?.image ? (
                    <img src={rev.car.image} alt="" className="w-16 h-12 rounded-lg object-cover shrink-0 ring-1 ring-white/[.06]" />
                  ) : (
                    <div className="w-16 h-12 rounded-lg bg-d-surface-2 grid place-items-center shrink-0 ring-1 ring-white/[.06]"><Car className="w-4 h-4 text-d-dim" /></div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="text-d-text font-semibold text-sm truncate leading-tight">{rev.client_name}</p>
                    <p className="text-d-muted text-xs truncate mt-0.5">{rev.car?.title || 'Vehículo'}</p>
                    <div className="flex items-center gap-1.5 mt-1 text-[11px] text-d-dim flex-wrap">
                      {dbPresent > 0 && (
                        <span className="inline-flex items-center gap-1 text-d-red font-medium"><ShieldCheck className="w-3 h-3" /> {dbPresent} dealbreaker{dbPresent > 1 ? 's' : ''}</span>
                      )}
                      {issues > 0 && (
                        <span className="inline-flex items-center gap-1 text-d-amber"><AlertTriangle className="w-3 h-3" /> {issues} observ.</span>
                      )}
                      <span>{agoText(r.submitted_at || rev.updated_at)}</span>
                    </div>
                  </div>

                  {r.verdict && (
                    <span className={`text-[11px] font-semibold px-2 py-1 rounded-md shrink-0 ${buy ? 'bg-d-green/15 text-d-green' : 'bg-d-red/15 text-d-red'}`}>
                      {buy ? 'Comprar' : 'No comprar'}
                    </span>
                  )}
                  <ChevronDown className={`w-4 h-4 text-d-dim shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>

                {open && (
                  <div className="px-3.5 pb-4">
                    <RunnerReportReview report={r} />
                    <Link href={`/dealer/clientes/${rev.id}`} className="inline-flex items-center gap-1 text-d-accent text-xs font-medium hover:underline mt-3">
                      Ver operación completa <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
