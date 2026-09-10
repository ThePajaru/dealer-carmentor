import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { AuthError } from './dealer-auth';

// Puerta del panel de colaborador (gestor e ingeniero). No hay tabla de roles en
// este proyecto: la lista blanca vive en ADMIN_EMAILS, separada por comas.
//
//   ADMIN_EMAILS=gestor@carmentor.es,ingeniero@carmentor.es
//
// Sin la variable NADIE es admin — un despiste de configuración cierra el panel,
// nunca lo abre. La comprobación es siempre contra el correo del JWT verificado
// por Supabase (`auth.getUser`), nunca contra nada que mande el cliente.

const anonClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = adminEmails();
  return list.length > 0 && list.includes(email.toLowerCase());
}

export interface AdminUser {
  id: string;
  email: string;
}

/**
 * Exige un usuario de la lista blanca. Aquí no se usa la verificación local del
 * JWT (la del dealer): esa solo devuelve el `sub`, y el permiso se decide por
 * correo, así que se pregunta al servidor de auth. Son cuatro peticiones al día,
 * no un camino caliente.
 */
export async function requireAdmin(request: NextRequest): Promise<AdminUser> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) throw new AuthError('Missing authorization token', 401);

  const { data, error } = await anonClient.auth.getUser(header.replace('Bearer ', ''));
  if (error || !data?.user) throw new AuthError('Invalid token', 401);

  const email = data.user.email ?? null;
  if (!isAdminEmail(email)) throw new AuthError('No autorizado', 403);

  return { id: data.user.id, email: email as string };
}
