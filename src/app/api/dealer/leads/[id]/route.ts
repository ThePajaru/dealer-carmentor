import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDealerAuth, AuthError } from '@/lib/dealer-auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);
    const { id } = await params;

    const { data, error } = await supabase
      .from('dealer_leads')
      .select('*, car_analyses(*)')
      .eq('id', id)
      .eq('dealer_id', dealerProfile.id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching lead:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al obtener lead' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Lead no encontrado' }, { status: 404 });
    }

    return NextResponse.json({ lead: data });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

// Soft delete: the lead moves to the papelera (deleted_at) and disappears from
// every listing; restorable via PUT { restore: true }.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);
    const { id } = await params;

    const { data, error } = await supabase
      .from('dealer_leads')
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('dealer_id', dealerProfile.id)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('Error deleting lead:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al borrar lead' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'Lead no encontrado' }, { status: 404 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);
    const { id } = await params;

    let body: Record<string, any>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const allowedFields = ['status', 'notes', 'client_name', 'client_phone', 'client_email', 'is_shortlisted', 'is_shared'];
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const field of allowedFields) {
      if (body[field] !== undefined) updates[field] = body[field];
    }
    // Restore from the papelera.
    if (body.restore === true) {
      updates.deleted_at = null;
    }
    if (body.is_shortlisted === true) {
      updates.shortlisted_at = new Date().toISOString();
    } else if (body.is_shortlisted === false) {
      updates.shortlisted_at = null;
    }
    if (body.is_shared === true) {
      updates.shared_at = new Date().toISOString();
    } else if (body.is_shared === false) {
      updates.shared_at = null;
    }

    if (updates.status) {
      const validStatuses = ['nuevo', 'contactado', 'presupuesto_enviado', 'vendido', 'descartado'];
      if (!validStatuses.includes(updates.status)) {
        return NextResponse.json({ error: 'Status inválido' }, { status: 400 });
      }
    }

    const { data, error } = await supabase
      .from('dealer_leads')
      .update(updates)
      .eq('id', id)
      .eq('dealer_id', dealerProfile.id)
      .select()
      .single();

    if (error) {
      console.error('Error updating lead:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al actualizar lead' }, { status: 500 });
    }

    return NextResponse.json({ lead: data });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
