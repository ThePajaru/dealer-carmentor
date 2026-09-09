import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';

export const metadata: Metadata = {
  title: 'CarMentor para Concesionarios | Análisis de stock y presupuestos profesionales',
  description: 'Plataforma B2B de CarMentor para compraventas e importadores. Analiza coches antes de comprar stock, genera presupuestos profesionales y gestiona leads.',
};

// Geist is scoped to the dealer section only: we remap the shared font CSS
// variables (--font-display / --font-body / --font-mono) to Geist here, so
// every dealer route inherits Geist without touching the rest of the app.
const dealerFontVars = {
  '--font-display': 'var(--font-geist-sans)',
  '--font-body': 'var(--font-geist-sans)',
  '--font-mono': 'var(--font-geist-mono)',
} as CSSProperties;

export default function DealerRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${GeistSans.variable} ${GeistMono.variable}`} style={dealerFontVars}>
      {children}
    </div>
  );
}
