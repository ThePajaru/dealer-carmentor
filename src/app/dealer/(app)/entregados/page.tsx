'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Car, PackageCheck, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { OperacionesSkeleton } from '@/components/dealer/DealerSkeletons';

interface Job {
  id: string;
  client_name: string;
  stage: string;
  updated_at: string;
  car: { title: string | null; image: string | null } | null;
  price: number | null;
  margin: number | null;
  margin_is_real?: boolean;
}

function fmt(n: number | null) { return Math.round(n ?? 0).toLocaleString('es-ES'); }
function deliveredText(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}
// Group key "agosto 2026" for month section headers.
function monthKey(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
}

export default function EntregadosPage() {
  const { session } = useAuth();
  const token = session?.access_token;

  // Reuses the Operaciones query (same queryKey) so navigating here renders
  // instantly from cache — delivered cars are just the closed 'entregado' slice.
  const { data, isPending } = useQuery({
    queryKey: ['dealer', 'operaciones'],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch('/api/dealer/operaciones', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error('Error al cargar operaciones');
      return r.json();
    },
  });

  const jobs: Job[] = data?.jobs || [];
  const loading = isPending && !!token;

  const entregados = jobs
    .filter(j => j.stage === 'entregado')
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  const totalMargen = entregados.reduce((s, j) => s + (j.margin || 0), 0);

  // Group by delivery month for skimmable history.
  const groups: { key: string; items: Job[] }[] = [];
  for (const j of entregados) {
    const k = monthKey(j.updated_at);
    const g = groups.find(x => x.key === k);
    if (g) g.items.push(j);
    else groups.push({ key: k, items: [j] });
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-semibold text-d-text tracking-tight">Entregados</h1>
          <p className="text-d-muted text-sm mt-1">Todos los coches que has entregado. El historial no se borra.</p>
        </div>
        {entregados.length > 0 && (
          <div className="text-right shrink-0 mt-0.5">
            <p className="text-d-dim text-xs">Margen total</p>
            <p className={`text-[20px] font-semibold leading-tight tabular-nums ${totalMargen >= 0 ? 'text-d-green' : 'text-d-red'}`}>
              {totalMargen >= 0 ? '+' : ''}€{fmt(totalMargen)}
            </p>
          </div>
        )}
      </div>

      {loading ? (
        <OperacionesSkeleton />
      ) : entregados.length === 0 ? (
        <div className="d-card-dashed py-16 text-center mt-8">
          <PackageCheck className="w-10 h-10 text-d-dim mx-auto mb-3" />
          <p className="text-d-text-2 text-sm font-medium">Aún no has entregado ningún coche</p>
          <p className="text-d-dim text-xs mt-1">Cuando marques una operación como entregada, quedará aquí para siempre.</p>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {groups.map(g => (
            <section key={g.key}>
              <div className="flex items-center gap-2.5 mb-3">
                <h2 className="text-d-text font-medium text-sm shrink-0 capitalize">{g.key}</h2>
                <span className="d-num text-d-dim text-xs shrink-0">{g.items.length}</span>
                <span className="flex-1 h-px bg-d-border/70" />
              </div>
              <div className="rounded-xl border border-d-border bg-d-surface overflow-hidden divide-y divide-d-border">
                {g.items.map(j => <EntregadoRow key={j.id} j={j} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function EntregadoRow({ j }: { j: Job }) {
  return (
    <Link href={`/dealer/clientes/${j.id}`} className="flex items-center gap-3.5 px-3.5 py-3 hover:bg-d-surface-2 transition-colors group">
      {j.car?.image ? (
        <img src={j.car.image} alt="" className="w-16 h-12 rounded-lg object-cover shrink-0 ring-1 ring-white/[.06]" />
      ) : (
        <div className="w-16 h-12 rounded-lg bg-d-surface-2 grid place-items-center shrink-0 ring-1 ring-white/[.06]"><Car className="w-4 h-4 text-d-dim" /></div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-d-text font-semibold text-sm truncate leading-tight">{j.client_name}</p>
        <p className="text-d-muted text-xs truncate mt-0.5">{j.car?.title || 'Sin coche'}</p>
        <p className="text-d-dim text-[11px] mt-0.5">Entregado {deliveredText(j.updated_at)}</p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {j.price != null && (
          <div className="text-right">
            <p className="text-d-text font-semibold text-sm d-num leading-tight">€{fmt(j.price)}</p>
            {j.margin != null && (
              <p className={`text-[11px] d-num ${j.margin >= 0 ? 'text-d-green' : 'text-d-red'}`}>
                {j.margin >= 0 ? '+' : ''}€{fmt(j.margin)} margen {j.margin_is_real ? 'real' : 'est.'}
              </p>
            )}
          </div>
        )}
        <ChevronRight className="w-4 h-4 text-d-dim group-hover:text-d-muted" />
      </div>
    </Link>
  );
}
