-- Encargos de los servicios con persona detrás que se prestan SOBRE una
-- operación: impuestos de matriculación (modelo 576 + IVTM, los paga el gestor)
-- y ficha técnica reducida (la firma el ingeniero con las fotos del runner).
--
-- Una fila por encargo. Nace en 'pendiente_pago' ANTES de mandar al dealer a
-- Stripe, para que el webhook siempre tenga una fila a la que agarrarse.

create table if not exists public.dealer_service_orders (
  id uuid primary key default gen_random_uuid(),
  dealer_id uuid not null references public.dealer_profiles(id) on delete cascade,
  request_id uuid not null references public.dealer_client_requests(id) on delete cascade,
  kind text not null check (kind in ('impuestos', 'ficha_reducida')),
  status text not null default 'pendiente_pago'
    check (status in ('pendiente_pago', 'pagado', 'en_tramite', 'completado', 'cancelado')),
  -- Datos que el dealer aporta al encargar (municipio, CVF, región, fotos…).
  payload jsonb not null default '{}'::jsonb,
  -- Lo que devolvemos nosotros (justificantes, PDF de la ficha, nº expediente).
  result jsonb not null default '{}'::jsonb,
  amount_cents integer,
  currency text not null default 'eur',
  stripe_session_id text,
  stripe_payment_intent text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un encargo vivo por operación y tipo: reintentar un checkout abandonado
-- reutiliza la fila en vez de duplicarla. Los cancelados no estorban.
create unique index if not exists dealer_service_orders_request_kind_uniq
  on public.dealer_service_orders (request_id, kind)
  where status <> 'cancelado';

create index if not exists dealer_service_orders_dealer_idx
  on public.dealer_service_orders (dealer_id, created_at desc);
create index if not exists dealer_service_orders_session_idx
  on public.dealer_service_orders (stripe_session_id);

alter table public.dealer_service_orders enable row level security;

-- Mismo patrón que dealer_presupuestos: el dealer solo ve y toca lo suyo. Las
-- rutas de API escriben con service role, así que no hay policy de INSERT
-- pública ni de UPDATE del estado de pago.
create policy dealer_service_orders_select_own on public.dealer_service_orders
  for select using (
    dealer_id in (select id from public.dealer_profiles where user_id = auth.uid())
  );

-- La etapa nueva del pipeline. El CHECK original no la contemplaba y el webhook
-- de Stripe habría fallado al mover la operación a «Trámites».
alter table public.dealer_client_requests
  drop constraint if exists dealer_client_requests_stage_check;

alter table public.dealer_client_requests
  add constraint dealer_client_requests_stage_check
  check (stage = any (array[
    'solicitud'::text, 'busqueda'::text, 'seleccion'::text, 'propuesta'::text,
    'acuerdo'::text, 'runner'::text, 'transito'::text, 'tramites'::text,
    'entregado'::text, 'perdido'::text
  ]));
