import type { SupabaseClient } from '@supabase/supabase-js';

// Activity feed writes for the Operaciones dashboard. Fire-and-forget: an
// event that fails to record must never break the operation that caused it.
// Payload is denormalized (client_name, car title, …) so the feed renders
// without joins.

export type DealerEventType =
  | 'solicitud_nueva'      // new operación (captación questionnaire or manual)
  | 'lead_captacion'       // raw lead from the old capture link (no request yet)
  | 'etapa_cambiada'       // stage moved on a client request
  | 'presupuesto_creado'   // quote created
  | 'presupuesto_enviado'  // quote sent to the client (PDF frozen)
  | 'presupuesto_visto'    // client opened the public /pr link (first time)
  | 'presupuesto_aceptado' // client self-accepted the quote from the public /pr link
  | 'analisis_completado'  // car analysis finished
  | 'interes_confirmado';  // advisor: client saw their result and asked us to search

export interface DealerEventPayload {
  client_name?: string | null;
  title?: string | null;   // car title, when known
  from?: string | null;    // stage keys, for etapa_cambiada
  to?: string | null;
  margin?: number | null;
  source?: string | null;  // 'captacion' | 'manual' | 'asesor'
}

export function logDealerEvent(
  supabase: SupabaseClient,
  event: {
    dealer_id: string;
    request_id?: string | null;
    type: DealerEventType;
    payload?: DealerEventPayload;
  },
): void {
  void supabase
    .from('dealer_events')
    .insert({
      dealer_id: event.dealer_id,
      request_id: event.request_id ?? null,
      type: event.type,
      payload: event.payload ?? {},
    })
    .then(({ error }) => {
      if (error) console.error('dealer_events insert failed:', JSON.stringify(error));
    });
}
