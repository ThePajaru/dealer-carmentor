import type { Metadata } from 'next';

// Panel del colaborador (gestor e ingeniero). Usa el mismo tema oscuro que la
// app del dealer (`dealer-root` en globals.css) para que sea la misma casa, pero
// no monta su shell: aquí no hay perfil de dealer, ni sidebar, ni paywall.

export const metadata: Metadata = {
  title: 'Trámites · CarMentor',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="dealer-root dealer-root--scroll">{children}</div>;
}
