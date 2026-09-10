import { useEffect, useRef, useState } from 'react';
import { UserPlus, Crown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const ROLES = [
  { id: 'gerente', label: 'Gerente', descripcion: 'Todo lo operativo. No da de alta empleados.' },
  { id: 'cajero', label: 'Cajero', descripcion: 'Vende, abre y cierra su caja.' },
  { id: 'vendedor', label: 'Vendedor', descripcion: 'Vende, no maneja caja.' },
  { id: 'profesional', label: 'Profesional', descripcion: 'Su agenda y sus clientes.' },
];

export default function Equipo() {
  const { negocio } = useAuth();
  const [usuarios, setUsuarios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState('lista'); // 'lista' | 'form'

  const [nombre, setNombre] = useState('');
  const [authUserId, setAuthUserId] = useState('');
  const [rol, setRol] = useState('cajero');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const guardandoRef = useRef(false);

  useEffect(() => {
    if (!negocio) return;
    cargar();
  }, [negocio]);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from('usuarios')
      .select('*')
      .eq('negocio_id', negocio.id)
      .order('nombre');
    setUsuarios(data || []);
    setCargando(false);
  }

  async function agregarUsuario(e) {
    e.preventDefault();
    if (guardandoRef.current) return;
    setError(null);

    const idLimpio = authUserId.trim();
    const uuidValido = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idLimpio);

    if (!nombre.trim()) {
      setError('Falta el nombre.');
      return;
    }
    if (!uuidValido) {
      setError('Ese UUID no tiene el formato correcto. Copialo tal cual de Supabase → Authentication → Users.');
      return;
    }

    guardandoRef.current = true;
    setGuardando(true);

    const { error: errInsert } = await supabase.from('usuarios').insert({
      negocio_id: negocio.id,
      auth_user_id: idLimpio,
      nombre: nombre.trim(),
      rol,
    });

    guardandoRef.current = false;
    setGuardando(false);

    if (errInsert) {
      setError(
        errInsert.code === '23505'
          ? 'Ese usuario ya está vinculado a un negocio (acá o en otro). Cada cuenta de Supabase Auth solo puede pertenecer a un negocio.'
          : 'No se pudo agregar. Revisá el UUID y probá de nuevo.'
      );
      return;
    }

    setNombre('');
    setAuthUserId('');
    setRol('cajero');
    setVista('lista');
    cargar();
  }

  async function cambiarRol(id, nuevoRol) {
    await supabase.from('usuarios').update({ rol: nuevoRol }).eq('id', id);
    cargar();
  }

  async function toggleActivo(u) {
    await supabase.from('usuarios').update({ activo: !u.activo }).eq('id', u.id);
    cargar();
  }

  if (vista === 'form') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-display text-xl text-ink">Agregar a alguien del equipo</p>
        </div>

        <div className="rounded-xl bg-accent-soft p-3 text-xs text-accent">
          Primero creá su cuenta en Supabase → Authentication → Add user (con "Auto Confirm User"
          marcado) y copiá el UUID que le queda asignado. Recién con ese UUID lo agregás acá.
        </div>

        <form onSubmit={agregarUsuario} className="space-y-3">
          <input
            placeholder="Nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <input
            placeholder="UUID de Supabase Auth"
            value={authUserId}
            onChange={(e) => setAuthUserId(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 font-mono text-xs outline-none focus:ring-2 focus:ring-accent"
          />

          <div className="space-y-2">
            {ROLES.map((r) => (
              <label
                key={r.id}
                className={`flex items-center justify-between rounded-xl p-3 shadow-card ${
                  rol === r.id ? 'bg-accent-soft' : 'bg-surface'
                }`}
              >
                <div>
                  <p className={`text-sm font-medium ${rol === r.id ? 'text-accent' : 'text-ink'}`}>{r.label}</p>
                  <p className="text-xs text-muted">{r.descripcion}</p>
                </div>
                <input
                  type="radio"
                  name="rol"
                  checked={rol === r.id}
                  onChange={() => setRol(r.id)}
                  className="h-4 w-4 accent-accent"
                />
              </label>
            ))}
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => setVista('lista')}
              className="flex-1 rounded-xl border border-line py-3 text-sm text-muted"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="flex-1 rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink disabled:opacity-60"
            >
              {guardando ? 'Agregando…' : 'Agregar'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-display text-xl text-ink">Equipo</p>
        <button
          onClick={() => setVista('form')}
          className="flex items-center gap-1 rounded-full bg-brand px-3 py-2 text-xs font-medium text-ink active:scale-[0.98]"
        >
          <UserPlus size={16} /> Agregar
        </button>
      </div>

      <div className="flex items-center gap-3 rounded-xl bg-surface p-3 shadow-card">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-soft">
          <Crown size={16} className="text-amber" />
        </span>
        <div>
          <p className="text-sm font-medium text-ink">Vos</p>
          <p className="text-xs text-muted">Dueño — acceso total, no se puede editar acá</p>
        </div>
      </div>

      {cargando && <p className="pt-4 text-center text-sm text-muted">Cargando…</p>}

      {!cargando && usuarios.length === 0 && (
        <p className="pt-4 text-center text-sm text-muted">
          Todavía no agregaste a nadie más. Con "Agregar" sumás la primera persona de tu equipo.
        </p>
      )}

      <div className="space-y-2">
        {usuarios.map((u) => (
          <div key={u.id} className={`rounded-xl bg-surface p-3 shadow-card ${!u.activo ? 'opacity-50' : ''}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink">
                  {u.nombre}
                  {!u.activo && <span className="ml-1.5 text-xs text-muted">· inactivo</span>}
                </p>
                <select
                  value={u.rol}
                  onChange={(e) => cambiarRol(u.id, e.target.value)}
                  disabled={!u.activo}
                  className="mt-1 rounded-lg border border-line bg-base px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
                >
                  {ROLES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => toggleActivo(u)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  u.activo ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'
                }`}
              >
                {u.activo ? 'Dar de baja' : 'Reactivar'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
