import { redirect } from 'next/navigation';

// Clientes list retired — client requests are "jobs" in the Operaciones pipeline.
export default function DealerClientesPage() {
  redirect('/dealer/operaciones');
}
