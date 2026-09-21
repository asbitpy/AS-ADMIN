import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// Distingue "datos incorrectos" de "no se pudo conectar": antes cualquier
// falla mostraba el mismo cartel, y en el celular (mala señal, datos
// cortados) parecía un error de contraseña.
function mensajeDeError(error) {
  const texto = `${error?.message || ''}`.toLowerCase();
  if (texto.includes('invalid login credentials') || error?.status === 400) {
    return 'Usuario o contraseña incorrectos. Revisá que el teclado no haya cambiado mayúsculas o agregado un espacio.';
  }
  if (texto.includes('email not confirmed')) {
    return 'Tu correo todavía no está confirmado. Avisale a AS BIT.';
  }
  return 'No se pudo conectar. Revisá tu internet e intentá de nuevo.';
}

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      // El correo va sin espacios ni mayúsculas: el teclado del celular
      // suele agregar un espacio al final o poner la primera letra en
      // mayúscula. La contraseña se envía tal cual, sin tocarla.
      const { error } = await signIn(email.trim().toLowerCase(), password);
      if (error) setError(mensajeDeError(error));
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-6">
      <div className="w-full max-w-sm">
        <img src="/asbit-logo.png" alt="AS BIT" className="mx-auto h-12 w-12" />
        <p className="mt-4 text-center text-sm text-muted">AS ADMIN</p>
        <h1 className="mt-1 text-center font-display text-3xl font-semibold text-ink">
          Tu negocio, hoy
        </h1>

        <form onSubmit={onSubmit} className="mt-8 space-y-3">
          <input
            type="email"
            required
            placeholder="Correo"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="email"
            className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <div className="relative">
            <input
              type={verPassword ? 'text' : 'password'}
              required
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-xl border border-line bg-surface py-3 pl-4 pr-11 text-sm outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="button"
              onClick={() => setVerPassword((v) => !v)}
              aria-label={verPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted"
            >
              {verPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={cargando}
            className="w-full rounded-xl bg-brand py-3 text-sm font-medium text-ink active:scale-[0.98] disabled:opacity-60"
          >
            {cargando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
