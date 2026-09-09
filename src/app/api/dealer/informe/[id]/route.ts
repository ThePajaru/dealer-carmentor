import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { toClientResultJson } from '@/lib/analysis-view';

// Public (no-auth) endpoint: returns a client-facing analysis report for a
// dealer_lead that the dealer explicitly shared (is_shared=true). The lead id is
// an unguessable UUID and economics are stripped server-side.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data: lead } = await supabase
    .from('dealer_leads')
    .select('id, client_name, analysis_id, dealer_id, is_shared')
    .eq('id', id)
    .eq('is_shared', true)
    .maybeSingle();

  if (!lead || !lead.analysis_id) {
    return NextResponse.json({ error: 'Informe no encontrado o no disponible' }, { status: 404 });
  }

  const [{ data: analysis }, { data: dealer }] = await Promise.all([
    supabase
      .from('car_analyses')
      .select('title, car_image_url, result_json, source_url, country_of_origin')
      .eq('id', lead.analysis_id)
      .maybeSingle(),
    supabase
      .from('dealer_profiles')
      .select('business_name, logo_url, phone, whatsapp, email')
      .eq('id', lead.dealer_id)
      .maybeSingle(),
  ]);

  if (!analysis) {
    return NextResponse.json({ error: 'Informe no encontrado o no disponible' }, { status: 404 });
  }

  return NextResponse.json({
    informe: {
      client_name: lead.client_name,
      car: {
        title: analysis.title,
        car_image_url: analysis.car_image_url,
        country_of_origin: analysis.country_of_origin,
        result_json: toClientResultJson(analysis.result_json),
      },
      dealer,
    },
  });
}
