'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { DealerProvider, useDealer } from '@/hooks/useDealer';
import DealerSidebar from '@/components/dealer/DealerSidebar';
import DealerQueryProvider from './query-provider';
import { Loader2, Lock } from 'lucide-react';

function DealerShell({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { dealerProfile, loading: dealerLoading } = useDealer();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (authLoading || dealerLoading) return;
    if (!user) {
      router.replace('/login?redirect=/dealer/operaciones');
      return;
    }
    if (!dealerProfile) {
      router.replace('/dealer/onboarding');
    }
  }, [user, dealerProfile, authLoading, dealerLoading, router]);

  // Loading, or redirecting (no user / no profile) — keep the dark loader,
  // never flash an unstyled or onboarding screen.
  if (authLoading || dealerLoading || !user || !dealerProfile) {
    return (
      <div className="dealer-root flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-d-accent animate-spin" />
      </div>
    );
  }

  // Hard paywall: no active subscription → persistent CTA across the app. We
  // deliberately DON'T hide the app — seeing incoming client requests they can't
  // yet analyze is the strongest motivation to subscribe. Hidden on the
  // subscribe page itself.
  const needsSubscription = dealerProfile.plan_status !== 'active';
  const onSubscribePage = pathname === '/dealer/suscripcion';

  return (
    <div className="dealer-root flex">
      <DealerSidebar dealerProfile={dealerProfile} />
      <main className="flex-1 overflow-auto min-h-0">
        {needsSubscription && !onSubscribePage && (
          <Link
            href="/dealer/suscripcion"
            className="flex items-center justify-center gap-2 bg-d-accent/10 border-b border-d-accent/30 text-d-accent px-4 py-2.5 pl-14 md:pl-4 text-sm font-medium hover:bg-d-accent/15 transition-colors"
          >
            <Lock className="w-4 h-4" />
            Suscríbete para analizar coches y enviar presupuestos
            <span className="underline underline-offset-2">Ver planes →</span>
          </Link>
        )}
        {/* Sin tope de ancho y con menos margen lateral: en un portatil de 14"
            cada pixel cuenta, y las tablas de la consola son lo primero que
            sufre un padding generoso. Las pantallas con texto largo ponen su
            propio freno de lectura, no lo pone el armazon. */}
        <div className="px-4 sm:px-5 md:px-6 pt-16 md:pt-8 pb-8 w-full">
          {children}
        </div>
      </main>
    </div>
  );
}

export default function DealerAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <DealerQueryProvider>
      <DealerProvider>
        <DealerShell>{children}</DealerShell>
      </DealerProvider>
    </DealerQueryProvider>
  );
}
