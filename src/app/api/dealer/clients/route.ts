import { NextRequest, NextResponse } from 'next/server';
import { requireDealerAuth, AuthError, dealerServiceClient } from '@/lib/dealer-auth';
import { normalizeVehicles, flatFromVehicles } from '@/lib/dealer-vehicles';
import { logDealerEvent } from '@/lib/dealer/events';

// Dealer-side intake: manually add an operation (top of the funnel). Mirrors the
// public questionnaire insert but authed to the dealer and starting at 'solicitud'.
export async function POST(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);
    const body = await request.json();

    // "Para stock": operación sin cliente para el propio concesionario. No hay
    // nombre/teléfono; el "nombre" es una etiqueta interna (el coche buscado).
    const isStock = body.is_stock === true;

    const clientName = String(body.client_name || '').trim();
    if (!clientName && !isStock) {
      return NextResponse.json({ error: 'El nombre del cliente es obligatorio' }, { status: 400 });
    }

    const phone = isStock ? null : (String(body.client_phone || '').trim() || null);
    const email = isStock ? null : (String(body.client_email || '').trim() || null);
    // Etiqueta interna del coche de stock cuando no se dio nombre.
    const displayName = clientName || 'Coche de stock';

    // Find or create the person (dedupe by phone within the dealer).
    let clientId: string | null = null;
    if (phone) {
      const { data: existing } = await dealerServiceClient
        .from('dealer_clients')
        .select('id')
        .eq('dealer_id', dealerProfile.id)
        .eq('phone', phone)
        .maybeSingle();
      if (existing) {
        clientId = existing.id;
        await dealerServiceClient
          .from('dealer_clients')
          .update({ name: clientName, email: email || undefined, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        const { data: newClient } = await dealerServiceClient
          .from('dealer_clients')
          .insert({ dealer_id: dealerProfile.id, name: clientName, phone, email })
          .select('id')
          .single();
        clientId = newClient?.id || null;
      }
    }

    const str = (v: unknown) => (String(v ?? '').trim() || null);

    // Normalize free-text make/model + filters into N vehicle profiles (each with
    // a best-effort mobile.de search URL for the Solicitud "Buscar" CTA), and
    // mirror vehicles[0] to the flat columns for backward-compatible reads.
    const vehicles = normalizeVehicles(body);
    const flat = flatFromVehicles(vehicles);

    const { data, error } = await dealerServiceClient
      .from('dealer_client_requests')
      .insert({
        dealer_id: dealerProfile.id,
        client_id: clientId,
        client_name: displayName,
        client_phone: phone,
        client_email: email,
        is_stock: isStock,
        stock_status: isStock ? 'buscando' : null,
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
        // Paridad con la captación pública: el alta interna usa el mismo
        // formulario, así que también trae la lista legible de equipamiento.
        extras: Array.isArray(body.extras) && body.extras.length ? body.extras : null,
        notes: str(body.notes),
        mobile_url: flat.mobile_url,
        status: 'nuevo',
        stage: 'solicitud',
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error creating client request:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al crear la operación' }, { status: 500 });
    }

    logDealerEvent(dealerServiceClient, {
      dealer_id: dealerProfile.id,
      request_id: data.id,
      type: 'solicitud_nueva',
      payload: { client_name: displayName, source: isStock ? 'stock' : 'manual' },
    });

    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('Unexpected error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);

    const { data, error } = await dealerServiceClient
      .from('dealer_client_requests')
      .select('*')
      .eq('dealer_id', dealerProfile.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error listing client requests:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al obtener solicitudes' }, { status: 500 });
    }

    const requestIds = (data || []).map((r: any) => r.id);
    const leadCounts: Record<string, number> = {};
    const presupuestoCounts: Record<string, number> = {};
    // Per-request margin: the accepted presupuesto's margin if any, else the best.
    const acceptedMargin: Record<string, number> = {};
    const bestMargin: Record<string, number> = {};

    if (requestIds.length > 0) {
      const { data: leads } = await dealerServiceClient
        .from('dealer_leads')
        .select('client_request_id')
        .in('client_request_id', requestIds)
        .is('deleted_at', null);

      if (leads) {
        for (const lead of leads) {
          if (lead.client_request_id) {
            leadCounts[lead.client_request_id] = (leadCounts[lead.client_request_id] || 0) + 1;
          }
        }
      }

      const { data: leadsFull } = await dealerServiceClient
        .from('dealer_leads')
        .select('id, client_request_id')
        .in('client_request_id', requestIds)
        .is('deleted_at', null);

      if (leadsFull) {
        const leadIds = leadsFull.map((l: any) => l.id);
        if (leadIds.length > 0) {
          const { data: presus } = await dealerServiceClient
            .from('dealer_presupuestos')
            .select('lead_id, status, margin')
            .in('lead_id', leadIds);

          if (presus) {
            const leadToRequest: Record<string, string> = {};
            for (const l of leadsFull) {
              if (l.client_request_id) leadToRequest[l.id] = l.client_request_id;
            }
            for (const p of presus) {
              const reqId = leadToRequest[p.lead_id];
              if (reqId) {
                presupuestoCounts[reqId] = (presupuestoCounts[reqId] || 0) + 1;
                if (p.margin != null) {
                  if (p.status === 'aceptado') acceptedMargin[reqId] = p.margin;
                  if (p.margin > (bestMargin[reqId] ?? -Infinity)) bestMargin[reqId] = p.margin;
                }
              }
            }
          }
        }
      }
    }

    const enriched = (data || []).map((r: any) => ({
      ...r,
      lead_count: leadCounts[r.id] || 0,
      presupuesto_count: presupuestoCounts[r.id] || 0,
      margin: acceptedMargin[r.id] ?? bestMargin[r.id] ?? null,
    }));

    return NextResponse.json({ clients: enriched });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('Unexpected error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
