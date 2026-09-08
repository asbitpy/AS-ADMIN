import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    const { error } = await signIn(email, password);
    setCargando(false);
    if (error) setError('Usuario o contraseña incorrectos.');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-base px-6">
      <div className="w-full max-w-sm">
        <p className="text-center text-sm text-muted">AS ADMIN</p>
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
            className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <input
            type="password"
            required
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-accent"
          />

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={cargando}
            className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-white active:scale-[0.98] disabled:opacity-60"
          >
            {cargando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
