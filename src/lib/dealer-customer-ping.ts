import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyCustomerMilestone } from './dealer-notifications';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Milestone = 'inspeccion' | 'comprado' | 'en_transporte' | 'en_espana' | 'entregado';

// Send a customer email for a pipeline milestone, exactly once per (request, milestone).
// Idempotency is tracked in dealer_client_requests.customer_notified. Mints a tracking
// token if the dealer hasn't shared one yet, so the CTA link always works. Silently
// no-ops when there's no customer email on file. Never throws — email is best-effort.
export async function sendCustomerPing(
  supabase: SupabaseClient,
  requestId: string,
  milestone: Milestone,
): Promise<void> {
  try {
    const { data: job } = await supabase
      .from('dealer_client_requests')
      .select('id, dealer_id, client_name, client_email, tracking_token, customer_notified, runner_packet, is_shortlisted')
      .eq('id', requestId)
      .maybeSingle();

    if (!job) return;
    const notified: Record<string, boolean> = (job as any).customer_notified || {};
    if (notified[milestone]) return;                 // already sent
    const to = (job as any).client_email;
    if (!to) return;                                 // no email → can't ping (don't mark, allow later)

    // Ensure a tracking token exists for the CTA link.
    let trackingToken: string | null = (job as any).tracking_token || null;
    if (!trackingToken) {
      trackingToken = crypto.randomUUID().replace(/-/g, '');
      await supabase.from('dealer_client_requests').update({ tracking_token: trackingToken }).eq('id', requestId);
    }

    // Dealer branding + the bought/shortlisted car.
    const leadId = (job as any).runner_packet?.lead_id;
    let leadQuery = supabase
      .from('dealer_leads')
      .select('car_analyses(title, car_image_url, result_json)')
      .eq('client_request_id', requestId);
    leadQuery = leadId ? leadQuery.eq('id', leadId) : leadQuery.eq('is_shortlisted', true);
    const [{ data: leads }, { data: dealer }] = await Promise.all([
      leadQuery.limit(1),
      supabase.from('dealer_profiles').select('business_name, logo_url').eq('id', (job as any).dealer_id).maybeSingle(),
    ]);
    const ca: any = Array.isArray((leads as any)?.[0]?.car_analyses) ? (leads as any)[0].car_analyses[0] : (leads as any)?.[0]?.car_analyses;
    const rj: any = ca?.result_json || {};
    const images: string[] = Array.isArray(rj.car_images) ? rj.car_images.filter((u: unknown) => typeof u === 'string') : [];

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://carmentor.es';
    const sent = await notifyCustomerMilestone({
      to,
      dealerName: (dealer as any)?.business_name || 'Tu concesionario',
      dealerLogo: (dealer as any)?.logo_url || null,
      clientName: (job as any).client_name || null,
      carTitle: ca?.title || 'Tu coche',
      carImage: images[0] || ca?.car_image_url || null,
      milestone,
      trackingUrl: `${baseUrl}/seguimiento/${trackingToken}`,
    });

    if (sent) {
      await supabase
        .from('dealer_client_requests')
        .update({ customer_notified: { ...notified, [milestone]: true } })
        .eq('id', requestId);
    }
  } catch (err) {
    console.error('sendCustomerPing failed:', err);
  }
}
