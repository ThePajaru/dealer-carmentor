import type { Metadata } from 'next';
import QuestionnaireV2 from '@/components/dealer/QuestionnaireV2';

// V2 del formulario público de captación de leads, con el branding CarMentor
// (claro, una sola página) en vez del wizard oscuro de /q/[slug]. Ruta oculta:
// nadie enlaza aquí y va con noindex hasta que se decida lanzarla.
export const metadata: Metadata = {
  title: 'Encuentra tu coche',
  robots: { index: false, follow: false },
};

export default async function QuestionnaireV2Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <QuestionnaireV2 slug={slug} />;
}
