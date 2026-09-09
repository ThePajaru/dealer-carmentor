import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDealerAuth, AuthError } from '@/lib/dealer-auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);

    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const trash = url.searchParams.get('trash') === '1';
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    let query = supabase
      .from('dealer_leads')
      .select('*, car_analyses(title, car_image_url, result_json, source_url, country_of_origin)', { count: 'exact' })
      .eq('dealer_id', dealerProfile.id)
      .order(trash ? 'deleted_at' : 'created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (trash) {
      query = query.not('deleted_at', 'is', null);
    } else {
      query = query.is('deleted_at', null);
      if (status && status !== 'todos') {
        query = query.eq('status', status);
      }
    }

    const { data, count, error } = await query;

    if (error) {
      console.error('Error fetching leads:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al obtener leads' }, { status: 500 });
    }

    return NextResponse.json({ leads: data || [], total: count || 0 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);

    let body: { client_name?: string; client_phone?: string; client_email?: string; source_url: string; notes?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (!body.source_url?.trim()) {
      return NextResponse.json({ error: 'source_url es obligatorio' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('dealer_leads')
      .insert({
        dealer_id: dealerProfile.id,
        client_name: body.client_name || null,
        client_phone: body.client_phone || null,
        client_email: body.client_email || null,
        source_url: body.source_url.trim(),
        notes: body.notes || null,
        source: 'manual',
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating lead:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al crear lead' }, { status: 500 });
    }

    return NextResponse.json({ lead: data }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
