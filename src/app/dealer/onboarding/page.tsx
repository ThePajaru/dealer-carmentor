'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useDealer } from '@/hooks/useDealer';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Car, Loader2, ArrowRight } from 'lucide-react';

export default function DealerOnboardingPage() {
  const { user, session, loading: authLoading } = useAuth();
  const { dealerProfile, loading: dealerLoading } = useDealer();
  const router = useRouter();

  useEffect(() => {
    if (!dealerLoading && dealerProfile) {
      router.replace('/dealer/operaciones');
    }
  }, [dealerProfile, dealerLoading, router]);
  const [businessName, setBusinessName] = useState('');
  const [slug, setSlug] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30);
  };

  const handleBusinessNameChange = (val: string) => {
    setBusinessName(val);
    if (!slug || slug === generateSlug(businessName)) {
      setSlug(generateSlug(val));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.access_token) return;
    setError('');
    setSaving(true);

    try {
      const res = await fetch('/api/dealer/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          business_name: businessName.trim(),
          slug: slug.trim(),
          phone: phone.trim() || null,
          whatsapp: whatsapp.trim() || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Error al crear el perfil');
        return;
      }

      router.push('/dealer/operaciones');
    } catch {
      setError('Error de conexión. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) {
    return (
      <div className="dealer-root min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-d-accent animate-spin" />
      </div>
    );
  }

  if (!user) {
    router.replace('/login?redirect=/dealer/onboarding');
    return null;
  }

  return (
    <div className="dealer-root min-h-screen flex items-center justify-center p-4">
      <div className="d-card d-card-hl w-full max-w-lg p-6 sm:p-8">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <div className="d-ic d-ic-purple w-14 h-14">
              <Car className="w-7 h-7" />
            </div>
          </div>
          <h1 className="text-d-text text-[25px] font-bold tracking-tight">
            Configura tu empresa
          </h1>
          <p className="text-d-muted text-sm mt-2">
            Solo necesitamos unos datos para crear tu espacio de trabajo
          </p>
        </div>
        <div className="mt-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="businessName" className="text-d-muted">Nombre de la empresa *</Label>
              <input
                id="businessName"
                value={businessName}
                onChange={(e) => handleBusinessNameChange(e.target.value)}
                placeholder="Importaciones García"
                required
                className="d-input w-full px-3 py-2.5 text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="slug" className="text-d-muted">URL de tu página de captación *</Label>
              <div className="flex items-center gap-0">
                <span className="text-d-dim text-sm bg-d-surface-2 border border-r-0 border-d-border rounded-l-lg px-3 py-2.5 d-num">
                  carmentor.es/c/
                </span>
                <input
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="tu-empresa"
                  required
                  className="d-input d-num flex-1 px-3 py-2.5 text-sm rounded-l-none"
                />
              </div>
              <p className="text-d-dim text-xs">Solo letras minúsculas, números y guiones</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="text-d-muted">Teléfono</Label>
              <input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+34 612 345 678"
                className="d-input d-num w-full px-3 py-2.5 text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="whatsapp" className="text-d-muted">WhatsApp (para que te contacten los clientes)</Label>
              <input
                id="whatsapp"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="+34 612 345 678"
                className="d-input d-num w-full px-3 py-2.5 text-sm"
              />
            </div>

            {error && (
              <p className="text-d-red text-sm">{error}</p>
            )}

            <Button
              type="submit"
              disabled={saving || !businessName.trim() || !slug.trim()}
              className="w-full d-btn-primary py-5"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>Crear mi espacio de trabajo <ArrowRight className="w-4 h-4 ml-2" /></>
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
