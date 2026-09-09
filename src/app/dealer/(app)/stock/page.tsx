'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { Car, Warehouse, Search, Loader2, Trash2, ChevronRight, X } from 'lucide-react';
import Link from 'next/link';
import { OperacionesSkeleton } from '@/components/dealer/DealerSkeletons';

type StockStatus = 'buscando' | 'comprado' | 'en_venta' | 'vendido';

interface StockItem {
  id: string;
  title: string;
  image: string | null;
  stock_status: StockStatus;
  leads_count: number;
  mobile_url: string | null;
  actual_purchase: number | null;
  listing_price: number | null;
  sold_price: number | null;
  sold_at: string | null;
  cost: number | null;
  sale_price: number | null;
  margin: number | null;
  margin_is_real: boolean;
  created_at: string;
  updated_at: string;
}
interface Kpis {
  en_stock: number; buscando: number; vendidos: number;
  capital: number; margen_realizado: number; margen_potencial: number;
}

const STATUS: Record<StockStatus, { label: string; dot: string; cls: string }> = {
  buscando: { label: 'Buscando', dot: 'var(--color-d-amber)', cls: 'text-d-amber' },
  comprado: { label: 'Comprado', dot: 'var(--color-d-accent)', cls: 'text-d-accent' },
  en_venta: { label: 'En venta', dot: 'var(--color-d-green)', cls: 'text-d-green' },
  vendido: { label: 'Vendido', dot: 'var(--color-d-dim)', cls: 'text-d-dim' },
};
const GROUPS: StockStatus[] = ['buscando', 'comprado', 'en_venta', 'vendido'];

function fmt(n: number | null) { return Math.round(n ?? 0).toLocaleString('es-ES'); }

// La acción principal de cada fase y el dato que pide para avanzar.
type Advance = { to: StockStatus; label: string; field: 'actual_purchase' | 'listing_price' | 'sold_price'; prompt: string };
const NEXT: Partial<Record<StockStatus, Advance>> = {
  buscando: { to: 'comprado', label: 'Marcar comprado', field: 'actual_purchase', prompt: '¿A cuánto lo has comprado? (precio de compra)' },
  comprado: { to: 'en_venta', label: 'Poner en venta', field: 'listing_price', prompt: '¿A qué precio lo pones en venta?' },
  en_venta: { to: 'vendido', label: 'Marcar vendido', field: 'sold_price', prompt: '¿A cuánto lo has vendido? (precio final)' },
};

