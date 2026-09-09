'use client';

import { X } from 'lucide-react';
import CaptureLinks from './CaptureLinks';

/** Los enlaces de captación (portada + los dos directos) dentro de un modal. */
export default function CaptureLinksModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center p-4 overflow-y-auto">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md d-card d-card-hl p-5 my-8">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-d-text text-lg font-bold tracking-tight">Tu enlace de captación</h2>
            <p className="text-d-muted text-xs mt-0.5">
              Este es el que va en tu bio de Instagram, tu web y tu WhatsApp. El cliente elige su puerta y la
              solicitud cae directa en Operaciones.
            </p>
          </div>
          <button onClick={onClose} className="text-d-dim hover:text-d-text p-2 -mr-2 -mt-2"><X className="w-5 h-5" /></button>
        </div>

        <div className="mt-4">
          <CaptureLinks card={false} heading={false} />
        </div>
      </div>
    </div>
  );
}
