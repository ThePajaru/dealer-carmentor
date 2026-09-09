import type { Metadata } from "next";
import type { CSSProperties } from "react";
import "./globals.css";
import Providers from "@/components/Providers";

// Las fuentes se declaran como variables CSS con fallback, igual que en la app
// de consumo: "Bebas Neue Local" se carga por @font-face desde globals.css.
const fontVars = {
  "--font-display": "Arial, Helvetica, sans-serif",
  "--font-body": "Arial, Helvetica, sans-serif",
  "--font-display-alt": "'Bebas Neue Local', Impact, 'Arial Narrow', sans-serif",
  "--font-mono": "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as CSSProperties;

export const metadata: Metadata = {
  title: "CarMentor Dealer",
  description: "Importa coches de Alemania con el margen calculado antes de comprar.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  // El panel del dealer y los enlaces tokenizados no deben indexarse.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body style={fontVars}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
