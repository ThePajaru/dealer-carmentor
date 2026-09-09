'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useDealer } from '@/hooks/useDealer';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Save, Upload } from 'lucide-react';
import CaptureLinks from '@/components/dealer/CaptureLinks';

export default function DealerSettingsPage() {
  const { session } = useAuth();
  const { dealerProfile, refetch } = useDealer();
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    business_name: '',
    slug: '',
    phone: '',
    whatsapp: '',
    email: '',
    address: '',
    default_transport: 500,
    default_gestoria: 180,
    default_itv: 160,
    default_plates: 60,
    default_margin_pct: 15,
    deduct_import_vat: true,
    dealers_only_comps: false,
  });

  useEffect(() => {
    if (dealerProfile) {
      setForm({
        business_name: dealerProfile.business_name || '',
        slug: dealerProfile.slug || '',
        phone: dealerProfile.phone || '',
        whatsapp: dealerProfile.whatsapp || '',
        email: dealerProfile.email || '',
        address: dealerProfile.address || '',
        default_transport: dealerProfile.default_transport,
        default_gestoria: dealerProfile.default_gestoria,
        default_itv: dealerProfile.default_itv,
        default_plates: dealerProfile.default_plates,
        default_margin_pct: dealerProfile.default_margin_pct,
        deduct_import_vat: dealerProfile.deduct_import_vat ?? true,
        dealers_only_comps: dealerProfile.dealers_only_comps ?? false,
      });
    }
  }, [dealerProfile]);

  const handleSave = async () => {
    if (!session?.access_token) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/dealer/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setSaved(true);
        refetch();
        setTimeout(() => setSaved(false), 3000);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !session?.access_token) return;
    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const res = await fetch('/api/dealer/logo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });
      if (res.ok) refetch();
    } finally {
      setUploadingLogo(false);
    }
  };

  const update = (field: string, value: string | number | boolean) => setForm(prev => ({ ...prev, [field]: value }));

  return (
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-semibold text-d-text tracking-tight">
              Configuración
            </h1>
            <p className="text-d-muted text-sm mt-1">Personaliza tu perfil y costes por defecto</p>
          </div>
          <Button onClick={handleSave} disabled={saving} className={`shrink-0 mt-0.5 ${saved ? 'd-btn-green' : 'd-btn-primary'}`}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            {saved ? 'Guardado' : 'Guardar'}
          </Button>
        </div>

        <div className="mt-6 divide-y divide-d-border">
        {/* Logo */}
        <section className="py-6 first:pt-0">
          <h2 className="text-[15px] font-medium text-d-text mb-4">Logo</h2>
          <div className="flex items-center gap-4">
            {dealerProfile?.logo_url ? (
              <img src={dealerProfile.logo_url} alt="Logo" className="w-16 h-16 rounded-lg object-cover border border-d-border" />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-d-surface-2 border border-d-border flex items-center justify-center text-d-dim text-xs">
                Sin logo
              </div>
            )}
            <div>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleLogoUpload} className="hidden" />
              <Button
                variant="outline"
                size="sm"
                className="d-btn-ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingLogo}
              >
                {uploadingLogo ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
                Subir logo
              </Button>
              <p className="text-d-dim text-xs mt-1.5">PNG, JPG o WebP. Máximo 2MB.</p>
            </div>
          </div>
        </section>

        {/* Business info */}
        <section className="py-6">
          <h2 className="text-[15px] font-medium text-d-text mb-4">Datos de la empresa</h2>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-d-muted">Nombre de la empresa</Label>
              <input value={form.business_name} onChange={e => update('business_name', e.target.value)} className="d-input w-full px-3 py-2.5 text-sm" />
            </div>
            <div className="space-y-2">
              <Label className="text-d-muted">Slug (URL pública)</Label>
              <div className="flex items-center gap-2">
                <span className="text-d-dim text-sm d-num">carmentor.es/c/</span>
                <input value={form.slug} onChange={e => update('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} className="d-input d-num flex-1 px-3 py-2.5 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-d-muted">Teléfono</Label>
                <input value={form.phone} onChange={e => update('phone', e.target.value)} className="d-input d-num w-full px-3 py-2.5 text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="text-d-muted">WhatsApp</Label>
                <input value={form.whatsapp} onChange={e => update('whatsapp', e.target.value)} className="d-input d-num w-full px-3 py-2.5 text-sm" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-d-muted">Email</Label>
              <input value={form.email} onChange={e => update('email', e.target.value)} className="d-input w-full px-3 py-2.5 text-sm" />
            </div>
            <div className="space-y-2">
              <Label className="text-d-muted">Dirección</Label>
              <input value={form.address} onChange={e => update('address', e.target.value)} className="d-input w-full px-3 py-2.5 text-sm" />
            </div>
          </div>
        </section>

        {/* Default costs */}
        <section className="py-6">
          <h2 className="text-[15px] font-medium text-d-text">Costes por defecto</h2>
          <p className="text-d-dim text-xs mt-0.5 mb-4">Se pre-rellenan al crear un presupuesto nuevo</p>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-d-muted">Transporte (€)</Label>
                <input type="number" value={form.default_transport} onChange={e => update('default_transport', Number(e.target.value))} className="d-input d-num w-full px-3 py-2.5 text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="text-d-muted">Gestoría (€)</Label>
                <input type="number" value={form.default_gestoria} onChange={e => update('default_gestoria', Number(e.target.value))} className="d-input d-num w-full px-3 py-2.5 text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="text-d-muted">ITV (€)</Label>
                <input type="number" value={form.default_itv} onChange={e => update('default_itv', Number(e.target.value))} className="d-input d-num w-full px-3 py-2.5 text-sm" />
              </div>
              <div className="space-y-2">
                <Label className="text-d-muted">Matriculación (€)</Label>
                <input type="number" value={form.default_plates} onChange={e => update('default_plates', Number(e.target.value))} className="d-input d-num w-full px-3 py-2.5 text-sm" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-d-muted">Margen por defecto (%)</Label>
              <input type="number" value={form.default_margin_pct} onChange={e => update('default_margin_pct', Number(e.target.value))} className="d-input d-num max-w-32 px-3 py-2.5 text-sm" />
            </div>
          </div>
        </section>

        {/* Cálculo de compra y mercado */}
        <section className="py-6">
          <h2 className="text-[15px] font-medium text-d-text">Cálculo de compra y mercado</h2>
          <p className="text-d-dim text-xs mt-0.5 mb-4">Ajusta el coste de compra y la referencia de mercado a tu forma de comprar y vender</p>
          <div className="space-y-4">
            <label className="flex items-start justify-between gap-4 cursor-pointer">
              <span>
                <span className="block text-d-text text-sm font-medium">Comprar sin IVA (intracomunitario)</span>
                <span className="block text-d-dim text-xs mt-0.5">
                  En anuncios de profesionales alemanes con IVA deducible (MwSt. ausweisbar), usa el precio <b>neto</b> del
                  anuncio como coste de compra. El IVA español se liquida por separado, fuera de la app. Los coches sin IVA
                  deducible (particular / diferencia) no se ven afectados.
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={form.deduct_import_vat}
                onClick={() => update('deduct_import_vat', !form.deduct_import_vat)}
                className={`shrink-0 mt-0.5 w-10 h-6 rounded-full transition-colors relative ${form.deduct_import_vat ? 'bg-d-green' : 'bg-d-surface-2 border border-d-border'}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${form.deduct_import_vat ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
            </label>

            <div className="h-px bg-d-border" />

            <label className="flex items-start justify-between gap-4 cursor-pointer">
              <span>
                <span className="block text-d-text text-sm font-medium">Comparar solo con anuncios de profesionales</span>
                <span className="block text-d-dim text-xs mt-0.5">
                  Al calcular el precio de mercado en coches.net, incluye solo anuncios de concesionarios (no particulares).
                  Da una referencia de venta más ajustada a tu forma de vender. Afecta a los análisis nuevos.
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={form.dealers_only_comps}
                onClick={() => update('dealers_only_comps', !form.dealers_only_comps)}
                className={`shrink-0 mt-0.5 w-10 h-6 rounded-full transition-colors relative ${form.dealers_only_comps ? 'bg-d-green' : 'bg-d-surface-2 border border-d-border'}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${form.dealers_only_comps ? 'left-[18px]' : 'left-0.5'}`} />
              </button>
            </label>
          </div>
        </section>

        {/* Intake links (both self-serve flows) */}
        <section className="py-6 last:pb-0">
          <h2 className="text-[15px] font-medium text-d-text">Tu enlace de captación</h2>
          <p className="text-d-muted text-sm mt-0.5 mb-4">
            Ponlos en tu bio de Instagram, tu web o WhatsApp. Tus clientes los rellenan solos y las
            solicitudes caen directas en Operaciones.
          </p>
          <CaptureLinks card={false} heading={false} />
        </section>
        </div>
      </div>
  );
}
