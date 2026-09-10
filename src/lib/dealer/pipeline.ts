// Single source of truth for the dealer operación pipeline.
//
// The DB `stage` column (dealer_client_requests.stage) stores one ATOMIC stage.
// Everything the dealer sees is grouped into 4 PHASES (5 until 2026-07-17, when
// the standalone Acuerdo phase folded into Propuesta) — the same 4 on the
// Operaciones list ("La ruta" + the job list) and on the case page
// (/dealer/clientes/[id] spine + workspace). Reduce or rename a step here once
// and both surfaces move together. (Previously each page hardcoded its own
// taxonomy and they drifted — see docs/DEALER_PIPELINE.md.)

import {
  Clock, Search, Star, FileText, CheckCircle2, Truck, Send, ShoppingBag, Stamp,
  type LucideIcon,
} from 'lucide-react';

// Color semántico de etapa: neutro=esperando · ámbar=requiere tu acción · verde=en movimiento
export const DOT_WAIT = '#63636e';
export const DOT_ACTION = '#fbbf24';
export const DOT_MOVING = '#34d399';

export type StageKey =
  | 'solicitud' | 'busqueda' | 'seleccion' | 'propuesta'
  | 'acuerdo' | 'runner' | 'transito' | 'tramites' | 'entregado' | 'perdido';

export interface StageDef {
  key: StageKey;
  label: string;
  icon: LucideIcon;
  dot: string;
  /** Short imperative next-action (operaciones "Te esperan" queue). */
  next: string;
  /** Long "Ahora" sentence shown on the case page. */
  nextAction: string;
  /** One line on what CarMentor does for the dealer at this stage (case page). */
  howWeHelp: string;
  /** Tooltip copy (pipeline hover). */
  tip: string;
}

// The linear pipeline (atomic stages). `entregado` is the terminal success step;
// `perdido` is a separate escape kept out of the linear array (see PERDIDO).
export const STAGES: StageDef[] = [
  {
    key: 'solicitud', label: 'Solicitud', icon: Clock, dot: DOT_WAIT,
    next: 'Buscar en mobile.de',
    nextAction: 'Busca en mobile.de el coche que quiere el cliente.',
    howWeHelp: 'Convertimos lo que pide el cliente en la búsqueda correcta de mobile.de.',
    tip: 'El cliente ha pedido un coche. Falta arrancar la búsqueda en mobile.de.',
  },
  {
    key: 'busqueda', label: 'Búsqueda', icon: Search, dot: DOT_MOVING,
    next: 'Analizar candidatos',
    nextAction: 'Pega los enlaces de los coches candidatos para analizarlos.',
    howWeHelp: 'Analizamos cada coche contra el mercado español real (coches.net).',
    tip: 'Rastreando mobile.de con los filtros del cliente y analizando candidatos.',
  },
  {
    key: 'seleccion', label: 'Selección', icon: Star, dot: DOT_ACTION,
    next: 'Elegir y generar pitch',
    nextAction: 'Revisa los análisis, marca finalistas y genera el presupuesto.',
    howWeHelp: 'Comparamos los finalistas y calculamos el margen de cada uno.',
    tip: 'Finalistas analizados. Elige el coche con mejor margen y verdict.',
  },
  {
    key: 'propuesta', label: 'Propuesta', icon: FileText, dot: DOT_ACTION,
    next: 'Enviar al cliente',
    nextAction: 'Descarga el PDF del presupuesto y envíaselo al cliente.',
    howWeHelp: 'Generamos el presupuesto con tu marca, listo para enviar.',
    tip: 'Presupuesto listo. Envíalo al cliente con el PDF de marca.',
  },
  // Sub-stage of the Propuesta PHASE since 2026-07-17 (the standalone Acuerdo
  // phase was removed): presupuesto sent, waiting on the client's yes.
  {
    key: 'acuerdo', label: 'Enviada', icon: CheckCircle2, dot: DOT_ACTION,
    next: 'Marcar aceptado',
    nextAction: 'El cliente tiene el presupuesto — cuando lo acepte, marca «Aceptado».',
    howWeHelp: 'Al aceptar registramos el precio acordado y lanzamos la fase del runner.',
    tip: 'Presupuesto enviado. Un clic en «Aceptado» y pasa al runner.',
  },
  {
    key: 'runner', label: 'Runner', icon: Truck, dot: DOT_ACTION,
    next: 'Pasar info al runner',
    nextAction: 'Prepara la info del coche para el runner.',
    howWeHelp: 'Creamos la checklist de inspección para tu chico en Alemania.',
    tip: 'Tu chico sube a Alemania con el checklist de inspección y los dealbreakers.',
  },
  {
    key: 'transito', label: 'En tránsito', icon: Send, dot: DOT_MOVING,
    next: 'Recepción y cierre',
    nextAction: 'El coche está en camino — recepción y cierre.',
    howWeHelp: 'Mantenemos informado al cliente y cerramos tu margen real.',
    tip: 'Coche comprado y de camino a España. Seguimiento en vivo para el cliente.',
  },
  // Servicios con persona detrás sobre una operación ya cerrada de compra: el
  // gestor paga 576 + IVTM y el ingeniero firma la ficha técnica reducida con
  // las fotos del runner. Se entra aquí al encargar el primer servicio.
  {
    key: 'tramites', label: 'Trámites', icon: Stamp, dot: DOT_ACTION,
    next: 'Encargar impuestos y ficha',
    nextAction: 'Encarga los impuestos (576 e IVTM) y la ficha técnica reducida.',
    howWeHelp: 'Nuestro gestor paga los impuestos y nuestro ingeniero firma la ficha reducida.',
    tip: 'Impuestos de matriculación y ficha técnica reducida, hechos por nosotros.',
  },
  {
    key: 'entregado', label: 'Entregado', icon: ShoppingBag, dot: DOT_MOVING,
    next: '',
    nextAction: 'Operación cerrada. ¡Enhorabuena!',
    howWeHelp: 'Operación cerrada con el margen real registrado.',
    tip: 'Operación entregada con el margen real registrado.',
  },
];

