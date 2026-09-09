'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import LeadStatusBadge from '@/components/dealer/LeadStatusBadge';
import { Loader2, Trash2, Undo2 } from 'lucide-react';
import Link from 'next/link';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Lead {
  id: string;
  client_name: string | null;
  client_phone: string | null;
  source_url: string;
  status: string;
  source: string;
  created_at: string;
  deleted_at?: string | null;
  car_analyses?: {
    title: string | null;
    car_image_url: string | null;
    result_json: any;
  } | null;
}

const statusTabs = [
  { value: 'todos', label: 'Todos' },
  { value: 'nuevo', label: 'Nuevos' },
  { value: 'contactado', label: 'Contactados' },
  { value: 'presupuesto_enviado', label: 'Presupuesto enviado' },
  { value: 'vendido', label: 'Vendidos' },
  { value: 'descartado', label: 'Descartados' },
  { value: 'papelera', label: 'Papelera' },
];

export default function DealerLeadsPage() {
  const { session } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('todos');
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const fetchLeads = async (status?: string) => {
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (status === 'papelera') params.set('trash', '1');
      else if (status && status !== 'todos') params.set('status', status);
      const res = await fetch(`/api/dealer/leads?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setLeads(data.leads || []);
        setTotal(data.total || 0);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeads(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token, activeTab]);

  // Soft delete → the lead moves to the papelera tab, restorable anytime.
  const deleteLead = async (id: string) => {
    if (!session?.access_token) return;
    setBusy(b => ({ ...b, [id]: true }));
    try {
      const res = await fetch(`/api/dealer/leads/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        setLeads(prev => prev.filter(l => l.id !== id));
        setTotal(t => Math.max(0, t - 1));
      }
    } finally {
      setBusy(b => ({ ...b, [id]: false }));
    }
  };

  const restoreLead = async (id: string) => {
    if (!session?.access_token) return;
    setBusy(b => ({ ...b, [id]: true }));
    try {
      const res = await fetch(`/api/dealer/leads/${id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ restore: true }),
      });
      if (res.ok) {
        setLeads(prev => prev.filter(l => l.id !== id));
        setTotal(t => Math.max(0, t - 1));
      }
    } finally {
      setBusy(b => ({ ...b, [id]: false }));
    }
  };

  const inTrash = activeTab === 'papelera';

  return (
      <div className="space-y-6">
        <div>
          <h1 className="text-[26px] font-bold text-d-text tracking-tight">
            Leads
          </h1>
          <p className="text-d-muted text-sm mt-1"><span className="d-num">{total}</span> leads {inTrash ? 'en la papelera' : 'en total'}</p>
        </div>

        {/* Status tabs */}
        <div className="flex gap-2 flex-wrap">
          {statusTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors inline-flex items-center gap-1.5 ${
                activeTab === tab.value
                  ? 'bg-d-accent/10 text-d-accent border-d-accent/30'
                  : 'text-d-muted hover:text-d-text border-d-border hover:border-d-border-strong'
              }`}
            >
              {tab.value === 'papelera' && <Trash2 className="w-3.5 h-3.5" />}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Leads list */}
        <div className="d-card d-card-hl p-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 text-d-accent animate-spin" />
            </div>
          ) : leads.length === 0 ? (
            <p className="text-d-muted text-sm py-8 text-center">
              {inTrash ? 'La papelera está vacía' : `No hay leads ${activeTab !== 'todos' ? `con estado "${statusTabs.find(t => t.value === activeTab)?.label}"` : ''}`}
            </p>
          ) : (
            <div className="space-y-1">
              {leads.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/dealer/leads/${lead.id}`}
                  className="flex items-center gap-4 p-3 rounded-lg hover:bg-d-surface-2 transition-colors group"
                >
                  {lead.car_analyses?.car_image_url ? (
                    <img src={lead.car_analyses.car_image_url} alt="" className="w-14 h-10 rounded-md object-cover shrink-0" />
                  ) : (
                    <div className="w-14 h-10 rounded-md bg-d-surface-2 flex items-center justify-center text-d-dim text-xs shrink-0">
                      ?
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-d-text text-sm font-medium truncate">
                      {lead.car_analyses?.title || lead.car_analyses?.result_json?.titulo || lead.source_url}
                    </p>
                    <p className="text-d-dim text-xs">
                      {lead.client_name || 'Sin nombre'} {lead.client_phone ? <>· <span className="d-num">{lead.client_phone}</span></> : ''}
                      {inTrash && lead.deleted_at && <> · borrado el <span className="d-num">{new Date(lead.deleted_at).toLocaleDateString('es-ES')}</span></>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <LeadStatusBadge status={lead.status} />
                    <span className="text-d-dim text-xs d-num hidden sm:inline">
                      {new Date(lead.created_at).toLocaleDateString('es-ES')}
                    </span>
                    {inTrash ? (
                      <button
                        onClick={e => { e.preventDefault(); e.stopPropagation(); restoreLead(lead.id); }}
                        className="p-2 rounded-md text-d-dim hover:text-d-green hover:bg-d-surface-3"
                        title="Restaurar lead"
                        aria-label="Restaurar lead"
                      >
                        {busy[lead.id] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
                      </button>
                    ) : (
                      <button
                        onClick={e => { e.preventDefault(); e.stopPropagation(); deleteLead(lead.id); }}
                        className="p-2 rounded-md text-d-dim hover:text-d-red hover:bg-d-surface-3 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                        title="Mover a la papelera"
                        aria-label="Mover a la papelera"
                      >
                        {busy[lead.id] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
  );
}
