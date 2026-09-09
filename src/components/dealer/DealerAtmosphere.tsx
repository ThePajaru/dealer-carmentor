'use client';

import { useEffect, useRef } from 'react';

/**
 * Fixed, scroll-reactive background for the dealer landing.
 * Three soft color blobs parallax at different rates + a dot grid that drifts
 * as you scroll. GPU-only (transform/opacity), throttled to one rAF per frame,
 * and fully disabled under prefers-reduced-motion. Sits behind translucent
 * sections so it bleeds through subtly without hurting text contrast.
 */
export default function DealerAtmosphere() {
  const blob1 = useRef<HTMLDivElement>(null);
  const blob2 = useRef<HTMLDivElement>(null);
  const blob3 = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    let raf = 0;
    let ticking = false;

    const apply = () => {
      ticking = false;
      const y = window.scrollY;
      const h = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
      const p = Math.min(y / h, 1); // 0→1 scroll progress

      if (blob1.current) blob1.current.style.transform = `translate3d(${p * 60}px, ${y * -0.12}px, 0) scale(${1 + p * 0.25})`;
      if (blob2.current) blob2.current.style.transform = `translate3d(${p * -80}px, ${y * 0.08}px, 0) scale(${1.1 - p * 0.15})`;
      if (blob3.current) blob3.current.style.transform = `translate3d(${p * 40}px, ${y * -0.05}px, 0)`;
      if (grid.current) grid.current.style.transform = `translate3d(0, ${y * -0.04}px, 0)`;
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      raf = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-white">
      {/* drifting dot grid */}
      <div
        ref={grid}
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage: 'radial-gradient(rgba(107,131,186,0.18) 1px, transparent 1px)',
          backgroundSize: '30px 30px',
          top: '-10%',
          height: '120%',
        }}
      />
      {/* color blobs */}
      <div
        ref={blob1}
        className="absolute left-[-10%] top-[-6%] h-[46vw] w-[46vw] rounded-full will-change-transform"
        style={{ background: 'radial-gradient(circle, rgba(170,190,245,0.55), transparent 68%)' }}
      />
      <div
        ref={blob2}
        className="absolute right-[-14%] top-[32%] h-[52vw] w-[52vw] rounded-full will-change-transform"
        style={{ background: 'radial-gradient(circle, rgba(107,131,186,0.28), transparent 66%)' }}
      />
      <div
        ref={blob3}
        className="absolute left-[18%] bottom-[-12%] h-[40vw] w-[40vw] rounded-full will-change-transform"
        style={{ background: 'radial-gradient(circle, rgba(5,150,105,0.14), transparent 66%)' }}
      />
    </div>
  );
}
