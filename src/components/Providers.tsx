"use client";

import { ReactNode } from "react";
import { AuthProvider } from "@/hooks/useAuth";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Deliberadamente mas pequeno que el del monolito: aqui no hay chatbot de
// consumo, ni pixel de Facebook, ni banner de cookies, ni ReferralTracker.
export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <AuthProvider>{children}</AuthProvider>
    </ErrorBoundary>
  );
}
