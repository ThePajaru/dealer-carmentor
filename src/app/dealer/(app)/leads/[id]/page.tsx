'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, FileText, ExternalLink, Phone, Mail, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

interface Lead {
  id: string;
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  source_url: string;
  status: string;
  notes: string | null;
  source: string;
  created_at: string;
  analysis_id: string | null;
  car_analyses?: any;
}

const statuses = [
  { value: 'nuevo', label: 'Nuevo' },
  { value: 'contactado', label: 'Contactado' },
  { value: 'presupuesto_enviado', label: 'Presupuesto enviado' },
  { value: 'vendido', label: 'Vendido' },
  { value: 'descartado', label: 'Descartado' },
];

export default function DealerLeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!session?.access_token || !id) return;
    fetch(`/api/dealer/leads/${id}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(r => r.json())
      .then(data => {
        setLead(data.lead);
        setNotes(data.lead?.notes || '');
      })
      .finally(() => setLoading(false));
  }, [session?.access_token, id]);

  const updateLead = async (updates: Record<string, any>) => {
    if (!session?.access_token || !id) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/dealer/leads/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setLead(prev => prev ? { ...prev, ...data.lead } : prev);
      }
    } finally {
      setSaving(false);
    }
  };

  const analysis = lead?.car_analyses;

  return (
      <div className="space-y-6 max-w-6xl mx-auto">
        <div>
          <Link href="/dealer/leads" className="inline-flex items-center gap-2 text-d-muted hover:text-d-text text-sm transition-colors mb-3">
            <ArrowLeft className="w-4 h-4" /> Leads
          </Link>
          <h1 className="text-[22px] font-bold text-d-text tracking-tight leading-none">
            {loading ? 'Cargando...' : (analysis?.title || analysis?.result_json?.titulo || 'Detalle del lead')}
          </h1>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 text-d-accent animate-spin" />
          </div>
        ) : lead ? (
          <>
            {/* Status & actions */}
            <div className="flex items-center gap-3 flex-wrap">
              {statuses.map(s => (
                <button
                  key={s.value}
                  onClick={() => updateLead({ status: s.value })}
                  disabled={saving}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                    lead.status === s.value
                      ? 'bg-d-accent/10 text-d-accent border-d-accent/30'
                      : 'text-d-dim border-d-border hover:border-d-border-strong hover:text-d-text-2'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Client info */}
              <div className="d-card d-card-hl p-4">
                <h3 className="text-d-text text-sm font-semibold mb-3">Cliente</h3>
                <div className="space-y-3">
                  <div>
                    <p className="text-d-dim text-xs">Nombre</p>
                    <p className="text-d-text text-sm">{lead.client_name || '—'}</p>
                  </div>
                  {lead.client_phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-d-dim" />
                      <a href={`tel:${lead.client_phone}`} className="d-link text-sm d-num">{lead.client_phone}</a>
                    </div>
                  )}
                  {lead.client_email && (
                    <div className="flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5 text-d-dim" />
                      <a href={`mailto:${lead.client_email}`} className="d-link text-sm">{lead.client_email}</a>
                    </div>
                  )}
                  <div>
                    <p className="text-d-dim text-xs">Fuente</p>
                    <p className="text-d-text text-sm">{lead.source}</p>
                  </div>
                  <div>
                    <p className="text-d-dim text-xs">URL del anuncio</p>
                    <a href={lead.source_url} target="_blank" rel="noopener" className="d-link text-xs break-all flex items-center gap-1">
                      {lead.source_url.slice(0, 60)}... <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </div>
                </div>
              </div>

              {/* Analysis summary */}
              <div className="d-card d-card-hl p-4">
                <h3 className="text-d-text text-sm font-semibold mb-3">Análisis</h3>
                {analysis ? (
                  <div className="space-y-3">
                    {analysis.car_image_url && (
                      <img src={analysis.car_image_url} alt="" className="w-full h-32 rounded-lg object-cover" />
                    )}
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-d-dim">Precio:</span> <span className="text-d-text d-num">€{(analysis.result_json?.precio_publicado ?? analysis.result_json?.precio)?.toLocaleString('es-ES') || '—'}</span></div>
                      <div><span className="text-d-dim">País:</span> <span className="text-d-text">{analysis.country_of_origin || analysis.result_json?.pais_origen || '—'}</span></div>
                      {analysis.result_json?.precio_venta_estimado && (
                        <div><span className="text-d-dim">Venta est.:</span> <span className="text-d-green d-num">€{analysis.result_json.precio_venta_estimado?.toLocaleString('es-ES')}</span></div>
                      )}
                      {analysis.result_json?.margen_porcentaje != null && (
                        <div><span className="text-d-dim">Margen:</span>{' '}
                          {(analysis.result_json?.analisis_rentabilidad?.low_confidence_market ||
                            ((analysis.result_json?.investigacion_mercado?.precios_espana?.total_anuncios ?? 0) < 3)) ? (
                            <span className="text-amber-400 inline-flex items-center gap-1" title="Muestra de mercado insuficiente (menos de 3 comparables). Margen no fiable para fijar precio.">
                              <AlertTriangle className="w-3 h-3" /> no fiable
                            </span>
                          ) : (
                            <span className="text-d-green d-num">{analysis.result_json.margen_porcentaje}%</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-d-dim text-sm">Análisis pendiente o no disponible</p>
                )}
              </div>
            </div>

            {/* Notes */}
            <div className="d-card d-card-hl p-4">
              <h3 className="text-d-text text-sm font-semibold mb-3">Notas</h3>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                onBlur={() => { if (notes !== lead.notes) updateLead({ notes }); }}
                placeholder="Añade notas sobre este lead..."
                className="d-input w-full p-3 text-sm min-h-[100px] resize-y"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              {lead.analysis_id && (
                <Link href={`/dealer/presupuesto/nuevo?lead=${lead.id}&analysis=${lead.analysis_id}`}>
                  <Button className="d-btn-primary">
                    <FileText className="w-4 h-4 mr-2" /> Crear presupuesto
                  </Button>
                </Link>
              )}
            </div>
          </>
        ) : (
          <p className="text-d-dim text-center py-12">Lead no encontrado</p>
        )}
      </div>
  );
}
