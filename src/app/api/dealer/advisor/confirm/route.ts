import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getDealerProfileBySlug } from '@/lib/dealer-auth';
import { logDealerEvent } from '@/lib/dealer/events';

/**
 * El cliente ha visto su resultado del asesor y ha pulsado «que me busquen
 * estas opciones».
 *
 * La operación ya existía (se creó al dejar el teléfono), así que esto solo
 * sella la intención. Es la señal que separa «vio su resultado y pidió
 * búsqueda» — llamar hoy — de «vio su resultado y se fue» — madurar por
 * WhatsApp. Sin esto las dos son la misma fila en el kanban.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(request: NextRequest) {
  let body: { slug?: string; request_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.slug?.trim() || !body.request_id?.trim()) {
    return NextResponse.json({ error: 'slug y request_id son obligatorios' }, { status: 400 });
  }

  const dealer = await getDealerProfileBySlug(body.slug.trim());
  if (!dealer) {
    return NextResponse.json({ error: 'Dealer no encontrado' }, { status: 404 });
  }

  // El request_id viaja al cliente, así que la ruta es pública: se ata al
  // dealer_id del slug para que un id filtrado no pueda tocar otra cuenta.
  const { data: updated, error } = await supabase
    .from('dealer_client_requests')
    .update({ interest_confirmed_at: new Date().toISOString() })
    .eq('id', body.request_id.trim())
    .eq('dealer_id', dealer.id)
    .is('interest_confirmed_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Error confirming advisor interest:', JSON.stringify(error));
    return NextResponse.json({ error: 'Error al confirmar' }, { status: 500 });
  }

  // Ya confirmado (doble clic, recarga) → idempotente, no es un error.
  if (updated) {
    logDealerEvent(supabase, {
      dealer_id: dealer.id,
      request_id: updated.id,
      type: 'interes_confirmado',
      payload: { source: 'asesor' },
    });
  }

  return NextResponse.json({ success: true });
}
