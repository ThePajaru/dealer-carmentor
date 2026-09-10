'use client';

// La puerta de este proyecto. Al separar el dealer del monolito, `/login` se
// quedó allí: la app del dealer, el onboarding y el panel de colaborador
// redirigen aquí, así que sin esta página no se entra a nada.
//
// Dos formas de entrar: Google (es como entran las cuentas que venían del
// monolito) y correo + contraseña, que es lo que expone useAuth.
//
// OJO con el cliente de Supabase de este proyecto: `detectSessionInUrl: false`.
// La vuelta de Google trae un `?code=` que NADIE canjea solo — hay que llamar a
// `exchangeCodeForSession` a mano, y es justo lo que hace el efecto de abajo.

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Loader2, Mail, Car } from 'lucide-react';

function LoginForm() {
  const { user, loading: authLoading, signIn, signUp } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  // Solo se aceptan destinos internos: un `redirect` con host propio convertiría
  // el login en un trampolín a otro sitio.
  const raw = params.get('redirect') || '/dealer/operaciones';
  const redirect = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dealer/operaciones';

  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const code = params.get('code');
  const [exchanging, setExchanging] = useState(!!code);

  // Vuelta de Google (PKCE): canjear el código por sesión antes de nada.
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    (async () => {
      const { error: err } = await supabase.auth.exchangeCodeForSession(window.location.href);
      if (cancelled) return;
      if (err) {
        setError(err.message || 'No se pudo completar el acceso con Google');
        setExchanging(false);
        return;
      }
      router.replace(redirect);
    })();
    return () => { cancelled = true; };
  }, [code, redirect, router]);

  useEffect(() => {
    if (!authLoading && user && !code) router.replace(redirect);
  }, [authLoading, user, code, redirect, router]);

  const entrarConGoogle = async () => {
    setBusy(true);
    setError(null);
    // Se vuelve a ESTA página con el `redirect` intacto: así el destino
    // sobrevive al viaje a Google.
    const back = `${window.location.origin}/login?redirect=${encodeURIComponent(redirect)}`;
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: back },
    });
    if (err) {
      setError(err.message || 'No se pudo abrir Google');
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = mode === 'in'
      ? await signIn(email.trim(), password)
      : await signUp(email.trim(), password);

    if (err) {
      setError(err.message || 'No se pudo completar');
      setBusy(false);
      return;
    }
    if (mode === 'up') {
      // Según la configuración de Supabase el alta puede exigir confirmar el
      // correo; si no la exige, el efecto de arriba ya redirige.
      setSent(true);
      setBusy(false);
      return;
    }
    router.replace(redirect);
  };

  if (exchanging || authLoading || (user && !code)) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="w-8 h-8 text-d-accent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <Link href="/dealer" className="flex items-center justify-center gap-2 mb-7 no-underline">
          {/* El PNG de marca es azul marino: sobre el fondo negro no se ve.
              Misma solución que la sidebar del dealer — icono en tesela. */}
          <span className="d-ic w-8 h-8"><Car className="w-4 h-4" /></span>
          <span className="text-[19px] font-bold text-d-text">CarMentor</span>
          <span className="d-pill">Dealer</span>
        </Link>

        <div className="d-card p-6">
          <h1 className="text-[18px] font-semibold text-d-text">
            {mode === 'in' ? 'Entra a tu panel' : 'Crea tu cuenta'}
          </h1>
          <p className="text-d-dim text-[13px] mt-1 mb-5">
            {mode === 'in'
              ? 'Con el correo de tu compraventa.'
              : 'Después de crearla te pediremos los datos de tu compraventa.'}
          </p>

          <button
            onClick={entrarConGoogle}
            disabled={busy}
            className="d-btn-ghost w-full rounded-lg py-2.5 text-sm font-medium inline-flex items-center justify-center gap-2.5 disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden>
              <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z" />
              <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" />
              <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.8l4-3.1z" />
              <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
            </svg>
            Continuar con Google
          </button>

          <div className="flex items-center gap-3 my-4">
            <span className="h-px flex-1 bg-d-border" />
            <span className="text-d-dim text-[11px]">o con tu correo</span>
            <span className="h-px flex-1 bg-d-border" />
          </div>

          {sent ? (
            <div className="text-center py-4">
              <span className="d-ic w-11 h-11 mx-auto"><Mail className="w-5 h-5" /></span>
              <p className="text-d-text text-sm font-medium mt-3">Revisa tu correo</p>
              <p className="text-d-dim text-[13px] mt-1">
                Te hemos enviado un enlace a <span className="text-d-text-2">{email}</span> para
                confirmar la cuenta.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <label className="block space-y-1">
                <span className="block text-[11px] text-d-dim">Correo</span>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="tu@compraventa.es"
                  className="d-input w-full px-3 py-2.5 text-sm"
                />
              </label>
              <label className="block space-y-1">
                <span className="block text-[11px] text-d-dim">Contraseña</span>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                  placeholder="········"
                  className="d-input w-full px-3 py-2.5 text-sm"
                />
              </label>

              {error && (
                <div className="rounded-lg border border-d-red/25 bg-d-red/5 px-3 py-2 text-[13px] text-d-red">
                  {error}
                </div>
              )}

              <Button type="submit" disabled={busy} className="d-btn-primary w-full text-sm">
                {busy && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
                {mode === 'in' ? 'Entrar' : 'Crear cuenta'}
              </Button>
            </form>
          )}

          {!sent && (
            <p className="text-d-dim text-[13px] mt-4 text-center">
              {mode === 'in' ? '¿Aún no tienes cuenta?' : '¿Ya tienes cuenta?'}{' '}
              <button
                onClick={() => { setMode(m => (m === 'in' ? 'up' : 'in')); setError(null); }}
                className="d-link"
              >
                {mode === 'in' ? 'Crear una' : 'Entrar'}
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="dealer-root dealer-root--scroll">
      {/* useSearchParams obliga a un límite de Suspense en el App Router. */}
      <Suspense fallback={<div className="min-h-screen grid place-items-center"><Loader2 className="w-8 h-8 text-d-accent animate-spin" /></div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
