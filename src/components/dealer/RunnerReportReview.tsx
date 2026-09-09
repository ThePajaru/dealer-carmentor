import { ShieldCheck, Ban, AlertTriangle, Camera } from 'lucide-react';

// The field report the runner submits from Germany, saved on
// dealer_client_requests.runner_report by /api/dealer/runner/[token].
export interface RunnerReport {
  submitted_at: string;
  verdict: 'comprar' | 'no_comprar' | null;
  final_price: number | null;
  real_km: number | null;
  notes: string;
  items: { id: string; title: string; phase: string; status: 'ok' | 'issue' | 'na'; note: string; photo_url: string | null }[];
  dealbreakers: { text: string; status: 'ok' | 'present' }[];
  photos: { label: string; url: string }[];
  observations?: { step: string; title: string; text: string }[];
}

/** Dealer-side review of the field report the runner submitted from Germany. */
export default function RunnerReportReview({ report }: { report: RunnerReport }) {
  const issues = report.items.filter(i => i.status === 'issue');
  const okCount = report.items.filter(i => i.status === 'ok').length;
  const dbPresent = report.dealbreakers.filter(d => d.status === 'present');
  const buy = report.verdict === 'comprar';
  return (
    <div className="mt-4 rounded-xl border border-d-border p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-d-text flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-d-accent" /> Inspección del runner</h4>
        {report.verdict && (
          <span className={`text-xs font-semibold px-2 py-1 rounded-md ${buy ? 'bg-d-green/15 text-d-green' : 'bg-d-red/15 text-d-red'}`}>
            {buy ? 'Comprar' : 'No comprar'}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {okCount > 0 && <span className="d-pill text-d-green">{okCount} OK</span>}
        {issues.length > 0 && <span className="d-pill text-d-amber">{issues.length} observaciones</span>}
        {report.real_km != null && <span className="d-pill"><span className="text-d-dim mr-1">Km reales:</span><span className="d-num">{report.real_km.toLocaleString('es-ES')}</span></span>}
        {report.final_price != null && <span className="d-pill"><span className="text-d-dim mr-1">Precio final:</span><span className="d-num">€{report.final_price.toLocaleString('es-ES')}</span></span>}
      </div>

      {dbPresent.length > 0 && (
        <div className="rounded-lg border border-d-red/30 bg-d-red/5 p-2.5">
          <p className="text-d-red text-xs font-semibold flex items-center gap-1.5 mb-1"><Ban className="w-3.5 h-3.5" /> Dealbreaker presente</p>
          {dbPresent.map((d, i) => <p key={i} className="text-d-text-2 text-xs">• {d.text}</p>)}
        </div>
      )}

      {issues.length > 0 && (
        <div className="space-y-1.5">
          {issues.map((it, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 text-d-amber shrink-0 mt-0.5" />
              <span className="text-d-text-2"><span className="text-d-text font-medium">{it.title}</span>{it.note ? ` — ${it.note}` : ''}</span>
            </div>
          ))}
        </div>
      )}

      {(report.observations || []).length > 0 && (
        <div className="space-y-1.5">
          {report.observations!.map((o, i) => (
            <p key={i} className="text-xs text-d-text-2 border-l-2 border-d-border pl-2">
              <span className="text-d-dim">{o.title}:</span> {o.text}
            </p>
          ))}
        </div>
      )}

      {report.notes && <p className="text-d-muted text-xs italic border-l-2 border-d-border pl-2">“{report.notes}”</p>}

      {report.photos.length > 0 && (
        <div>
          <p className="text-d-dim text-[11px] mb-1.5 flex items-center gap-1"><Camera className="w-3 h-3" /> {report.photos.length} fotos</p>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
            {report.photos.map((p, i) => (
              <a key={i} href={p.url} target="_blank" rel="noopener" className="relative aspect-square rounded-md overflow-hidden border border-d-border">
                <img src={p.url} alt={p.label} className="w-full h-full object-cover" />
              </a>
            ))}
          </div>
        </div>
      )}
      <p className="text-d-dim text-[11px]">Enviada {new Date(report.submitted_at).toLocaleString('es-ES')}</p>
    </div>
  );
}
