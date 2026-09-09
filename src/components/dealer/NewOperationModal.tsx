'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import QuestionnaireV2, { type CapturePayload } from '@/components/dealer/QuestionnaireV2';

// The in-app "Nueva operación" flow. Renders the very same form the customer
// fills in from the public link — same steps, same questions, same mobile.de URL
// at the end — only authed and persisted through /api/dealer/clients, starting
// at 'solicitud'. Keeping one component is the point: the two intakes drifted
// apart once already (2026-07-26).
export default function NewOperationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session } = useAuth();
  const router = useRouter();

  if (!open) return null;

  const handleSubmit = async (payload: CapturePayload) => {
    if (!session?.access_token) throw new Error('Sesión no válida');
    const res = await fetch('/api/dealer/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo crear la operación');
    onClose();
    // Un coche de stock vive en el concesionario; una operación de cliente, en su ficha.
    router.push(payload.is_stock ? '/dealer/stock' : `/dealer/clientes/${data.id}`);
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-paper">
      <QuestionnaireV2
        onClose={onClose}
        submitLabel="Crear operación"
        onSubmit={handleSubmit}
      />
    </div>
  );
}
