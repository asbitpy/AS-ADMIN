import { useEffect, useState } from 'react';
import { Building2, LogOut, Plus, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

// Herramienta interna de AS BIT, no un panel de negocio — vive fuera del
// Layout de siempre (sin barra lateral, sin depender de 'negocio') y
// solo la ve quien esté en 'staff_asbit' (migración 028). Reemplaza el
// insert a mano en el SQL Editor de Supabase por un formulario, pero el
// paso previo sigue siendo manual: la cuenta de Supabase Auth del dueño
// del negocio cliente hay que crearla antes, igual que con un empleado.

const MODULOS = [
  { id: 'agenda', label: 'Agenda (turnos)' },
  { id: 'pos', label: 'Vender (POS)' },
  { id: 'inventario', label: 'Inventario' },
  { id: 'ecommerce', label: 'Catálogo ecommerce' },
];

const PLANES = [
  { id: 'basico', label: 'Básico' },
  { id: 'negocio', label: 'Negocio' },
  { id: 'full', label: 'Full' },
];

function fechaTexto(fecha) {
  return new Intl.DateTimeFormat('es-PY', { timeZone: 'America/Asuncion', day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(fecha)
  );
}

export default function AdminNegocios() {
  const { session, signOut } = useAuth();
  const [esStaff, setEsStaff] = useState(null); // null = todavía no se sabe
  const [negocios, setNegocios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [formAbierto, setFormAbierto] = useState(false);

  useEffect(() => {
    if (!session) return;
    verificarAcceso();
  }, [session]);

  async function verificarAcceso() {
    const { data } = await supabase.from('staff_asbit').select('auth_user_id').eq('auth_user_id', session.user.id).maybeSingle();
    const soyStaff = !!data;
    setEsStaff(soyStaff);
    if (soyStaff) cargar();
  }

  async function cargar() {
    setCargando(true);
    const { data } = await supabase.from('negocios').select('*').order('creado_en', { ascending: false });
    setNegocios(data || []);
    setCargando(false);
  }

  if (esStaff === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base">
        <p className="text-sm text-muted">Cargando…</p>
      </div>
    );
  }

  if (!esStaff) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-base px-6 text-center">
        <p className="text-sm text-muted">No tenés acceso a esta pantalla.</p>
        <button onClick={signOut} className="text-xs font-medium text-accent">
          Cerrar sesión
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted">AS BIT · interno</p>
            <h1 className="font-display text-xl font-semibold text-ink">Negocios</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFormAbierto(true)}
              className="flex items-center gap-1 rounded-full bg-brand px-3 py-2 text-xs font-medium text-ink"
            >
              <Plus size={16} /> Nuevo negocio
            </button>
            <button onClick={signOut} title="Cerrar sesión" className="rounded-full p-2 text-muted hover:bg-surface2">
              <LogOut size={18} />
            </button>
          </div>
        </div>

        {cargando ? (
          <p className="pt-8 text-center text-sm text-muted">Cargando…</p>
        ) : negocios.length === 0 ? (
          <p className="pt-8 text-center text-sm text-muted">Todavía no hay ningún negocio cargado.</p>
        ) : (
          <div className="mt-6 overflow-hidden rounded-2xl bg-surface shadow-card">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs font-medium uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3">Rubro</th>
                  <th className="px-4 py-3">WhatsApp</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Módulos</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Alta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {negocios.map((n) => (
                  <tr key={n.id} className={!n.activo ? 'opacity-50' : ''}>
                    <td className="px-4 py-3 font-medium text-ink">{n.nombre}</td>
                    <td className="px-4 py-3 text-muted">{n.rubro}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{n.telefono_whatsapp}</td>
                    <td className="px-4 py-3 text-muted">{PLANES.find((p) => p.id === n.plan)?.label || n.plan}</td>
                    <td className="px-4 py-3 text-xs text-muted">{(n.modulos_activos || []).join(', ')}</td>
                    <td className="px-4 py-3 text-muted">{n.activo ? 'Activo' : 'Inactivo'}</td>
                    <td className="px-4 py-3 text-muted">{fechaTexto(n.creado_en)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formAbierto && (
        <NuevoNegocioModal
          onCerrar={() => setFormAbierto(false)}
          onCreado={() => {
            setFormAbierto(false);
            cargar();
          }}
        />
      )}
    </div>
  );
}

function NuevoNegocioModal({ onCerrar, onCreado }) {
  const [nombre, setNombre] = useState('');
  const [rubro, setRubro] = useState('');
  const [authUserId, setAuthUserId] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const [plan, setPlan] = useState('basico');
  const [modulos, setModulos] = useState(['agenda']);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  function toggleModulo(id) {
    setModulos((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  }

  async function guardar(e) {
    e.preventDefault();
    setError(null);

    const idLimpio = authUserId.trim();
    const uuidValido = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idLimpio);

    if (!nombre.trim() || !rubro.trim() || !telefono.trim()) {
      setError('Nombre, rubro y WhatsApp son obligatorios.');
      return;
    }
    if (!uuidValido) {
      setError('Ese UUID no tiene el formato correcto. Copialo de Supabase → Authentication → Users, después de crear la cuenta del dueño.');
      return;
    }
    if (modulos.length === 0) {
      setError('Elegí al menos un módulo.');
      return;
    }

    setGuardando(true);
    const { error: errInsert } = await supabase.from('negocios').insert({
      nombre: nombre.trim(),
      rubro: rubro.trim(),
      auth_user_id: idLimpio,
      telefono_whatsapp: telefono.trim(),
      direccion: direccion.trim() || null,
      plan,
      modulos_activos: modulos,
    });
    setGuardando(false);

    if (errInsert) {
      setError(
        errInsert.code === '23505'
          ? 'Ya existe un negocio con ese número de WhatsApp (o esa cuenta ya es dueña de otro negocio).'
          : 'No se pudo crear. Probá de nuevo.'
      );
      return;
    }
    onCreado();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCerrar}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 font-display text-xl text-ink">
            <Building2 size={20} /> Nuevo negocio
          </p>
          <button onClick={onCerrar} className="shrink-0 text-muted">
            <X size={20} />
          </button>
        </div>

        <div className="mt-3 rounded-xl bg-accent-soft p-3 text-xs text-accent">
          Primero creá la cuenta del dueño en Supabase → Authentication → Add user (con "Auto Confirm User" marcado)
          y copiá el UUID que le queda asignado. Recién con ese UUID lo cargás acá.
        </div>

        <form onSubmit={guardar} className="mt-3 space-y-3">
          <input
            placeholder="Nombre del negocio"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <input
            placeholder="Rubro (clínica, nutricionista, tienda de ropa…)"
            value={rubro}
            onChange={(e) => setRubro(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <input
            placeholder="UUID de Supabase Auth (del dueño)"
            value={authUserId}
            onChange={(e) => setAuthUserId(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 font-mono text-xs outline-none focus:ring-2 focus:ring-accent"
          />
          <input
            placeholder="Número de WhatsApp del negocio"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <input
            placeholder="Dirección (opcional)"
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
          />

          <div>
            <label className="text-xs text-muted">Plan</label>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
            >
              {PLANES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-muted">Módulos activos</label>
            <div className="mt-1 space-y-1.5">
              {MODULOS.map((m) => (
                <label key={m.id} className="flex items-center gap-2 rounded-lg bg-base px-3 py-2 text-sm text-ink">
                  <input type="checkbox" checked={modulos.includes(m.id)} onChange={() => toggleModulo(m.id)} className="h-4 w-4 accent-accent" />
                  {m.label}
                </label>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onCerrar} className="flex-1 rounded-xl border border-line py-3 text-sm text-muted">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="flex-1 rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink disabled:opacity-60"
            >
              {guardando ? 'Creando…' : 'Crear negocio'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
