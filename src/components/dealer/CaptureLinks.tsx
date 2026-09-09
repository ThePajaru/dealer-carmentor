'use client';

import { useState } from 'react';
import { useDealer } from '@/hooks/useDealer';
import { Copy, Check, ExternalLink, DoorOpen, Target, Compass, MessageCircle } from 'lucide-react';
import { publicOrigin, publicHost } from '@/lib/public-url';

/**
 * Los enlaces públicos de captación del dealer.
 *
 * UNO principal y dos secundarios, a propósito: si los tres pesan lo mismo el
 * dealer tiene que decidir cuál pone en su bio, y esa decisión no debería
 * existir. La portada /c/{slug} contiene las dos puertas y el cliente se
 * clasifica solo; los directos son para mandar a mano por WhatsApp cuando el
 * dealer ya sabe cómo está ese cliente concreto.
 *
 *   /c/{slug}  portada con las dos puertas  → el de la bio
 *   /q/{slug}  "lo tengo claro"             → formulario de specs
 *   /a/{slug}  "ayúdame a elegir"           → asesor de 7 preguntas
 *
 * Self-contained: lee el slug del DealerProvider, así que se puede soltar en
 * cualquier punto del árbol /dealer/(app). Sin slug no renderiza nada.
 */
export default function CaptureLinks({
  className = '',
  card = true,
  heading = true,
}: {
  className?: string;
  /** Envolver en el shell d-card estándar (off cuando va dentro de un modal). */
  card?: boolean;
  /** Mostrar el título + blurb propios (off si el contenedor ya los tiene). */
  heading?: boolean;
}) {
  const { dealerProfile } = useDealer();
  const slug = dealerProfile?.slug;
  const [copied, setCopied] = useState<string | null>(null);

  if (!slug) return null;

  // Siempre el dominio público: el dealer pega esto en su bio de Instagram, así
  // que un localhost aquí sería un enlace muerto de cara a sus clientes.
  const origin = publicOrigin();
  const display = publicHost();

  const copy = (key: string, url: string) => {
    navigator.clipboard?.writeText(url);
    setCopied(key);
    setTimeout(() => setCopied(c => (c === key ? null : c)), 1600);
  };

  const mainPath = `c/${slug}`;
  const mainUrl = `${origin}/${mainPath}`;

  const directs = [
    {
      key: 'q',
      path: `q/${slug}`,
      icon: Target,
      label: 'directo al formulario',
    },
    {
      key: 'a',
      path: `a/${slug}`,
      icon: Compass,
      label: 'directo al asesor',
    },
  ];

  const shareText = encodeURIComponent(
    `Te busco el coche que quieras en toda Europa, te lo analizo y te lo traigo. Cuéntame qué buscas aquí: ${mainUrl}`,
  );

  const inner = (
    <>
      {heading && (
        <>
          <h3 className="text-d-text text-base font-semibold">Tu enlace de captación</h3>
          <p className="text-d-muted text-sm mt-1 mb-4">
            Este es el que va en tu bio de Instagram, tu web y tu WhatsApp Business. El cliente elige su
            puerta y la solicitud cae directa en Operaciones.
          </p>
        </>
      )}

      {/* Principal — la portada con las dos puertas */}
      <div className="rounded-xl border border-d-accent/45 bg-gradient-to-b from-d-accent/10 to-transparent p-3.5">
        <div className="flex items-start gap-3">
          <div className="d-ic w-9 h-9 rounded-lg shrink-0">
            <DoorOpen className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-d-text text-sm font-semibold leading-tight">Tu portada de captación</p>
            <p className="text-d-dim text-xs mt-0.5">
              Dos puertas: «lo tengo claro» y «ayúdame a elegir». Cada cliente entra por la suya.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-d-accent/40 px-2 py-0.5 text-[9px] uppercase tracking-[0.1em] text-d-accent d-num">
            Para la bio
          </span>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <code className="text-d-accent bg-d-bg border border-d-border px-3 py-2 rounded-lg text-xs sm:text-sm flex-1 min-w-0 truncate d-num">
            {display}/{mainPath}
          </code>
          <button
            onClick={() => copy('c', mainUrl)}
            className="d-btn-ghost inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs shrink-0"
          >
            {copied === 'c' ? (
              <><Check className="w-3.5 h-3.5 text-d-green" /> Copiado</>
            ) : (
              <><Copy className="w-3.5 h-3.5" /> Copiar</>
            )}
          </button>
          <a
            href={`/${mainPath}`}
            target="_blank"
            rel="noopener"
            className="d-btn-ghost inline-flex items-center px-2.5 py-2 rounded-lg shrink-0"
            title="Abrir"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        <a
          href={`https://wa.me/?text=${shareText}`}
          target="_blank"
          rel="noopener"
          className="d-btn-ghost mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-xs"
        >
          <MessageCircle className="w-3.5 h-3.5" /> Enviar por WhatsApp
        </a>
      </div>

      {/* Directos — para mandar a mano a un cliente concreto */}
      <div className="mt-3.5 border-t border-d-border pt-3">
        {directs.map(({ key, path, icon: Icon, label }) => {
          const url = `${origin}/${path}`;
          return (
            <div key={key} className="flex items-center gap-2 py-1.5">
              <Icon className="w-4 h-4 shrink-0 text-d-dim" />
              <code className="min-w-0 flex-1 truncate text-[11px] text-d-muted d-num">
                {display}/{path}
              </code>
              <span className="shrink-0 text-[10.5px] text-d-dim hidden sm:inline">{label}</span>
              <button
                onClick={() => copy(key, url)}
                className="d-btn-ghost inline-flex items-center px-2 py-1.5 rounded-lg shrink-0"
                title={`Copiar enlace ${label}`}
              >
                {copied === key ? (
                  <Check className="w-3.5 h-3.5 text-d-green" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          );
        })}
        <p className="text-d-dim text-[11px] leading-relaxed mt-2">
          <span className="text-d-text-2">¿Cuándo usar los directos?</span> Al que te pregunta «¿qué coche me
          compro?» mándale el asesor; al que te dice «quiero un Tiguan», el formulario.
        </p>
      </div>
    </>
  );

  if (!card) return <div className={className}>{inner}</div>;
  return <div className={`d-card d-card-hl p-5 ${className}`}>{inner}</div>;
}
