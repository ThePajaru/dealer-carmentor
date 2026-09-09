import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDealerProfileBySlug } from '@/lib/dealer-auth';
import QuestionnaireV2 from '@/components/dealer/QuestionnaireV2';

/**
 * Puerta A de la captación — «ya sé qué coche quiero».
 *
 * Antes servía el wizard oscuro (VehicleQuestionnaire). Ahora sirve el
 * formulario claro de marca — el mismo componente que el alta interna de
 * operaciones (NewOperationModal), que lo monta con `onSubmit` en vez de slug.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const dealer = await getDealerProfileBySlug(slug);
  if (!dealer) return { title: 'Página no encontrada' };

  return {
    title: `${dealer.business_name} · Dinos qué coche quieres`,
    description: 'Te buscamos el coche en toda Europa, te lo analizamos y te lo traemos.',
  };
}

export default async function QuestionnairePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const dealer = await getDealerProfileBySlug(slug);
  if (!dealer) notFound();

  return <QuestionnaireV2 slug={slug} />;
}
