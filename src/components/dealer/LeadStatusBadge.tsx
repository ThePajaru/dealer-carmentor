'use client';

const statusConfig: Record<string, { label: string; cls: string }> = {
  nuevo: { label: 'Nuevo', cls: 'd-tag-info' },
  contactado: { label: 'Contactado', cls: 'd-tag-warn' },
  buscando: { label: 'Buscando', cls: 'd-tag-warn' },
  presupuesto_enviado: { label: 'Presupuesto enviado', cls: 'd-tag-purple' },
  vendido: { label: 'Vendido', cls: 'd-tag-good' },
  descartado: { label: 'Descartado', cls: 'd-tag-muted' },
  // dealer_presupuestos.status
  borrador: { label: 'Borrador', cls: 'd-tag-muted' },
  enviado: { label: 'Enviado', cls: 'd-tag-purple' },
  aceptado: { label: 'Aceptado', cls: 'd-tag-good' },
  rechazado: { label: 'Rechazado', cls: 'd-tag-muted' },
};

export default function LeadStatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || statusConfig.nuevo;
  return <span className={`d-tag ${config.cls}`}>{config.label}</span>;
}