// Terminal escape for dead deals — not part of the linear stepper.
export const PERDIDO: StageDef = {
  key: 'perdido', label: 'Perdido', icon: Clock, dot: DOT_WAIT,
  next: '', nextAction: 'Operación descartada.', howWeHelp: '',
  tip: 'Operación descartada.',
};

export interface PhaseDef {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Atomic stages that roll up into this phase. */
  stages: StageKey[];
  /** Stage to jump to when rolling the deal back to this phase. */
  back: StageKey;
  dot: string;
  /** Short next-action shown at the phase level. */
  next: string;
  tip: string;
}

// The 5 phases every surface renders. Each groups the granular stages into one
// coherent unit of work. (Trámites joined on 2026-09-09 with the gestor +
// ingeniero services; the old Entrega phase kept only `entregado`.)
export const PHASES: PhaseDef[] = [
  {
    key: 'buscar', label: 'Búsqueda y análisis', icon: Search,
    // back = 'busqueda' (not 'seleccion'): rolling a deal back into this phase
    // should reopen the CHOOSING step on the case page — 'seleccion' would cap
    // the step accordion at presupuesto territory and the undo would be a no-op.
    stages: ['solicitud', 'busqueda', 'seleccion'], back: 'busqueda',
    dot: DOT_MOVING, next: 'Analizar y elegir finalista',
    tip: 'Sourcing en mobile.de, análisis de candidatos y elección del finalista con mejor margen.',
  },
  // The old standalone Acuerdo phase folded in here (2026-07-17): send the
  // presupuesto and, when the client says yes, one «Aceptado» click records the
  // agreed price and launches the runner — one step less in the ruta.
  {
    key: 'propuesta', label: 'Propuesta', icon: FileText,
    stages: ['propuesta', 'acuerdo'], back: 'propuesta',
    dot: DOT_ACTION, next: 'Enviar y marcar aceptado',
    tip: 'Presupuesto listo. Envíalo al cliente y marca «Aceptado» cuando diga que sí.',
  },
  {
    key: 'runner', label: 'Runner', icon: Truck,
    stages: ['runner'], back: 'runner',
    dot: DOT_ACTION, next: 'Pasar info al runner',
    tip: 'Tu chico sube a Alemania con el checklist de inspección y los dealbreakers.',
  },
  // Tránsito y trámites van juntos a propósito: la ficha reducida se tramita con
  // el coche todavía rodando, y los impuestos en cuanto llega. Una sola fase.
  {
    key: 'tramites', label: 'Trámites', icon: Stamp,
    stages: ['transito', 'tramites'], back: 'transito',
    dot: DOT_ACTION, next: 'Impuestos y ficha reducida',
    tip: 'Coche de camino. Nuestro gestor paga el 576 y el IVTM; nuestro ingeniero firma la ficha reducida.',
  },
  {
    key: 'entrega', label: 'Entrega', icon: ShoppingBag,
    stages: ['entregado'], back: 'tramites',
    dot: DOT_MOVING, next: 'Recepción y cierre',
    tip: 'Coche en España. Recepción, cierre del margen real y entrega al cliente.',
  },
];

// Stages where the ball is in the dealer's court and money is on the table.
// Kept atomic (not phase-level) so the action queue stays precise: a job in
// `solicitud` is not "waiting on you" even though it shares the buscar phase.
export const ACTION_STAGES = new Set<string>(['seleccion', 'propuesta', 'acuerdo', 'runner', 'tramites']);

export const stageDef = (key: string): StageDef | undefined =>
  STAGES.find(s => s.key === key) ?? (key === 'perdido' ? PERDIDO : undefined);

export const stageLabel = (key: string): string => stageDef(key)?.label ?? key;

export const phaseOf = (key: string): PhaseDef | undefined =>
  PHASES.find(p => p.stages.includes(key as StageKey));

/** Next atomic stage in the linear pipeline, or null at the terminal step. */
export const nextStage = (key: string): StageDef | null => {
  const i = STAGES.findIndex(s => s.key === key);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
};

export const isClosed = (key: string): boolean => key === 'entregado' || key === 'perdido';

/** Roll atomic per-stage counts up into per-phase counts. */
export const phaseCounts = (counts: Record<string, number>): Record<string, number> =>
  Object.fromEntries(
    PHASES.map(p => [p.key, p.stages.reduce((n, s) => n + (counts[s] || 0), 0)]),
  );
