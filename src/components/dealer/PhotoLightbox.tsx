'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';

/**
 * In-page photo viewer for the dealer analyses.
 *
 * Before this, every thumbnail was an `<a target="_blank">`: clicking a photo
 * ripped the dealer out of the report into a raw image tab. Now the photo opens
 * over the report and closes with Esc / backdrop / ✕, so triaging a car never
 * loses the page.
 *
 * `PhotoLightbox` is the controlled primitive (a page can open it from its hero
 * image); `PhotoStrip` is the self-contained thumbnail row that owns its state.
 */
export function PhotoLightbox({ images, index, onIndex, onClose }: {
  images: string[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const total = images.length;
  const go = useCallback((delta: number) => {
    onIndex((index + delta + total) % total);
  }, [index, total, onIndex]);

  // Esc closes, arrows navigate — a viewer that traps the keyboard feels broken.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    // Lock the page behind the overlay so the wheel doesn't scroll the report.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [go, onClose]);

  if (total === 0) return null;
  const src = images[Math.min(Math.max(index, 0), total - 1)];

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex flex-col"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Foto del coche"
    >
      {/* Top bar: counter + open-original + close */}
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3 shrink-0" onClick={e => e.stopPropagation()}>
        <span className="text-white/70 text-sm d-num">{index + 1} / {total}</span>
        <a
          href={src}
          target="_blank"
          rel="noopener"
          className="text-white/50 hover:text-white text-xs inline-flex items-center gap-1 transition-colors"
        >
          Abrir original <ExternalLink className="w-3 h-3" />
        </a>
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="ml-auto p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Stage */}
      <div className="flex-1 min-h-0 flex items-center justify-center px-2 sm:px-14 pb-2">
        <img
          src={src}
          alt=""
          className="max-h-full max-w-full object-contain rounded-lg shadow-2xl select-none"
          onClick={e => e.stopPropagation()}
        />
      </div>

      {total > 1 && (
        <>
          <NavButton side="left" onClick={e => { e.stopPropagation(); go(-1); }} />
          <NavButton side="right" onClick={e => { e.stopPropagation(); go(1); }} />

          {/* Filmstrip — jump straight to a photo instead of clicking through */}
          <div className="shrink-0 flex gap-2 overflow-x-auto px-4 sm:px-6 py-3" onClick={e => e.stopPropagation()}>
            {images.map((thumb, i) => (
              <button
                key={i}
                onClick={() => onIndex(i)}
                aria-label={`Foto ${i + 1}`}
                className={`shrink-0 rounded-md overflow-hidden ring-2 transition-all ${i === index ? 'ring-d-accent opacity-100' : 'ring-transparent opacity-50 hover:opacity-90'}`}
              >
                        <img src={thumb} alt="" loading="lazy" className="h-14 w-20 object-cover" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function NavButton({ side, onClick }: { side: 'left' | 'right'; onClick: (e: React.MouseEvent) => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      onClick={onClick}
      aria-label={side === 'left' ? 'Foto anterior' : 'Foto siguiente'}
      className={`hidden sm:grid place-items-center absolute top-1/2 -translate-y-1/2 ${side === 'left' ? 'left-3' : 'right-3'} w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors`}
    >
      <Icon className="w-6 h-6" />
    </button>
  );
}

/** Thumbnail row that opens the lightbox in place. */
export function PhotoStrip({ images, thumbClass = 'h-20 w-28', className = '' }: {
  images: string[];
  thumbClass?: string;
  className?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (images.length === 0) return null;
  return (
    <>
      <div className={`flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 ${className}`}>
        {images.map((src, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setOpen(i)}
            aria-label={`Ver foto ${i + 1}`}
            className="shrink-0 rounded-lg overflow-hidden border border-d-border hover:border-d-accent transition-colors"
          >
                <img src={src} alt="" loading="lazy" className={`${thumbClass} object-cover`} />
          </button>
        ))}
      </div>
      {open !== null && (
        <PhotoLightbox images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
      )}
    </>
  );
}
