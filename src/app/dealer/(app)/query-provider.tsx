'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Scoped React Query cache for the dealer app. The provider lives in the dealer
 * layout, which stays mounted across every dealer route — so a page you've
 * already visited (e.g. Operaciones) renders instantly from cache on back-
 * navigation and revalidates in the background (stale-while-revalidate).
 *
 * refetchOnWindowFocus is off on purpose: Supabase auto-refreshes the JWT on tab
 * focus, and we don't want that firing a refetch storm across the app.
 */
export default function DealerQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000, // 30s: back-nav is instant + silent revalidate
            gcTime: 5 * 60_000, // keep cached pages for 5 min after leaving
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
