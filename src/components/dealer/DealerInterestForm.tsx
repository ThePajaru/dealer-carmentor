'use client';

import { useState } from 'react';
import { ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';

const VOLUMENES = [
  'Aún no importo, quiero empezar',
  '1–5 coches al mes',
  '5–15 coches al mes',
  '15–40 coches al mes',
  'Más de 40 coches al mes',
];

const INPUT =
  'w-full rounded-[10px] border border-peri/50 bg-white px-3.5 py-2.5 text-[14px] text-navy placeholder:text-ink/50 outline-none transition-colors focus:border-mid focus:ring-2 focus:ring-mid/20';
const LABEL = 'mb-1.5 block text-[12px] font-semibold text-navy';

export default function DealerInterestForm() {
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === 'sending') return;
    const fd = new FormData(e.currentTarget);
    const payload = Object.fromEntries(fd.entries());
    setStatus('sending');
    setError('');
    try {
      const res = await fetch('/api/dealer/interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || 'No se pudo enviar. Inténtalo de nuevo.');
        setStatus('error');
        return;
      }
      setStatus('done');
    } catch {
      setError('No se pudo enviar. Revisa tu conexión e inténtalo de nuevo.');
      setStatus('error');
    }
  }

  if (status === 'done') {
    return (
      <div className="rounded-[16px] border border-verdict/30 bg-white p-8 text-center shadow-[0_20px_50px_rgba(4,33,82,0.08)]">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-verdict/12 text-verdict">
          <CheckCircle2 size={30} />
        </div>
        <h3 className="[font-family:var(--font-display-alt)] text-[30px] tracking-[0.02em] text-navy">
          ¡RECIBIDO!
        </h3>
        <p className="mx-auto mt-2 max-w-[340px] text-[14px] leading-[1.6] text-ink">
          Te escribimos en menos de 24 h para enseñarte CarMentor Dealer con un coche real tuyo. Sin
          compromiso.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[16px] border border-peri/40 bg-white p-6 shadow-[0_20px_50px_rgba(4,33,82,0.08)] sm:p-8"
    >
      {/* honeypot */}
      <input
        type="text"
        name="company_website"
        tabIndex={-1}
        autoComplete="off"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
        aria-hidden="true"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="nombre">
            Tu nombre *
          </label>
          <input id="nombre" name="nombre" required className={INPUT} placeholder="Nombre y apellido" />
        </div>
        <div>
          <label className={LABEL} htmlFor="empresa">
            Nombre de tu compraventa
          </label>
          <input id="empresa" name="empresa" className={INPUT} placeholder="Ej. Automóviles García" />
        </div>
        <div>
          <label className={LABEL} htmlFor="telefono">
            Teléfono / WhatsApp *
          </label>
          <input
            id="telefono"
            name="telefono"
            type="tel"
            className={INPUT}
            placeholder="+34 600 000 000"
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="email">
            Email
          </label>
          <input id="email" name="email" type="email" className={INPUT} placeholder="tu@email.com" />
        </div>
        <div>
          <label className={LABEL} htmlFor="ciudad">
            Ciudad
          </label>
          <input id="ciudad" name="ciudad" className={INPUT} placeholder="Ej. Valencia" />
        </div>
        <div>
          <label className={LABEL} htmlFor="volumen">
            ¿Cuánto importas?
          </label>
          <select id="volumen" name="volumen" defaultValue="" className={INPUT}>
            <option value="" disabled>
              Selecciona…
            </option>
            {VOLUMENES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4">
        <label className={LABEL} htmlFor="mensaje">
          ¿Algo que quieras contarnos? (opcional)
        </label>
        <textarea
          id="mensaje"
          name="mensaje"
          rows={3}
          className={`${INPUT} resize-none`}
          placeholder="Qué coches sueles traer, qué te gustaría resolver…"
        />
      </div>

      <p className="mt-1.5 text-[11px] text-ink">* Nombre y un teléfono o email son obligatorios.</p>

      {status === 'error' && (
        <p className="mt-3 rounded-[10px] bg-red-50 px-3 py-2 text-[13px] font-medium text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'sending'}
        className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-navy px-6 py-3.5 text-[15px] font-bold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-mid disabled:cursor-not-allowed disabled:opacity-70"
      >
        {status === 'sending' ? (
          <>
            <Loader2 size={17} className="animate-spin" /> Enviando…
          </>
        ) : (
          <>
            Solicitar acceso <ArrowRight size={17} />
          </>
        )}
      </button>
      <p className="mt-3 text-center text-[12px] text-ink">
        Te contactamos en menos de 24 h. Sin compromiso, sin tarjeta.
      </p>
    </form>
  );
}
