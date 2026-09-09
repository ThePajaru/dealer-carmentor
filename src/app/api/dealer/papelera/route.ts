import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDealerAuth, AuthError } from '@/lib/dealer-auth';

// The Papelera: operaciones the dealer soft-deleted (deleted_at set). Restorable
// or permanently removable from /dealer/papelera. Mirrors the Operaciones read,
// but inverted on deleted_at and trimmed to what the trash list needs.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);

    const { data, error } = await supabase
      .from('dealer_client_requests')
      .select(`id, client_name, stage, make, model, deleted_at,
               dealer_leads ( id, is_shortlisted, deleted_at, car_analyses ( title, car_image_url ) )`)
      .eq('dealer_id', dealerProfile.id)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });

    if (error) {
      console.error('papelera error:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al cargar la papelera' }, { status: 500 });
    }

    const items = (data || []).map((j: any) => {
      const leads = (Array.isArray(j.dealer_leads) ? j.dealer_leads : []).filter((l: any) => !l.deleted_at);
      const rep = leads.find((l: any) => l.is_shortlisted) || leads[0];
      const caRaw: any = rep?.car_analyses;
      const ca = Array.isArray(caRaw) ? caRaw[0] : caRaw;
      const carTitle = ca?.title
        || [j.make, j.model].filter(Boolean).join(' ')
        || null;
      return {
        id: j.id,
        client_name: j.client_name,
        stage: j.stage || 'solicitud',
        deleted_at: j.deleted_at,
        car: { title: carTitle, image: ca?.car_image_url || null },
      };
    });

    return NextResponse.json({ items });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
