import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { AuthError, dealerServiceClient } from '@/lib/dealer-auth';
import { logDealerEvent } from '@/lib/dealer/events';
import {
  deleteServiceFile, signResult, uploadServiceFile,
  type ServiceFile, type ServiceResult,
} from '@/lib/dealer/service-files';
import { notifyDealerServiceCompleted } from '@/lib/dealer/service-notifications';
import { serviceDef, type ServiceKey, type ServiceStatus } from '@/lib/dealer/services';

// Lo que el colaborador puede tocar de un encargo: su estado, la nota y los
// papeles que devuelve. Todo pasa por aquí (service role); el panel nunca
// escribe en la base directamente.

// Estados que puede fijar a mano. `pendiente_pago` y `pagado` los pone el flujo
// de Stripe: dejarlos aquí permitiría "cobrar" un encargo sin pago.
const SETTABLE: ServiceStatus[] = ['en_tramite', 'completado', 'cancelado'];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin(request);
    const { id } = await params;

    let body: {
      status?: string;
      nota?: string;
      add_file?: { dataUrl?: string; label?: string };
      remove_path?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { data: order } = await dealerServiceClient
      .from('dealer_service_orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!order) return NextResponse.json({ error: 'Encargo no encontrado' }, { status: 404 });

    const result: ServiceResult = (order.result && typeof order.result === 'object') ? order.result : {};
    let files: ServiceFile[] = Array.isArray(result.files) ? result.files : [];

    if (body.add_file?.dataUrl) {
      const up = await uploadServiceFile(id, body.add_file.dataUrl, body.add_file.label || '');
      if ('error' in up) return NextResponse.json({ error: up.error }, { status: up.status });
      files = [...files, up.file];
    }

    if (body.remove_path) {
      const target = files.find(f => f.path === body.remove_path);
      // Solo se borra del almacén lo que este encargo tenía referenciado: la
      // ruta llega del cliente y no puede apuntar al fichero de otro.
      if (target) {
        await deleteServiceFile(target.path);
        files = files.filter(f => f.path !== target.path);
      }
    }

    const nextResult: ServiceResult = {
      ...result,
      files,
      ...(body.nota !== undefined ? { nota: String(body.nota).slice(0, 4000) } : {}),
    };

    const nextStatus = SETTABLE.includes(body.status as ServiceStatus)
      ? (body.status as ServiceStatus)
      : null;

    const { data: updated, error } = await dealerServiceClient
      .from('dealer_service_orders')
      .update({
        result: nextResult,
        ...(nextStatus ? { status: nextStatus } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Admin service update failed:', JSON.stringify(error));
      return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 });
    }

    // Al completar, el dealer se entera por correo: el panel no es un sitio que
    // mire cada día, y un trámite terminado desbloquea su entrega.
    if (nextStatus === 'completado' && order.status !== 'completado') {
      const [{ data: job }, { data: dealer }] = await Promise.all([
        dealerServiceClient
          .from('dealer_client_requests')
          .select('client_name')
          .eq('id', order.request_id)
          .maybeSingle(),
        dealerServiceClient
          .from('dealer_profiles')
          .select('business_name, email')
          .eq('id', order.dealer_id)
          .maybeSingle(),
      ]);

      logDealerEvent(dealerServiceClient, {
        dealer_id: order.dealer_id,
        request_id: order.request_id,
        type: 'servicio_completado',
        payload: {
          client_name: job?.client_name ?? null,
          title: serviceDef(order.kind as ServiceKey)?.label ?? order.kind,
        },
      });

      await notifyDealerServiceCompleted({
        kind: order.kind as ServiceKey,
        requestId: order.request_id,
        to: dealer?.email ?? null,
        dealerName: dealer?.business_name ?? null,
        clientName: job?.client_name ?? null,
        nota: nextResult.nota ?? null,
        fileCount: files.length,
      });
    }

    console.log(`Admin ${admin.email} updated service order ${id}${nextStatus ? ` → ${nextStatus}` : ''}`);

    return NextResponse.json({ order: { ...updated, result: await signResult(updated.result) } });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
