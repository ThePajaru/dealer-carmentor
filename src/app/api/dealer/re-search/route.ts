import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmailDirect, renderReSearchEmail } from '@/lib/dealer-notifications';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const STALE_DAYS = 7;

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Find active client requests not updated in 7+ days
  const { data: staleRequests } = await supabase
    .from('dealer_client_requests')
    .select('id, dealer_id, client_name, make, model, mobile_url, updated_at')
    .in('status', ['nuevo', 'buscando'])
    .is('deleted_at', null)
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(50);

  if (!staleRequests?.length) {
    return NextResponse.json({ ok: true, notified: 0 });
  }

  // Group by dealer
  const byDealer: Record<string, typeof staleRequests> = {};
  for (const req of staleRequests) {
    if (!byDealer[req.dealer_id]) byDealer[req.dealer_id] = [];
    byDealer[req.dealer_id].push(req);
  }

  let notified = 0;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://carmentor.es';

  for (const [dealerId, requests] of Object.entries(byDealer)) {
    const { data: dealer } = await supabase
      .from('dealer_profiles')
      .select('id, business_name, email, notify_email, notify_new_request')
      .eq('id', dealerId)
      .single();

    if (!dealer) continue;
    if (dealer.notify_new_request === false) continue;

    const dealerEmail = dealer.notify_email || dealer.email;
    if (!dealerEmail) continue;

    // Send one email per stale client (max 5 per dealer)
    for (const req of requests.slice(0, 5)) {
      const daysSince = Math.floor((Date.now() - new Date(req.updated_at).getTime()) / (24 * 60 * 60 * 1000));

      const html = renderReSearchEmail({
        dealerName: dealer.business_name,
        clientName: req.client_name,
        make: req.make,
        model: req.model,
        mobileUrl: req.mobile_url,
        daysSinceLastActivity: daysSince,
        dashboardUrl: `${baseUrl}/dealer/clientes/${req.id}`,
      });

      const carDesc = [req.make, req.model].filter(Boolean).join(' ');
      try {
        await sendEmailDirect({
          to: dealerEmail,
          subject: `Recordatorio: ${req.client_name} sigue buscando${carDesc ? ` un ${carDesc}` : ''}`,
          html,
        });
        notified++;
      } catch (err) {
        console.error(`Re-search email error for ${req.id}:`, err);
      }
    }
  }

  return NextResponse.json({ ok: true, notified, staleCount: staleRequests.length });
}
