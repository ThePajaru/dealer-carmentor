import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Car, Target, Compass, ChevronRight } from 'lucide-react';
import { getDealerProfileBySlug } from '@/lib/dealer-auth';

/**
 * Portada pública de captación del dealer — EL enlace que va en su bio.
 *
 * Las dos puertas se dividen por la CLARIDAD del cliente, no por el canal:
 *   /q/{slug}  "lo tengo claro"     → formulario de specs
 *   /a/{slug}  "ayúdame a elegir"   → asesor de 7 preguntas
 *
 * Server component a propósito: es la primera pantalla que ve tráfico frío de
 * Instagram, así que se renderiza con el nombre y el logo del dealer ya dentro
 * en vez de parpadear con un spinner mientras un useEffect va a buscarlos.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const dealer = await getDealerProfileBySlug(slug);
  if (!dealer) return { title: 'Página no encontrada' };

  const title = `${dealer.business_name} · Encuentra tu coche`;
  const description =
    'Te buscamos el coche en toda Europa, te lo analizamos y te lo traemos. Gratis y sin compromiso.';

  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
  };
}

export default async function DealerChooserPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const dealer = await getDealerProfileBySlug(slug);
  if (!dealer) notFound();

  const doors = [
    {
      href: `/q/${slug}`,
      icon: Target,
      title: 'LO TENGO CLARO',
      desc: 'Sé la marca y el modelo — o ya he visto anuncios que me gustan',
      badge: '2 min',
    },
    {
      href: `/a/${slug}`,
      icon: Compass,
      title: 'AYÚDAME A ELEGIR',
      desc: 'No sé qué coche me conviene. 7 preguntas y te lo decimos.',
      badge: '60 s',
    },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-paper text-navy [font-family:var(--font-body)]">
      <header className="flex items-center justify-center gap-3 px-4 pt-8">
        {dealer.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dealer.logo_url} alt="" className="h-10 w-10 rounded-lg object-cover" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy text-peri">
            <Car className="h-5 w-5" />
          </div>
        )}
        <span className="text-lg font-bold tracking-tight text-navy">{dealer.business_name}</span>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-[520px]">
          <h1 className="[font-family:var(--font-display-alt)] text-center text-[clamp(38px,10vw,56px)] leading-[0.94] tracking-[0.02em] text-navy">
            ¿QUÉ COCHE
            <br />
            TE TRAEMOS?
          </h1>
          <p className="mx-auto mt-3 max-w-[380px] text-center text-[14px] leading-[1.6] text-ink">
            Lo buscamos por ti en toda Europa, lo analizamos y te lo traemos con informe incluido.
          </p>

          <div className="mt-8 grid gap-3">
            {doors.map(({ href, icon: Icon, title, desc, badge }) => (
              <Link
                key={href}
                href={href}
                className="group flex items-center gap-3.5 rounded-[14px] border border-peri/55 bg-white p-4 shadow-[0_8px_24px_rgba(4,33,82,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:border-mid hover:shadow-[0_14px_34px_rgba(4,33,82,0.10)]"
              >
                <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-peri/25 text-navy">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block [font-family:var(--font-display-alt)] text-[23px] leading-none tracking-[0.02em] text-navy">
                    {title}
                  </span>
                  <span className="mt-1 block text-[12.5px] leading-[1.45] text-ink">{desc}</span>
                </span>
                <span className="shrink-0 [font-family:var(--font-mono)] text-[9px] uppercase tracking-[0.1em] text-mid">
                  {badge}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-mid transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>

          <div className="mt-7 flex flex-wrap justify-center gap-2">
            {['Gratis', 'Sin registro', 'Respuesta en 24 h'].map((t) => (
              <span
                key={t}
                className="rounded-full border border-peri/60 bg-paper px-3 py-1.5 text-[12.5px] font-semibold text-ink"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      </main>

      <footer className="px-6 pb-8 text-center [font-family:var(--font-mono)] text-[10px] uppercase tracking-[0.1em] text-mid">
        Sin compromiso · Impulsado por CarMentor Dealer
      </footer>
    </div>
  );
}
