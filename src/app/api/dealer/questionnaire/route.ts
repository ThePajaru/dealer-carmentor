import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getDealerProfileBySlug } from '@/lib/dealer-auth';
import { normalizeVehicles, flatFromVehicles, type Vehicle } from '@/lib/dealer-vehicles';
import { notifyDealerNewClient } from '@/lib/dealer-notifications';
import { logDealerEvent } from '@/lib/dealer/events';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(request: NextRequest) {
  let body: {
    slug: string;
    client_name: string;
    client_phone?: string;
    client_email?: string;
    // New: array of vehicle profiles the customer has in mind. Falls back to the
    // flat single-spec fields below when absent (legacy payloads).
    vehicles?: Vehicle[];
    make?: string;
    make_id?: number;
    model?: string;
    model_id?: number;
    model_ms?: string;
    max_price?: number;
    max_km?: number;
    min_year?: number;
    fuel?: string;
    transmission?: string;
    min_cv?: number;
    color?: string;
    body_type?: string;
    extras?: string[];
    notes?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.slug?.trim() || !body.client_name?.trim()) {
    return NextResponse.json({ error: 'slug y nombre son obligatorios' }, { status: 400 });
  }

  const dealer = await getDealerProfileBySlug(body.slug.trim());
  if (!dealer) {
    return NextResponse.json({ error: 'Dealer no encontrado' }, { status: 404 });
  }

  // Normalize into N vehicle profiles (each with its own mobile.de URL) and
  // mirror vehicles[0] back to the flat columns for backward-compatible reads.
  const vehicles = normalizeVehicles(body);
  const flat = flatFromVehicles(vehicles);

  // Auto-group by phone
  let clientId: string | null = null;
  const phone = body.client_phone?.trim() || null;

  if (phone) {
    const { data: existing } = await supabase
      .from('dealer_clients')
      .select('id')
      .eq('dealer_id', dealer.id)
      .eq('phone', phone)
      .single();

    if (existing) {
      clientId = existing.id;
      await supabase
        .from('dealer_clients')
        .update({ name: body.client_name.trim(), email: body.client_email?.trim() || undefined, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      const { data: newClient } = await supabase
        .from('dealer_clients')
        .insert({
          dealer_id: dealer.id,
          name: body.client_name.trim(),
          phone,
          email: body.client_email?.trim() || null,
        })
        .select('id')
        .single();
      clientId = newClient?.id || null;
    }
  }

  const { data: clientRequest, error: insertError } = await supabase
    .from('dealer_client_requests')
    .insert({
      dealer_id: dealer.id,
      client_id: clientId,
      client_name: body.client_name.trim(),
      client_phone: phone,
      client_email: body.client_email?.trim() || null,
      vehicles,
      make: flat.make,
      make_id: flat.make_id,
      model: flat.model,
      model_id: flat.model_id,
      max_price: flat.max_price,
      max_km: flat.max_km,
      min_year: flat.min_year,
      fuel: flat.fuel,
      transmission: flat.transmission,
      min_cv: flat.min_cv,
      color: flat.color,
      body_type: flat.body_type,
      extras: body.extras || null,
      notes: body.notes?.trim() || null,
      mobile_url: flat.mobile_url,
      status: 'nuevo',
    })
    .select()
    .single();

  if (insertError) {
    console.error('Error creating client request:', JSON.stringify(insertError));
    return NextResponse.json({ error: 'Error al crear la solicitud' }, { status: 500 });
  }

  logDealerEvent(supabase, {
    dealer_id: dealer.id,
    request_id: clientRequest.id,
    type: 'solicitud_nueva',
    payload: { client_name: body.client_name.trim(), source: 'captacion' },
  });

  // Notify dealer
  const dealerEmail = (dealer as any).notify_email || (dealer as any).email;
  if (dealerEmail && (dealer as any).notify_new_request !== false) {
    notifyDealerNewClient({
      dealerEmail,
      dealerName: dealer.business_name,
      clientName: body.client_name.trim(),
      clientPhone: phone,
      make: flat.make,
      model: vehicles.length > 1 ? `${flat.model ?? ''} +${vehicles.length - 1}`.trim() : flat.model,
      maxPrice: flat.max_price,
      fuel: flat.fuel,
      requestId: clientRequest?.id || '',
    }).catch(err => console.error('Notification error:', err));
  }

  return NextResponse.json({
    success: true,
    message: '¡Solicitud enviada! Tu concesionario buscará tu coche ideal.',
    request_id: clientRequest.id,
  }, { status: 201 });
}
