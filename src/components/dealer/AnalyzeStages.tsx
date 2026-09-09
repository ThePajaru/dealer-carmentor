'use client';

import { Fragment } from 'react';
import { Check, FileSearch, LineChart, Sparkles } from 'lucide-react';

// The analyze SSE stream emits emoji-tagged progress strings; map them onto three
// human stages so the loader reads like a pipeline instead of a spinner.
export const ANALYZE_STAGES = [
  { key: 'read', label: 'Leyendo el anuncio', icon: FileSearch },
  { key: 'market', label: 'Precios de mercado', icon: LineChart },
  { key: 'ai', label: 'Análisis experto', icon: Sparkles },
] as const;

/** Active stage index (0-2), or -1 while still queued. */
export function stageFromProgress(msg: string): number {
  const s = (msg || '').toLowerCase();
  if (/en cola/.test(s)) return -1;
  if (/mercado|precios/.test(s)) return 1;
  if (/generando|experto|impuesto|completad/.test(s)) return 2;
  return 0; // iniciando / descargando ficha / detectado / reintentando
}

/**
 * The staged progress strip shared by both places a dealer starts an analysis
 * (the workbench and a client's case). An analysis takes 12–36s: a bare spinner
 * next to the button read as "nothing happened" until the car appeared further
 * down the page.
 */
export function AnalyzeStages({ progress }: { progress: string }) {
  const stage = stageFromProgress(progress);
  const queued = stage < 0;
  return (
    <>
      <div className="flex items-center">
        {ANALYZE_STAGES.map((st, i) => {
          const state = queued ? 'pending' : i < stage ? 'done' : i === stage ? 'active' : 'pending';
          const Icon = st.icon;
          return (
            <Fragment key={st.key}>
              <div className={`d-stage ${state === 'active' ? 'is-active' : state === 'done' ? 'is-done' : ''}`}>
                <span className="d-stage-ic">
                  {state === 'done' ? <Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                </span>
                <span className="hidden sm:inline">{st.label}</span>
              </div>
              {i < ANALYZE_STAGES.length - 1 && <span className={`d-stage-line ${!queued && i < stage ? 'is-done' : ''}`} />}
            </Fragment>
          );
        })}
      </div>
      <div className="d-indet mt-3" />
      <p className="text-xs text-d-muted mt-2 truncate">{progress || 'Analizando…'}</p>
    </>
  );
}

/** Full analyzing card: thumbnail skeleton + header + the stage strip. */
export function AnalyzingCard({ progress, subtitle }: { progress: string; subtitle?: string }) {
  const queued = stageFromProgress(progress) < 0;
  return (
    <div className="d-analyzing rounded-xl border border-d-border bg-d-surface p-4">
      <div className="flex gap-4">
        <div className="w-20 h-14 sm:w-24 sm:h-16 rounded-lg d-shimmer shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-d-accent animate-pulse-slow shrink-0" />
            <span className="text-sm text-d-text font-medium">{queued ? 'En cola…' : 'Analizando'}</span>
            {subtitle && <span className="text-xs text-d-dim truncate">{subtitle}</span>}
          </div>
          <div className="mt-3"><AnalyzeStages progress={progress} /></div>
        </div>
      </div>
    </div>
  );
}
