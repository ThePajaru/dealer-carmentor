'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Loader2, Car, Phone, MessageSquare, Mail, Download } from 'lucide-react';
import { buildAnalysisView } from '@/lib/analysis-view';
import { DealerAnalysisReport } from '@/components/dealer/DealerAnalysisReport';

interface Informe {
  client_name: string | null;
  car: {
    title: string | null;
    car_image_url: string | null;
    country_of_origin: string | null;
    result_json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  dealer: {
    business_name: string;
    logo_url: string | null;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
  } | null;
}

export default function PublicInformePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Informe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/dealer/informe/${id}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setData(d.informe))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="dealer-root min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-d-accent animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="dealer-root min-h-screen flex items-center justify-center text-d-dim">
        Informe no encontrado o no disponible
      </div>
    );
  }

  const dealer = data.dealer;
  const car = data.car;
  const view = car.result_json ? buildAnalysisView(car.result_json, car.title) : null;
  const gallery = view?.car_images || [];
  const hero = gallery[0] || car.car_image_url;
  const rest = gallery.slice(1);

  return (
    <div className="dealer-root min-h-screen">
      <header className="border-b border-d-border">
        <div className="max-w-2xl mx-auto px-4 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {dealer?.logo_url ? (
              <img src={dealer.logo_url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
            ) : (
              <div className="d-ic w-12 h-12 shrink-0"><Car className="w-6 h-6" /></div>
            )}
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-d-text truncate">{dealer?.business_name || 'Informe'}</h1>
              <p className="text-d-muted text-sm">Análisis del vehículo</p>
            </div>
          </div>
          <Button onClick={() => window.print()} className="d-btn-ghost no-print shrink-0">
            <Download className="w-4 h-4 mr-2" /> Descargar PDF
          </Button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {data.client_name && (
          <p className="text-d-muted">
            Hola <span className="font-semibold text-d-text">{data.client_name}</span>, aquí tienes el análisis del vehículo:
          </p>
        )}

        {/* Car header */}
        <div className="d-card d-card-hl p-6">
          <div className="flex gap-4">
            {hero && <img src={hero} alt="" className="w-32 h-24 rounded-lg object-cover shrink-0" />}
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-d-text">{car.title || view?.titulo || 'Vehículo'}</h2>
              <div className="flex gap-4 text-sm text-d-muted mt-1">
                {view?.año && <span className="d-num">{view.año}</span>}
                {view?.kilometraje != null && <span className="d-num">{view.kilometraje.toLocaleString('es-ES')} km</span>}
                {car.country_of_origin && <span>{car.country_of_origin}</span>}
              </div>
            </div>
          </div>
          {rest.length > 0 && (
            <div className="flex gap-2 overflow-x-auto mt-4 -mx-1 px-1 print-wrap">
              {rest.map((src, i) => (
                <a key={i} href={src} target="_blank" rel="noopener" className="shrink-0">
                  <img src={src} alt="" loading="lazy" className="h-20 w-28 object-cover rounded-lg border border-d-border" />
                </a>
              ))}
            </div>
          )}
        </div>

        {/* The analysis (client mode — economics hidden) */}
        {view && <DealerAnalysisReport view={view} mode="client" />}

        {/* Contact */}
        {dealer && (
          <div className="d-card d-card-hl p-6">
            <h3 className="font-semibold text-d-text mb-3">¿Te interesa?</h3>
            <p className="text-d-muted text-sm mb-4">Contacta con {dealer.business_name}:</p>
            <div className="flex gap-3 flex-wrap">
              {dealer.whatsapp && (
                <a href={`https://wa.me/${dealer.whatsapp.replace(/\s+/g, '')}?text=${encodeURIComponent(`Hola, me interesa el ${car.title || 'vehículo'}`)}`} target="_blank" rel="noopener">
                  <Button className="d-btn-green"><MessageSquare className="w-4 h-4 mr-2" /> WhatsApp</Button>
                </a>
              )}
              {dealer.phone && (
                <a href={`tel:${dealer.phone}`}><Button className="d-btn-ghost"><Phone className="w-4 h-4 mr-2" /> Llamar</Button></a>
              )}
              {dealer.email && (
                <a href={`mailto:${dealer.email}?subject=Interesado en vehículo`}><Button className="d-btn-ghost"><Mail className="w-4 h-4 mr-2" /> Email</Button></a>
              )}
            </div>
          </div>
        )}

        <div className="text-center pt-4">
          <p className="text-d-dim text-xs">
            Análisis proporcionado por <Link href="/" className="d-link">CarMentor AI</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
