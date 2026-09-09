import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDealerAuth, AuthError } from '@/lib/dealer-auth';

// Feeds the Revisiones page: every operation whose runner has submitted a field
// report (dealer_client_requests.runner_report is set), with a representative car
// so the dealer sees all in-person inspections in one place.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);

    const { data, error } = await supabase
      .from('dealer_client_requests')
      .select(`id, client_name, stage, runner_report, runner_packet, updated_at,
               dealer_leads ( id, is_shortlisted, deleted_at, car_analyses ( title, car_image_url, source_url ) )`)
      .eq('dealer_id', dealerProfile.id)
      .is('deleted_at', null)
      .not('runner_report', 'is', null);

    if (error) {
      console.error('revisiones error:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al cargar revisiones' }, { status: 500 });
    }

    const reports = (data || []).map((j: any) => {
      const leads = (Array.isArray(j.dealer_leads) ? j.dealer_leads : []).filter((l: any) => !l.deleted_at);
      // Representative car: the lead the runner actually inspected (packet lead_id),
      // else the shortlisted one, else the first available.
      const leadId = j.runner_packet?.lead_id;
      const rep = leads.find((l: any) => l.id === leadId)
        || leads.find((l: any) => l.is_shortlisted)
        || leads[0];
      const caRaw: any = rep?.car_analyses;
      const ca = Array.isArray(caRaw) ? caRaw[0] : caRaw;

      return {
        id: j.id,
        client_name: j.client_name,
        stage: j.stage || 'solicitud',
        updated_at: j.updated_at,
        car: ca ? { title: ca.title, image: ca.car_image_url, source_url: ca.source_url } : null,
        report: j.runner_report,
      };
    });

    // Newest inspection first (report.submitted_at, falling back to updated_at).
    reports.sort((a: any, b: any) => {
      const ta = new Date(a.report?.submitted_at || a.updated_at).getTime();
      const tb = new Date(b.report?.submitted_at || b.updated_at).getTime();
      return tb - ta;
    });

    return NextResponse.json({ reports });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
