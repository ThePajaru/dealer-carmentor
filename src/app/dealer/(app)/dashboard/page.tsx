import { redirect } from 'next/navigation';

// Dashboard retired — its KPIs live in the Operaciones pipeline now.
export default function DealerDashboardPage() {
  redirect('/dealer/operaciones');
}
