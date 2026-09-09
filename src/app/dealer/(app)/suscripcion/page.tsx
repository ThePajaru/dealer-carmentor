'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useDealer } from '@/hooks/useDealer';
import { Button } from '@/components/ui/button';
import { Check, Loader2 } from 'lucide-react';
import {
  DEALER_PLAN_NAMES,
  DEALER_PLAN_PRICES,
  DEALER_PLAN_FEATURES,
  DEALER_CURRENT_PLAN,
} from '@/lib/dealer-plans';

const PLAN = DEALER_CURRENT_PLAN;

export default function SuscripcionPage() {
  const { session } = useAuth();
  const { dealerProfile } = useDealer();
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isActive = dealerProfile?.plan_status === 'active';

  const subscribe = async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dealer/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ plan: PLAN, billingPeriod: billing }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'No se pudo iniciar el pago. Inténtalo de nuevo.');
        setLoading(false);
      }
    } catch {
      setError('Error de conexión. Inténtalo de nuevo.');
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-8 text-center max-w-2xl mx-auto">
        <h1 className="text-[26px] font-bold text-d-text tracking-tight mb-2">
          {isActive ? 'Tu suscripción' : 'Suscríbete para empezar a analizar'}
        </h1>
        <p className="text-d-muted">
          {isActive
            ? 'Puedes cambiar de plan cuando quieras. El cambio se prorratea automáticamente.'
            : 'Elige un plan para desbloquear el análisis de coches, presupuestos y captación de clientes.'}
        </p>
      </div>

      {/* Billing toggle */}
      <div className="flex items-center justify-center gap-3 mb-8">
        <button
          onClick={() => setBilling('monthly')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            billing === 'monthly' ? 'bg-d-accent text-white' : 'text-d-muted hover:text-d-text'
          }`}
        >
          Mensual
        </button>
        <button
          onClick={() => setBilling('yearly')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            billing === 'yearly' ? 'bg-d-accent text-white' : 'text-d-muted hover:text-d-text'
          }`}
        >
          Anual <span className="text-d-green">-17%</span>
        </button>
      </div>

      {error && (
        <div className="max-w-md mx-auto mb-6 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-center">
          {error}
        </div>
      )}

      <div className="max-w-md mx-auto">
        <div className="d-card d-card-hl ring-1 ring-d-accent/40 p-7 flex flex-col">
          <h3 className="text-lg font-bold text-d-text">{DEALER_PLAN_NAMES[PLAN]}</h3>
          <div className="mt-2 mb-5">
            <span className="text-4xl font-bold text-d-text d-num">{DEALER_PLAN_PRICES[PLAN][billing]}</span>
            <span className="text-d-dim text-sm">/{billing === 'monthly' ? 'mes' : 'año'}</span>
          </div>
          <ul className="space-y-2.5 mb-7">
            {DEALER_PLAN_FEATURES[PLAN].map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-d-text-2">
                <Check className="w-4 h-4 text-d-green shrink-0 mt-0.5" />
                {f}
              </li>
            ))}
          </ul>
          <Button
            onClick={subscribe}
            disabled={loading || isActive}
            className="d-btn-primary w-full"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : isActive ? 'Plan actual' : 'Suscribirse'}
          </Button>
        </div>
      </div>

      <p className="text-center text-d-dim text-xs mt-8">
        Todos los precios sin IVA. Factura disponible para desgravar. Cancela cuando quieras.
      </p>
    </div>
  );
}
