import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Public (no-auth) client-facing tracking: "your car is on its way". Keyed by an
// unguessable tracking_token on the job. Car + transit milestones + ETA only —
// no prices, no dealer economics.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const { data: job } = await supabase
    .from('dealer_client_requests')
    .select('id, dealer_id, client_name, stage, delivery_eta, transit_progress, runner_packet, runner_report')
    .eq('tracking_token', token)
    .maybeSingle();

  if (!job) return NextResponse.json({ error: 'Seguimiento no encontrado' }, { status: 404 });

  // The bought car: the runner packet's lead, else a shortlisted lead.
  const leadId = (job as any).runner_packet?.lead_id;
  let leadQuery = supabase
    .from('dealer_leads')
    .select('car_analyses(title, car_image_url, result_json)')
    .eq('client_request_id', (job as any).id);
  leadQuery = leadId ? leadQuery.eq('id', leadId) : leadQuery.eq('is_shortlisted', true);
  const { data: leads } = await leadQuery.limit(1);
  const lead: any = leads?.[0];

  const ca: any = Array.isArray(lead?.car_analyses) ? lead.car_analyses[0] : lead?.car_analyses;
  const rj: any = ca?.result_json || {};
  const images: string[] = Array.isArray(rj.car_images) ? rj.car_images.filter((u: unknown) => typeof u === 'string') : [];

  const { data: dealer } = await supabase.from('dealer_profiles').select('business_name, logo_url').eq('id', (job as any).dealer_id).maybeSingle();

  // Curated, buyer-safe proof-of-inspection. NEVER exposes verdict, negotiated price,
  // per-item pass/fail grades or issue notes — only that it happened + the proof photos.
  const rep: any = (job as any).runner_report;
  let inspection: { date: string | null; pointsChecked: number; photos: { label: string; url: string }[] } | null = null;
  if (rep?.submitted_at) {
    const items: any[] = Array.isArray(rep.items) ? rep.items : [];
    const pointsChecked = items.filter(it => it?.status && it.status !== 'na').length
      + (Array.isArray(rep.dealbreakers) ? rep.dealbreakers.length : 0);
    const photos = (Array.isArray(rep.photos) ? rep.photos : [])
      .filter((p: any) => typeof p?.url === 'string')
      .map((p: any) => ({ label: String(p.label || ''), url: p.url }));
    inspection = { date: rep.submitted_at, pointsChecked, photos };
  }

  return NextResponse.json({
    tracking: {
      dealer: (dealer as any)?.business_name || null,
      dealerLogo: (dealer as any)?.logo_url || null,
      clientName: (job as any).client_name || null,
      car: {
        title: ca?.title || 'Tu coche',
        hero: images[0] || ca?.car_image_url || null,
      },
      stage: (job as any).stage,
      deliveryEta: (job as any).delivery_eta || null,
      progress: (job as any).transit_progress || {},
      inspection,
    },
  });
}