export default function StockPage() {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<{ item: StockItem; adv: Advance } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['dealer', 'inventory'],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch('/api/dealer/inventory', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error('Error al cargar el stock');
      return r.json();
    },
  });

  const items: StockItem[] = data?.items || [];
  const kpis: Kpis | null = data?.kpis || null;
  const loading = isPending && !!token;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['dealer', 'inventory'] });

  const patch = async (id: string, body: Record<string, unknown>) => {
    if (!token) return;
    setBusyId(id);
    try {
      const r = await fetch(`/api/dealer/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (r.ok) refresh();
    } finally {
      setBusyId(null);
    }
  };

  const removeItem = async (item: StockItem) => {
    if (!token) return;
    if (!window.confirm(`¿Mover "${item.title}" a la papelera? Podrás recuperarlo.`)) return;
    setBusyId(item.id);
    try {
      const r = await fetch(`/api/dealer/clients/${item.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) refresh();
    } finally {
      setBusyId(null);
    }
  };

  const grouped = GROUPS.map(g => ({ status: g, items: items.filter(i => i.stock_status === g) })).filter(g => g.items.length > 0);

  return (
    <div className="max-w-5xl mx-auto">
      <div>
        <h1 className="text-[24px] font-semibold text-d-text tracking-tight">Stock</h1>
        <p className="text-d-muted text-sm mt-1">Tu concesionario: coches que compras para vender, de la búsqueda a la venta.</p>
      </div>

      {loading ? (
        <OperacionesSkeleton />
      ) : items.length === 0 ? (
        <div className="d-card-dashed py-16 text-center mt-8">
          <Warehouse className="w-10 h-10 text-d-dim mx-auto mb-3" />
          <p className="text-d-text-2 text-sm font-medium">Aún no tienes coches en stock</p>
          <p className="text-d-dim text-xs mt-1">Pulsa <span className="text-d-text-2 font-medium">Nueva operación</span> y elige <span className="text-d-text-2 font-medium">«Para stock»</span> para añadir un coche a tu concesionario.</p>
        </div>
      ) : (
        <>
          {kpis && (
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Kpi label="En stock" value={String(kpis.en_stock)} />
              <Kpi label="Buscando" value={String(kpis.buscando)} />
              <Kpi label="Capital invertido" value={`€${fmt(kpis.capital)}`} />
              <Kpi label="Margen realizado" value={`€${fmt(kpis.margen_realizado)}`} accent={kpis.margen_realizado >= 0 ? 'green' : 'red'} />
            </div>
          )}

          <div className="mt-8 space-y-8">
            {grouped.map(g => (
              <section key={g.status}>
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: STATUS[g.status].dot }} />
                  <h2 className="text-d-text font-medium text-sm shrink-0">{STATUS[g.status].label}</h2>
                  <span className="d-num text-d-dim text-xs shrink-0">{g.items.length}</span>
                  <span className="flex-1 h-px bg-d-border/70" />
                </div>
                <div className="rounded-xl border border-d-border bg-d-surface overflow-hidden divide-y divide-d-border">
                  {g.items.map(it => (
                    <StockRow
                      key={it.id}
                      it={it}
                      busy={busyId === it.id}
                      onAdvance={(adv) => setDialog({ item: it, adv })}
                      onRemove={() => removeItem(it)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {dialog && (
        <PriceDialog
          title={dialog.item.title}
          prompt={dialog.adv.prompt}
          initial={dialog.adv.field === 'sold_price' ? (dialog.item.listing_price ?? null) : null}
          onCancel={() => setDialog(null)}
          onConfirm={(value) => {
            const body: Record<string, unknown> = { stock_status: dialog.adv.to, [dialog.adv.field]: value };
            patch(dialog.item.id, body);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: 'green' | 'red' }) {
  return (
    <div className="d-card px-4 py-3">
      <p className="text-d-dim text-[11px]">{label}</p>
      <p className={`text-[19px] font-semibold leading-tight tabular-nums mt-0.5 ${accent === 'green' ? 'text-d-green' : accent === 'red' ? 'text-d-red' : 'text-d-text'}`}>{value}</p>
    </div>
  );
}

function StockRow({ it, busy, onAdvance, onRemove }: {
  it: StockItem; busy: boolean; onAdvance: (adv: Advance) => void; onRemove: () => void;
}) {
  const adv = NEXT[it.stock_status];
  const st = STATUS[it.stock_status];

  return (
    <div className="flex items-center gap-3.5 px-3.5 py-3">
      {it.image ? (
        <img src={it.image} alt="" className="w-16 h-12 rounded-lg object-cover shrink-0 ring-1 ring-white/[.06]" />
      ) : (
        <div className="w-16 h-12 rounded-lg bg-d-surface-2 grid place-items-center shrink-0 ring-1 ring-white/[.06]"><Car className="w-4 h-4 text-d-dim" /></div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-d-text font-semibold text-sm truncate leading-tight">{it.title}</p>
        <div className="flex items-center gap-1.5 mt-0.5 text-[11px]">
          <span className={`inline-flex items-center gap-1 ${st.cls}`}>
            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: st.dot }} />{st.label}
          </span>
          {it.cost != null && <><span className="text-d-border">·</span><span className="text-d-dim">compra €{fmt(it.cost)}</span></>}
          {it.sale_price != null && <><span className="text-d-border">·</span><span className="text-d-dim">venta €{fmt(it.sale_price)}</span></>}
          {it.stock_status === 'buscando' && <><span className="text-d-border">·</span><span className="text-d-dim">{it.leads_count} {it.leads_count === 1 ? 'candidato' : 'candidatos'}</span></>}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {it.margin != null && (
          <div className="text-right hidden sm:block">
            <p className={`text-[13px] d-num font-semibold ${it.margin >= 0 ? 'text-d-green' : 'text-d-red'}`}>{it.margin >= 0 ? '+' : ''}€{fmt(it.margin)}</p>
            <p className="text-[10px] text-d-dim">margen {it.margin_is_real ? 'real' : 'est.'}</p>
          </div>
        )}

        {it.stock_status === 'buscando' && (
          <Link href={`/dealer/clientes/${it.id}`} className="d-btn-ghost text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1" title="Buscar y analizar candidatos">
            <Search className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Analizar</span>
          </Link>
        )}
        {adv && (
          <button
            onClick={() => onAdvance(adv)}
            disabled={busy}
            className="d-btn-primary text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{adv.label}</span>
          </button>
        )}
        <button onClick={onRemove} disabled={busy} className="text-d-dim hover:text-d-red p-1.5 rounded-lg transition-colors disabled:opacity-50" title="Mover a la papelera">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function PriceDialog({ title, prompt, initial, onCancel, onConfirm }: {
  title: string; prompt: string; initial: number | null;
  onCancel: () => void; onConfirm: (value: number) => void;
}) {
  const [raw, setRaw] = useState(initial != null ? String(initial) : '');
  const value = parseInt(raw.replace(/\D/g, ''), 10);
  const valid = Number.isFinite(value) && value > 0;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl border border-d-border bg-d-surface p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-d-text font-semibold text-sm leading-tight">{title}</p>
            <p className="text-d-muted text-[13px] mt-1">{prompt}</p>
          </div>
          <button onClick={onCancel} className="text-d-dim hover:text-d-text shrink-0"><X className="w-4 h-4" /></button>
        </div>
        <div className="relative mt-4">
          <input
            autoFocus
            inputMode="numeric"
            value={value ? value.toLocaleString('es-ES') : raw}
            onChange={e => setRaw(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && valid) onConfirm(value); }}
            placeholder="0"
            className="w-full rounded-lg border border-d-border bg-d-surface-2 px-3.5 py-2.5 pr-8 text-d-text text-[16px] outline-none focus:border-d-accent"
          />
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-d-dim text-sm">€</span>
        </div>
        <div className="flex gap-2 mt-4">
          <button onClick={onCancel} className="d-btn-ghost flex-1 py-2 rounded-lg text-sm">Cancelar</button>
          <button onClick={() => valid && onConfirm(value)} disabled={!valid} className="d-btn-primary flex-1 py-2 rounded-lg text-sm disabled:opacity-50">Confirmar</button>
        </div>
      </div>
    </div>
  );
}
