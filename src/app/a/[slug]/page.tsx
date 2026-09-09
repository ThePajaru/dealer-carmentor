import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDealerProfileBySlug } from '@/lib/dealer-auth';
import AdvisorFlow from '@/components/dealer/AdvisorFlow';

/** Puerta B de la captación — «no sé qué coche necesito». */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const dealer = await getDealerProfileBySlug(slug);
  if (!dealer) return { title: 'Página no encontrada' };

  const title = `${dealer.business_name} · ¿Qué coche te conviene?`;
  const description =
    '7 preguntas sobre tu día a día y te decimos qué tipo de coche te encaja y tres modelos concretos. Gratis y sin registro.';

  return { title, description, openGraph: { title, description, type: 'website' } };
}

export default async function AdvisorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const dealer = await getDealerProfileBySlug(slug);
  if (!dealer) notFound();

  return <AdvisorFlow slug={slug} />;
}
