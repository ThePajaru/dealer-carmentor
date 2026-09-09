'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Loader2, FileText, ChevronRight } from 'lucide-react';
import Link from 'next/link';

interface PresupuestoRow {
  id: string;
  selling_price: number | null;
  margin: number | null;
  margin_pct: number | null;
  status: string;
  created_at: string;
  dealer_leads?: { client_name: string | null } | null;
  car_analyses?: { title: string | null; car_image_url: string | null } | null;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  borrador: { label: 'Borrador', cls: 'd-tag-muted' },
  enviado: { label: 'Enviado', cls: 'd-tag-purple' },
  aceptado: { label: 'Aceptado', cls: 'd-tag-good' },
  rechazado: { label: 'Rechazado', cls: 'd-tag-muted' },
};

const TABS = [
  { value: 'all', label: 'Todos' },
  { value: 'borrador', label: 'Borradores' },
  { value: 'aceptado', label: 'Aceptados' },
  { value: 'rechazado', label: 'Rechazados' },
];

function fmt(n: number | null) { return Math.round(n ?? 0).toLocaleString('es-ES'); }

export default function PresupuestosListPage() {
  const { session } = useAuth();
  const [rows, setRows] = useState<PresupuestoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');

  useEffect(() => {
    if (!session?.access_token) return;
    fetch('/api/dealer/presupuesto', { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.json())
      .then(data => setRows(data.presupuestos || []))
      .finally(() => setLoading(false));
  }, [session?.access_token]);

  const filtered = tab === 'all' ? rows : rows.filter(r => r.status === tab);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-[24px] font-semibold text-d-text tracking-tight">Presupuestos</h1>
        <p className="text-d-muted text-sm mt-1">Cada propuesta que has generado para tus clientes.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              tab === t.value
                ? 'bg-d-accent/10 text-d-accent border-d-accent/30'
                : 'text-d-dim border-d-border hover:border-d-border-strong hover:text-d-text-2'
            }`}
          >
            {t.label}
            {t.value !== 'all' && (
              <span className="ml-1 text-xs opacity-60 d-num">{rows.filter(r => r.status === t.value).length}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-d-accent animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="d-card-dashed py-12 text-center">
          <FileText className="w-10 h-10 text-d-dim mx-auto mb-3" />
          <p className="text-d-muted text-sm">
            {tab === 'all' ? 'Aún no tienes presupuestos' : 'No hay presupuestos en este estado'}
          </p>
          <p className="text-d-dim text-xs mt-1">Crea uno desde la ficha de un cliente.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-d-border bg-d-surface overflow-hidden divide-y divide-d-border">
          {filtered.map(p => {
            const st = STATUS_META[p.status] || STATUS_META.borrador;
            return (
              <Link key={p.id} href={`/dealer/presupuesto/nuevo?presupuesto=${p.id}`} className="flex items-center gap-4 py-4 px-5 hover:bg-d-surface-2 transition-colors group">
                {p.car_analyses?.car_image_url ? (
                  <img src={p.car_analyses.car_image_url} alt="" className="w-20 h-14 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-20 h-14 rounded-lg bg-d-surface-2 grid place-items-center shrink-0"><FileText className="w-5 h-5 text-d-dim" /></div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-d-text font-semibold truncate">{p.car_analyses?.title || 'Presupuesto'}</span>
                    <span className={`d-tag ${st.cls} shrink-0`}>{st.label}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-d-muted flex-wrap">
                    {p.dealer_leads?.client_name && <span>{p.dealer_leads.client_name}</span>}
                    <span className="text-d-text font-semibold d-num">€{fmt(p.selling_price)}</span>
                    {p.margin != null && (
                      <span className={`d-num ${p.margin >= 0 ? 'text-d-green' : 'text-d-red'}`}>
                        {p.margin >= 0 ? '+' : ''}€{fmt(p.margin)}{p.margin_pct != null ? ` · ${p.margin_pct.toFixed(1)}%` : ''}
                      </span>
                    )}
                    <span className="text-d-dim d-num">{new Date(p.created_at).toLocaleDateString('es-ES')}</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-d-dim group-hover:text-d-muted shrink-0" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
