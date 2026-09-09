'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import type { DealerProfile } from '@/hooks/useDealer';
import { DEALER_PLAN_LIMITS, DEALER_PLAN_NAMES, type DealerPlanType } from '@/lib/dealer-plans';
import {
  Workflow,
  Sparkles,
  FileText,
  ClipboardCheck,
  Warehouse,
  PackageCheck,
  Trash2,
  Settings,
  LogOut,
  Car,
  Menu,
  X,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import NewOperationModal from '@/components/dealer/NewOperationModal';

interface DealerSidebarProps {
  dealerProfile: DealerProfile;
}

// Operaciones is home (case pages live under /dealer/clientes/*); Analizar is the
// sourcing workbench. Dashboard/Clientes were retired into Operaciones.
const navItems = [
  { href: '/dealer/operaciones', label: 'Operaciones', icon: Workflow, alias: ['/dealer/clientes'] },
  { href: '/dealer/analizar', label: 'Analizar', icon: Sparkles },
  { href: '/dealer/revisiones', label: 'Revisiones', icon: ClipboardCheck },
  { href: '/dealer/presupuesto', label: 'Presupuestos', icon: FileText },
  { href: '/dealer/stock', label: 'Stock', icon: Warehouse },
  { href: '/dealer/entregados', label: 'Entregados', icon: PackageCheck },
  { href: '/dealer/papelera', label: 'Papelera', icon: Trash2 },
  { href: '/dealer/settings', label: 'Configuración', icon: Settings },
];

export default function DealerSidebar({ dealerProfile }: DealerSidebarProps) {
  const pathname = usePathname();
  const { signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [newOpOpen, setNewOpOpen] = useState(false);

  // Restore the desktop collapse preference.
  useEffect(() => {
    setCollapsed(localStorage.getItem('dealer-sidebar-collapsed') === '1');
  }, []);

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem('dealer-sidebar-collapsed', next ? '1' : '0');
      return next;
    });

  const limit = DEALER_PLAN_LIMITS[dealerProfile.plan as DealerPlanType] || 50;
  const planName = DEALER_PLAN_NAMES[dealerProfile.plan as DealerPlanType] || 'Profesional';
  const usagePct = Math.min((dealerProfile.analyses_used / limit) * 100, 100);
  const usageSeverity = usagePct >= 90 ? 'danger' : usagePct >= 75 ? 'warn' : '';

  const isActive = (item: (typeof navItems)[number]) =>
    pathname.startsWith(item.href) || (item.alias?.some((a) => pathname.startsWith(a)) ?? false);

  const sidebar = (
    <div className={`d-side h-full ${collapsed ? 'collapsed' : ''}`}>
      {/* Clickable right border — toggles collapse */}
      <button
        onClick={toggleCollapsed}
        aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}
        title={collapsed ? 'Expandir' : 'Contraer'}
        className="d-side-edge"
      />

      {/* Header */}
      <div className="d-side-header px-4 pt-[18px] pb-4">
        <Link href="/dealer/operaciones" className="flex items-center gap-3" onClick={() => setMobileOpen(false)}>
          {dealerProfile.logo_url ? (
            <img src={dealerProfile.logo_url} alt="" className="w-9 h-9 rounded-[10px] object-cover shrink-0" />
          ) : (
            <span
              className="w-9 h-9 rounded-[10px] grid place-items-center text-d-accent shrink-0"
              style={{ background: 'linear-gradient(160deg,rgba(170,190,245,.16),rgba(170,190,245,.10))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08),0 1px 2px rgba(0,0,0,.4)' }}
            >
              <Car className="w-[19px] h-[19px]" />
            </span>
          )}
          <div className="d-collapse-hide min-w-0">
            <p className="text-d-text text-[13.5px] font-semibold leading-tight truncate">{dealerProfile.business_name}</p>
            <span className="d-tag d-tag-info mt-2 !text-[10px] !tracking-wider uppercase">{planName}</span>
          </div>
        </Link>
      </div>

      {/* Primary action — top of funnel */}
      <div className="px-3">
        <button
          onClick={() => { setNewOpOpen(true); setMobileOpen(false); }}
          title={collapsed ? 'Nueva operación' : undefined}
          className="d-btn-primary w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-[13px]"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span className="d-collapse-hide">Nueva operación</span>
        </button>
      </div>

      {/* Divider separating brand from navigation */}
      <div className="mx-4 mt-3 border-t border-white/[.05]" />

      {/* Nav */}
      <div className="px-3 mt-2.5">
        <nav className="flex flex-col gap-0.5">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              title={collapsed ? item.label : undefined}
              className={`d-navitem ${isActive(item) ? 'active' : ''}`}
            >
              <item.icon className="w-[17px] h-[17px]" />
              <span className="d-collapse-hide">{item.label}</span>
            </Link>
          ))}
        </nav>
      </div>

      {/* Footer */}
      <div className="mt-auto p-3">
        <div className={`d-collapse-hide d-card-soft px-3.5 py-3.5 transition-colors ${usageSeverity === 'danger' ? '!border-d-red/40' : usageSeverity === 'warn' ? '!border-d-amber/40' : ''}`}>
          <div className="flex justify-between items-baseline text-xs text-d-muted mb-2">
            <span>Análisis este mes</span>
            <span className={`d-num ${usageSeverity === 'danger' ? 'text-d-red' : usageSeverity === 'warn' ? 'text-d-amber' : 'text-d-text-2'}`}>
              <span className="d-num">{dealerProfile.analyses_used}</span> / {limit}
            </span>
          </div>
          <div className={`d-bar ${usageSeverity}`}><i style={{ width: `${usagePct}%` }} /></div>
        </div>

        <button
          onClick={() => signOut()}
          title={collapsed ? 'Cerrar sesión' : undefined}
          className="d-navitem w-full mt-1.5 hover:!text-d-red"
        >
          <LogOut className="w-[18px] h-[18px]" />
          <span className="d-collapse-hide">Cerrar sesión</span>
        </button>

        {/* Branding — single dim line, doesn't compete with the nav */}
        <a
          href="https://carmentor.es"
          target="_blank"
          rel="noopener"
          className="d-collapse-hide flex items-center justify-center gap-1.5 mt-2.5 text-[10.5px] text-d-dim hover:text-d-muted transition-colors"
        >
          <span>Powered by</span>
          <span className="flex items-center gap-1 font-semibold text-d-text-2">
            <Car className="w-3 h-3 text-d-accent" />
            CarMentor
          </span>
        </a>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile toggle */}
      <div
        className="md:hidden fixed z-50"
        style={{ top: 'max(1rem, env(safe-area-inset-top))', left: 'max(1rem, env(safe-area-inset-left))' }}
      >
        <Button
          size="icon"
          variant="outline"
          className="bg-d-surface border-d-border text-d-text h-11 w-11"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-expanded={mobileOpen}
          aria-controls="dealer-mobile-sidebar"
          aria-label={mobileOpen ? 'Cerrar menú' : 'Abrir menú'}
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </Button>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 bg-black/60 z-40" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        id="dealer-mobile-sidebar"
        className={`fixed top-0 left-0 h-full z-40 transition-transform md:translate-x-0 md:static ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebar}
      </aside>

      <NewOperationModal open={newOpOpen} onClose={() => setNewOpOpen(false)} />
    </>
  );
}
