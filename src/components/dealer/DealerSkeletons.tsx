import { cn } from '@/lib/utils';
import { PHASES } from '@/lib/dealer/pipeline';

/** A single shimmering block, themed for the dealer (dark) surface. */
function Sk({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-d-surface-2', className)} />;
}

/** One job card placeholder (image + two text lines). */
function JobCardSk() {
  return (
    <div className="rounded-xl border border-d-border p-3 flex gap-3">
      <Sk className="w-14 h-10 rounded-lg shrink-0" />
      <div className="flex-1 min-w-0 space-y-2 py-0.5">
        <Sk className="h-3 w-3/4" />
        <Sk className="h-2.5 w-1/2" />
      </div>
    </div>
  );
}

/**
 * Loading placeholder for the Operaciones board — mirrors the hero band, the
 * 5-phase kanban and the two panels below, so the first paint doesn't jump when
 * data lands. Rendered in place of the header (which the page draws for real).
 */
export function OperacionesSkeleton() {
  return (
    <div>
      {/* Hero band: big margin figure + ticks + sparkline */}
      <div className="mt-6 flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-2">
          <Sk className="h-3 w-28" />
          <Sk className="h-10 w-52" />
        </div>
        <div className="hidden md:flex gap-8 pb-1">
          {[0, 1, 2].map(i => (
            <div key={i} className="space-y-2">
              <Sk className="h-2.5 w-16" />
              <Sk className="h-5 w-8" />
            </div>
          ))}
        </div>
        <Sk className="h-9 w-[132px] pb-1" />
      </div>

      {/* Kanban: one column per phase */}
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {PHASES.map((ph, col) => (
          <div key={ph.key} className="space-y-3">
            <div className="flex items-center gap-2">
              <Sk className="h-3 w-20" />
              <Sk className="h-3 w-5 rounded-full" />
            </div>
            {Array.from({ length: col % 2 === 0 ? 2 : 1 }).map((_, i) => <JobCardSk key={i} />)}
          </div>
        ))}
      </div>

      {/* Two panels: activity + risks */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        {[0, 1].map(i => (
          <div key={i} className="rounded-xl border border-d-border p-4 space-y-3">
            <Sk className="h-3.5 w-32" />
            {[0, 1, 2].map(j => (
              <div key={j} className="flex items-center gap-3">
                <Sk className="h-7 w-7 rounded-full shrink-0" />
                <Sk className="h-3 flex-1" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Loading placeholder for a client case — mirrors the case header, the pinned
 * "chosen car" aside and the case-file column. Rendered under the (real) back
 * link while the case loads on a cold visit.
 */
export function ClientDetailSkeleton() {
  return (
    <div>
      {/* Case header: name + kebab, then the phase progress bar */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <Sk className="h-6 w-64" />
          <Sk className="h-8 w-8 rounded-lg shrink-0" />
        </div>
        <div className="flex items-center gap-1.5">
          {[0, 1, 2, 3, 4].map(i => <Sk key={i} className="h-[3px] w-7 rounded-full" />)}
          <Sk className="h-3 w-24 ml-1.5" />
        </div>
        <Sk className="h-3 w-72" />
      </div>

      {/* Two-column: pinned deal aside + case file */}
      <div className="grid lg:grid-cols-[300px_1fr] gap-6 lg:gap-8 items-start mt-4">
        {/* Aside: chosen car + market value */}
        <aside className="lg:border-r lg:border-d-border lg:pr-8 space-y-5">
          <div className="flex gap-3">
            <Sk className="w-20 h-14 rounded-lg shrink-0" />
            <div className="flex-1 space-y-2 py-1">
              <Sk className="h-2.5 w-24" />
              <Sk className="h-3.5 w-full" />
            </div>
          </div>
          <div className="space-y-2">
            <Sk className="h-2.5 w-28" />
            <Sk className="h-7 w-40" />
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 pt-3 border-t border-d-border">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="space-y-1.5">
                <Sk className="h-2.5 w-20" />
                <Sk className="h-4 w-16" />
              </div>
            ))}
          </div>
          <Sk className="h-9 w-full rounded-lg" />
        </aside>

        {/* Case file: a couple of receipt rows + the live workspace */}
        <div className="min-w-0 space-y-4">
          {[0, 1].map(i => (
            <div key={i} className="flex items-center gap-3 py-3 border-b border-d-border">
              <Sk className="h-7 w-7 rounded-full shrink-0" />
              <Sk className="h-3 w-28" />
              <Sk className="h-3 w-40" />
            </div>
          ))}
          <div className="pt-2 space-y-4">
            <div className="flex items-center gap-3">
              <Sk className="h-7 w-7 rounded-lg shrink-0" />
              <Sk className="h-4 w-36" />
            </div>
            <Sk className="h-24 w-full rounded-xl" />
            <Sk className="h-20 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
