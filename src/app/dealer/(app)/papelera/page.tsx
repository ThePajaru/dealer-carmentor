'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Car, Trash2, RotateCcw, Loader2 } from 'lucide-react';
import { OperacionesSkeleton } from '@/components/dealer/DealerSkeletons';

interface TrashItem {
  id: string;
  client_name: string;
  stage: string;
  deleted_at: string;
  car: { title: string | null; image: string | null };
}

function agoText(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return 'hoy';
  if (d === 1) return 'ayer';
  if (d < 30) return `hace ${d}d`;
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export default function PapeleraPage() {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<Record<string, 'restore' | 'delete'>>({});

  const { data, isPending, refetch } = useQuery({
    queryKey: ['dealer', 'papelera'],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch('/api/dealer/papelera', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error('Error al cargar la papelera');
      return r.json();
    },
  });

  const items: TrashItem[] = data?.items || [];
  const loading = isPending && !!token;

  const restore = async (id: string) => {
    if (!token) return;
    setBusy(b => ({ ...b, [id]: 'restore' }));
    try {
      const r = await fetch(`/api/dealer/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ restore: true }),
      });
      if (r.ok) {
        await refetch();
        // The restored operación reappears in Operaciones — refresh that list too.
        queryClient.invalidateQueries({ queryKey: ['dealer', 'operaciones'] });
      }
    } finally {
      setBusy(b => { const n = { ...b }; delete n[id]; return n; });
    }
  };

  const deleteForever = async (id: string, name: string) => {
    if (!token) return;
    if (!window.confirm(`¿Eliminar definitivamente la operación de ${name}? Se borran también sus candidatos y presupuestos. No se puede deshacer.`)) return;
    setBusy(b => ({ ...b, [id]: 'delete' }));
    try {
      const r = await fetch(`/api/dealer/clients/${id}?permanent=1`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) await refetch();
    } finally {
      setBusy(b => { const n = { ...b }; delete n[id]; return n; });
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div>
        <h1 className="text-[24px] font-semibold text-d-text tracking-tight">Papelera</h1>
        <p className="text-d-muted text-sm mt-1">Operaciones que has eliminado. Restáuralas o bórralas para siempre.</p>
      </div>

      {loading ? (
        <OperacionesSkeleton />
      ) : items.length === 0 ? (
        <div className="d-card-dashed py-16 text-center mt-8">
          <Trash2 className="w-10 h-10 text-d-dim mx-auto mb-3" />
          <p className="text-d-text-2 text-sm font-medium">La papelera está vacía</p>
          <p className="text-d-dim text-xs mt-1">Cuando elimines una operación, aparecerá aquí y podrás recuperarla.</p>
        </div>
      ) : (
        <div className="mt-8 rounded-xl border border-d-border bg-d-surface overflow-hidden divide-y divide-d-border">
          {items.map(it => {
            const st = busy[it.id];
            return (
              <div key={it.id} className="flex items-center gap-3.5 px-3.5 py-3">
                {it.car.image ? (
                  <img src={it.car.image} alt="" className="w-16 h-12 rounded-lg object-cover shrink-0 ring-1 ring-white/[.06] opacity-70" />
                ) : (
                  <div className="w-16 h-12 rounded-lg bg-d-surface-2 grid place-items-center shrink-0 ring-1 ring-white/[.06]"><Car className="w-4 h-4 text-d-dim" /></div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-d-text font-semibold text-sm truncate leading-tight">{it.client_name}</p>
                  <p className="text-d-muted text-xs truncate mt-0.5">{it.car.title || 'Sin coche'}</p>
                  <p className="text-d-dim text-[11px] mt-0.5">Eliminada {agoText(it.deleted_at)}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => restore(it.id)}
                    disabled={!!st}
                    className="d-btn-ghost text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {st === 'restore' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Restaurar
                  </button>
                  <button
                    onClick={() => deleteForever(it.id, it.client_name)}
                    disabled={!!st}
                    className="text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 text-d-red/90 hover:bg-d-red/10 hover:text-d-red transition-colors disabled:opacity-50"
                  >
                    {st === 'delete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Eliminar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
