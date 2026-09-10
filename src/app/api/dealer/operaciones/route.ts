import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDealerAuth, AuthError } from '@/lib/dealer-auth';

// Feeds the Operaciones pipeline: every job (dealer_client_request) with its
// stage, a representative car (shortlisted → latest lead) and its latest quote's
// price/margin, plus top-line KPIs. One place owns the pipeline query.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(request: NextRequest) {
  try {
    const { dealerProfile } = await requireDealerAuth(request);
    const dealerId = dealerProfile.id;

    // One nested read pulls every job with its leads (+ representative car) and
    // each lead's quotes in a single round-trip — the FK graph does the joining
    // server-side. The activity feed is independent, so it runs concurrently.
    const [reqRes, eventsRes] = await Promise.all([
      supabase
        .from('dealer_client_requests')
        .select(`id, client_name, client_phone, client_email, stage, make, model, max_price, max_km, min_year, fuel, transmission, mobile_url, vehicles, created_at, updated_at, agreed_price, actual_purchase, runner_expenses, transit_progress, delivery_eta,
                 dealer_leads ( id, is_shortlisted, created_at, deleted_at, car_analyses ( title, car_image_url ), dealer_presupuestos ( selling_price, margin, created_at ) )`)
        .eq('dealer_id', dealerId)
        .is('deleted_at', null)
        .eq('is_stock', false),
      // Activity feed (dealer_events written by the dealer API routes).
      supabase
        .from('dealer_events')
        .select('id, request_id, type, payload, created_at')
        .eq('dealer_id', dealerId)
        .order('created_at', { ascending: false })
        .limit(12),
    ]);

    const { data: reqs, error } = reqRes;
    if (error) {
      console.error('operaciones reqs error:', JSON.stringify(error));
      return NextResponse.json({ error: 'Error al cargar operaciones' }, { status: 500 });
    }

    const jobs = reqs || [];

    const assembled = jobs.map((j: any) => {
      const myLeads = (Array.isArray(j.dealer_leads) ? j.dealer_leads : [])
        .filter((l: any) => !l.deleted_at);
      // representative car: shortlisted first, else most recently added
      const sorted = [...myLeads].sort((a, b) => {
        if (!!a.is_shortlisted !== !!b.is_shortlisted) return a.is_shortlisted ? -1 : 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      const rep = sorted[0];
      const caRaw: any = rep?.car_analyses;
      const ca = Array.isArray(caRaw) ? caRaw[0] : caRaw;
      const car = ca ? { title: ca.title, image: ca.car_image_url } : null;

      const myPresus = myLeads
        .flatMap((l: any) => (Array.isArray(l.dealer_presupuestos) ? l.dealer_presupuestos : []))
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      const latestPresu = myPresus[0];

      // Real margin from the runner's reported costs, when captured; else the
      // presupuesto's estimated margin.
      const expensesTotal = Array.isArray(j.runner_expenses) ? j.runner_expenses.reduce((s: number, e: any) => s + (Number(e?.amount) || 0), 0) : 0;
      const salePrice = j.agreed_price ?? latestPresu?.selling_price ?? null;
      const actualMargin = (j.actual_purchase != null && salePrice != null) ? salePrice - (j.actual_purchase + expensesTotal) : null;

      return {
        id: j.id,
        client_name: j.client_name,
        // Contacto: lo necesita "Duplicar" en la consola para arrastrar al
        // mismo cliente a la operacion nueva (y deduplicar por telefono).
        client_phone: j.client_phone ?? null,
        client_email: j.client_email ?? null,
        stage: j.stage || 'solicitud',
        make: j.make, model: j.model, max_price: j.max_price, max_km: j.max_km,
        min_year: j.min_year, fuel: j.fuel, transmission: j.transmission,
        mobile_url: j.mobile_url,
        vehicles: Array.isArray(j.vehicles) ? j.vehicles : [],
        created_at: j.created_at,
        updated_at: j.updated_at,
        transit_progress: j.transit_progress ?? null,
        delivery_eta: j.delivery_eta ?? null,
        car,
        price: latestPresu?.selling_price ?? null,
        margin: actualMargin ?? latestPresu?.margin ?? null,
        margin_is_real: actualMargin != null,
        leads_count: myLeads.length,
        presupuestos_count: myPresus.length,
      };
    });

    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const closedStages = new Set(['entregado', 'perdido']);

    // Calendar month-over-month delivered margin, for the dashboard hero.
    const nowD = new Date();
    const monthStart = new Date(nowD.getFullYear(), nowD.getMonth(), 1).getTime();
    const prevMonthStart = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1).getTime();
    // Pace comparison: previous month *up to the same day-of-month*, so day 10
    // compares against day 10 — comparing to the full month reads -100% all month.
    const prevMonthSameDay = prevMonthStart + (Date.now() - monthStart);
    let margenMes = 0, margenMesPrev = 0, margenMesPrevSameDay = 0;
    for (const j of assembled) {
      if (j.stage !== 'entregado') continue;
      const t = new Date(j.updated_at).getTime();
      if (t >= monthStart) margenMes += j.margin || 0;
      else if (t >= prevMonthStart) {
        margenMesPrev += j.margin || 0;
        if (t <= prevMonthSameDay) margenMesPrevSameDay += j.margin || 0;
      }
    }

    const kpis = {
      activas: assembled.filter((j) => !closedStages.has(j.stage)).length,
      nuevas7d: assembled.filter((j) => new Date(j.created_at).getTime() >= weekAgo).length,
      entregadas: assembled.filter((j) => j.stage === 'entregado').length,
      margen: assembled.filter((j) => j.stage === 'entregado').reduce((s, j) => s + (j.margin || 0), 0),
      margenMes,
      margenMesPrev,
      margenMesPrevSameDay,
      // Margin committed in the open pipeline ("en juego"): active jobs only.
      enJuego: assembled
        .filter((j) => !closedStages.has(j.stage))
        .reduce((s, j) => s + (j.margin || 0), 0),
    };

    // Weekly series (8 buckets, oldest→newest) for the KPI sparklines.
    const WEEKS = 8;
    const WK = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const idxOf = (ts: string) => {
      const back = Math.floor((now - new Date(ts).getTime()) / WK);
      return back >= 0 && back < WEEKS ? WEEKS - 1 - back : -1;
    };
    const nuevas = Array(WEEKS).fill(0);
    const entregadas = Array(WEEKS).fill(0);
    const margen = Array(WEEKS).fill(0);
    const activas = Array(WEEKS).fill(0);
    for (const j of assembled) {
      const bi = idxOf(j.created_at);
      if (bi >= 0) nuevas[bi]++;
      if (j.stage === 'entregado') {
        const be = idxOf(j.updated_at);
        if (be >= 0) { entregadas[be]++; margen[be] += j.margin || 0; }
      }
      // active-at-week-end: created by then and not yet closed by then
      const created = new Date(j.created_at).getTime();
      const closed = closedStages.has(j.stage) ? new Date(j.updated_at).getTime() : Infinity;
      for (let i = 0; i < WEEKS; i++) {
        const weekEnd = now - (WEEKS - 1 - i) * WK;
        if (created <= weekEnd && closed > weekEnd) activas[i]++;
      }
    }
    const series = { activas, nuevas, entregadas, margen };

    return NextResponse.json({ jobs: assembled, kpis, series, events: eventsRes.data || [] });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
