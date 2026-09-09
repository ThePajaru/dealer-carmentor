import { NextRequest, NextResponse } from 'next/server';
import { requireDealerAuth, AuthError, dealerServiceClient, type DealerProfile } from '@/lib/dealer-auth';
import { sendCustomerPing } from '@/lib/dealer-customer-ping';
import { logDealerEvent } from '@/lib/dealer/events';

/** A completed analysis payload (mirrors hasCompletedAnalysisPayload in /api/analyze). */
function isCompletedAnalysis(result: any): boolean {
  if (!result || result.status === 'in_progress' || result.status === 'failed' || result.error) return false;
  return Boolean(result.ficha_tecnica_inicial || result.investigacion_mercado || result.analisis_rentabilidad || result.recomendacion_final);
}

/**
 * Self-heal orphaned leads: if a lead never got its analysis_id (the historical
 * batch-analyze fire-and-forget bug, or any future lost link), find the dealer's
 * completed analysis for the same source_url and re-link it. Runs on every case
 * fetch, but costs one extra query only when unlinked leads exist.
 */
async function reconcileOrphanedLeads(dealerProfile: DealerProfile, clientRequestId: string): Promise<void> {
  const { data: orphans } = await dealerServiceClient
    .from('dealer_leads')
    .select('id, source_url')
    .eq('client_request_id', clientRequestId)
    .eq('dealer_id', dealerProfile.id)
    .is('analysis_id', null)
    .is('deleted_at', null);

  if (!orphans || orphans.length === 0) return;

  for (const orphan of orphans) {
    if (!orphan.source_url) continue;
    const { data: candidates } = await dealerServiceClient
      .from('car_analyses')
      .select('id, result_json')
      .eq('user_id', dealerProfile.user_id)
      .eq('source_url', orphan.source_url)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1);

    const match = candidates?.[0];
    if (!match || !isCompletedAnalysis(match.result_json)) continue;

    const { error } = await dealerServiceClient
      .from('dealer_leads')
      .update({ analysis_id: match.id, updated_at: new Date().toISOString() })
      .eq('id', orphan.id);
    if (error) {
      console.error(`Reconcile: failed to link lead ${orphan.id} → analysis ${match.id}:`, JSON.stringify(error));
    } else {
      console.log(`Reconcile: linked orphaned lead ${orphan.id} → analysis ${match.id}`);
    }
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { dealerProfile } = await requireDealerAuth(request);

    // The case lookup and the orphan self-heal don't depend on each other — run
    // them concurrently, then read the (now-reconciled) leads once.
    const [reqRes] = await Promise.all([
      dealerServiceClient
        .from('dealer_client_requests')
        .select('*')
        .eq('id', id)
        .eq('dealer_id', dealerProfile.id)
        .single(),
      reconcileOrphanedLeads(dealerProfile, id),
    ]);

    const { data: clientRequest, error } = reqRes;
    if (error || !clientRequest) {
      return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 });
    }

    // Pull leads and their quotes in one nested read (FK: dealer_presupuestos.lead_id).
    const { data: leadsRaw } = await dealerServiceClient
      .from('dealer_leads')
      .select('*, car_analyses(id, title, car_image_url, result_json, source_url, country_of_origin), dealer_presupuestos(*)')
      .eq('client_request_id', id)
      .eq('dealer_id', dealerProfile.id)
      .is('deleted_at', null)
      .order('is_shortlisted', { ascending: false })
      .order('created_at', { ascending: false });

    // Flatten the embedded quotes into the flat `presupuestos` array the client
    // expects (each carrying its lead's car), then strip the embed off the leads.
    const presupuestos: any[] = [];
    const leads = (leadsRaw || []).map((l: any) => {
      const { dealer_presupuestos, ...lead } = l;
      const car = l.car_analyses
        ? { title: l.car_analyses.title, car_image_url: l.car_analyses.car_image_url }
        : null;
      for (const p of (Array.isArray(dealer_presupuestos) ? dealer_presupuestos : [])) {
        presupuestos.push({ ...p, dealer_leads: { id: l.id, car_analyses: car } });
      }
      return lead;
    });
    presupuestos.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return NextResponse.json({
      client: clientRequest,
      leads,
      presupuestos,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('Unexpected error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

// Soft delete → the operación moves to the Papelera (deleted_at) and disappears
// from Operaciones + KPIs; restorable via PUT { restore: true }. With
// ?permanent=1 it's a hard delete (removes its presupuestos + leads first, then
// the request — dealer_events cascade, dealer_stock is set null).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { dealerProfile } = await requireDealerAuth(request);
    const permanent = new URL(request.url).searchParams.get('permanent');
    const isPermanent = permanent === '1' || permanent === 'true';

    if (!isPermanent) {
      const { data, error } = await dealerServiceClient
        .from('dealer_client_requests')
        .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('dealer_id', dealerProfile.id)
        .select('id')
        .maybeSingle();
      if (error) {
        console.error('Error soft-deleting request:', JSON.stringify(error));
        return NextResponse.json({ error: 'Error al mover a la papelera' }, { status: 500 });
      }
      if (!data) return NextResponse.json({ error: 'Operación no encontrada' }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    // Permanent: verify ownership, then cascade-delete manually.
    const { data: owned } = await dealerServiceClient
      .from('dealer_client_requests')
      .select('id')
      .eq('id', id)
      .eq('dealer_id', dealerProfile.id)
      .maybeSingle();
    if (!owned) return NextResponse.json({ error: 'Operación no encontrada' }, { status: 404 });

    const { data: leadRows } = await dealerServiceClient
      .from('dealer_leads')
      .select('id')
      .eq('client_request_id', id)
      .eq('dealer_id', dealerProfile.id);
    const leadIds = (leadRows || []).map((l: any) => l.id);
    if (leadIds.length) {
      await dealerServiceClient.from('dealer_presupuestos').delete().in('lead_id', leadIds);
      await dealerServiceClient.from('dealer_leads').delete().in('id', leadIds);
    }
    const { error } = await dealerServiceClient
      .from('dealer_client_requests')
      .delete()
      .eq('id', id)
      .eq('dealer_id', dealerProfile.id);
    if (error) {
      console.error('Error deleting request:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al eliminar definitivamente' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('Unexpected error:', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { dealerProfile } = await requireDealerAuth(request);

    const body = await request.json();
    const allowedFields = ['status', 'notes', 'stage', 'agreed_price', 'agreed_at', 'delivery_eta', 'runner_packet', 'transit_progress', 'runner_expenses', 'actual_purchase', 'tracking_token',
      // Stock (concesionario): ciclo y economía de un coche de stock.
      'is_stock', 'stock_status', 'listing_price', 'sold_price', 'sold_at'];
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const field of allowedFields) {
      if (body[field] !== undefined) updates[field] = body[field];
    }
    // Marcar 'vendido' fija sold_at automáticamente si no vino explícito.
    if (body.stock_status === 'vendido' && body.sold_at === undefined) {
      updates.sold_at = new Date().toISOString();
    }
    // Restore from the Papelera.
    if (body.restore === true) updates.deleted_at = null;

    // Old stage for the activity feed — only worth a roundtrip when it may change.
    let prevStage: string | null = null;
    if (body.stage !== undefined) {
      const { data: prev } = await dealerServiceClient
        .from('dealer_client_requests')
        .select('stage')
        .eq('id', id)
        .eq('dealer_id', dealerProfile.id)
        .maybeSingle();
      prevStage = (prev as Record<string, any>)?.stage ?? null;
    }

    const { data, error } = await dealerServiceClient
      .from('dealer_client_requests')
      .update(updates)
      .eq('id', id)
      .eq('dealer_id', dealerProfile.id)
      .select()
      .single();

    if (error) {
      console.error('Error updating client request:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al actualizar' }, { status: 500 });
    }

    if (body.stage !== undefined && body.stage !== prevStage) {
      logDealerEvent(dealerServiceClient, {
        dealer_id: dealerProfile.id,
        request_id: id,
        type: 'etapa_cambiada',
        payload: {
          client_name: (data as Record<string, any>)?.client_name ?? null,
          from: prevStage,
          to: body.stage,
        },
      });
    }

    // Ping the customer when a client-visible milestone is reached (idempotent per milestone).
    if (body.transit_progress !== undefined || body.stage !== undefined) {
      const progress = ((data as Record<string, any>)?.transit_progress) || {};
      const milestones: ('comprado' | 'en_transporte' | 'en_espana' | 'entregado')[] =
        (['comprado', 'en_transporte', 'en_espana'] as const).filter(k => progress[k]);
      if ((data as Record<string, any>)?.stage === 'entregado') milestones.push('entregado');
      for (const m of milestones) {
        await sendCustomerPing(dealerServiceClient, id, m);
      }
    }

    return NextResponse.json({ client: data });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
