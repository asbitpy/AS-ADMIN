import { useEffect, useState } from 'react';
import { Building2, LogOut, Plus, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { crearCuentaAuth, resetearPassword } from '../lib/backend';

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
  const [negocioAbierto, setNegocioAbierto] = useState(null);

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
                  <tr
                    key={n.id}
                    onClick={() => setNegocioAbierto(n)}
                    className={`cursor-pointer hover:bg-surface2 ${!n.activo ? 'opacity-50' : ''}`}
                  >
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

      {negocioAbierto && (
        <EditarNegocioModal
          negocio={negocioAbierto}
          onCerrar={() => setNegocioAbierto(null)}
          onGuardado={() => {
            setNegocioAbierto(null);
            cargar();
          }}
        />
      )}
    </div>
  );
}

// Hasta ahora esta pantalla solo dejaba CREAR un negocio — si un cliente
// pagaba un plan mejor, no había forma de habilitarle los módulos
// nuevos sin entrar a Supabase a mano. Esto cierra ese hueco: plan,
// módulos y activo/inactivo, editables desde acá. La política "staff de
// as bit edita negocios" (migración 028) ya lo permite, no hace falta
// nada nuevo del lado de la base.
function EditarNegocioModal({ negocio, onCerrar, onGuardado }) {
  const [plan, setPlan] = useState(negocio.plan);
  const [modulos, setModulos] = useState(negocio.modulos_activos || []);
  const [activo, setActivo] = useState(negocio.activo);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [confirmarReset, setConfirmarReset] = useState(false);
  const [reseteando, setReseteando] = useState(false);
  const [passwordNueva, setPasswordNueva] = useState(null);

  function toggleModulo(id) {
    setModulos((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  }

  async function resetearPasswordDueno() {
    setReseteando(true);
    try {
      const { password } = await resetearPassword({ authUserId: negocio.auth_user_id });
      setPasswordNueva(password);
      setConfirmarReset(false);
    } catch (err) {
      setError(err.message || 'No se pudo resetear la contraseña.');
    } finally {
      setReseteando(false);
    }
  }

  async function guardar() {
    if (modulos.length === 0) {
      setError('Elegí al menos un módulo.');
      return;
    }
    setError(null);
    setGuardando(true);
    const { error: errUpdate } = await supabase
      .from('negocios')
      .update({ plan, modulos_activos: modulos, activo })
      .eq('id', negocio.id);
    setGuardando(false);
    if (errUpdate) {
      setError('No se pudo guardar. Probá de nuevo.');
      return;
    }
    onGuardado();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCerrar}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <p className="flex items-center gap-2 font-display text-xl text-ink">
              <Building2 size={20} /> {negocio.nombre}
            </p>
            <p className="text-xs text-muted">
              {negocio.rubro} · {negocio.telefono_whatsapp}
            </p>
          </div>
          <button onClick={onCerrar} className="shrink-0 text-muted">
            <X size={20} />
          </button>
        </div>

        <div className="mt-4 space-y-3">
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

          <label className="flex items-center gap-2 rounded-lg bg-base px-3 py-2 text-sm text-ink">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="h-4 w-4 accent-accent" />
            Negocio activo
          </label>

          <div className="rounded-xl bg-base p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Acceso del dueño</p>
            {passwordNueva ? (
              <>
                <p className="mt-2 text-xs text-muted">
                  Nueva contraseña generada — pasásela ahora, no se vuelve a mostrar:
                </p>
                <p className="mt-1 select-all rounded-lg bg-accent-soft px-3 py-2 font-mono text-lg text-accent">
                  {passwordNueva}
                </p>
                <button type="button" onClick={() => setPasswordNueva(null)} className="mt-2 text-xs font-medium text-accent">
                  Listo
                </button>
              </>
            ) : confirmarReset ? (
              <>
                <p className="mt-2 text-xs text-amber">La contraseña anterior del dueño deja de funcionar. ¿Seguro?</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmarReset(false)}
                    className="flex-1 rounded-lg border border-line py-2 text-xs text-muted"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={resetearPasswordDueno}
                    disabled={reseteando}
                    className="flex-1 rounded-lg bg-accent py-2 text-xs font-medium text-accent-ink disabled:opacity-60"
                  >
                    {reseteando ? 'Generando…' : 'Sí, generar'}
                  </button>
                </div>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmarReset(true)} className="mt-2 text-xs font-medium text-accent">
                Generar nueva contraseña (se olvidó la suya)
              </button>
            )}
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onCerrar} className="flex-1 rounded-xl border border-line py-3 text-sm text-muted">
              Cancelar
            </button>
            <button
              onClick={guardar}
              disabled={guardando}
              className="flex-1 rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink disabled:opacity-60"
            >
              {guardando ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NuevoNegocioModal({ onCerrar, onCreado }) {
  const [nombre, setNombre] = useState('');
  const [rubro, setRubro] = useState('');
  const [email, setEmail] = useState('');
  const [passwordElegida, setPasswordElegida] = useState('');
  const [telefono, setTelefono] = useState('');
  const [direccion, setDireccion] = useState('');
  const [plan, setPlan] = useState('basico');
  const [modulos, setModulos] = useState(['agenda']);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [cuentaCreada, setCuentaCreada] = useState(null); // { email, password } — se muestra una sola vez

  function toggleModulo(id) {
    setModulos((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  }

  async function guardar(e) {
    e.preventDefault();
    setError(null);

    if (!nombre.trim() || !rubro.trim() || !telefono.trim() || !email.trim()) {
      setError('Nombre, rubro, WhatsApp y email del dueño son obligatorios.');
      return;
    }
    if (modulos.length === 0) {
      setError('Elegí al menos un módulo.');
      return;
    }
    if (passwordElegida.trim() && passwordElegida.trim().length < 6) {
      setError('La contraseña tiene que tener al menos 6 caracteres.');
      return;
    }

    setGuardando(true);
    try {
      // Reemplaza el paso manual de crear la cuenta del dueño en
      // Supabase → Authentication → Add user. Si no se eligió
      // contraseña, el backend genera una temporal sola.
      const { auth_user_id, password } = await crearCuentaAuth({
        email: email.trim(),
        nombre: nombre.trim(),
        password: passwordElegida.trim() || undefined,
      });

      const { error: errInsert } = await supabase.from('negocios').insert({
        nombre: nombre.trim(),
        rubro: rubro.trim(),
        auth_user_id,
        telefono_whatsapp: telefono.trim(),
        direccion: direccion.trim() || null,
        plan,
        modulos_activos: modulos,
      });

      if (errInsert) {
        throw new Error(
          errInsert.code === '23505'
            ? 'Ya existe un negocio con ese número de WhatsApp.'
            : `La cuenta se creó pero el negocio no se pudo guardar. Volvé a intentar, o cargalo a mano con este UUID: ${auth_user_id}`
        );
      }

      setCuentaCreada({ email: email.trim(), password });
    } catch (err) {
      setError(err.message || 'No se pudo crear. Probá de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  if (cuentaCreada) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCreado}>
        <div className="w-full max-w-lg rounded-2xl bg-surface p-5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 font-display text-xl text-ink">
              <Building2 size={20} /> Negocio creado
            </p>
            <button onClick={onCreado} className="shrink-0 text-muted">
              <X size={20} />
            </button>
          </div>

          <p className="mt-3 text-sm text-ink">
            Pasale estos datos al dueño para que entre por primera vez — la contraseña no se vuelve a
            mostrar, si se pierde hay que generar una nueva.
          </p>

          <div className="mt-3 space-y-2 rounded-xl bg-accent-soft p-3">
            <div>
              <p className="text-xs text-accent">Email</p>
              <p className="select-all font-mono text-sm text-accent">{cuentaCreada.email}</p>
            </div>
            <div>
              <p className="text-xs text-accent">Contraseña</p>
              <p className="select-all font-mono text-lg text-accent">{cuentaCreada.password}</p>
            </div>
          </div>

          <button onClick={onCreado} className="mt-4 w-full rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink">
            Listo
          </button>
        </div>
      </div>
    );
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

        <p className="mt-3 text-xs text-muted">
          Se crea la cuenta del dueño sola con el email que cargues acá. Si no le ponés contraseña, se
          genera una automática que te mostramos al final.
        </p>

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
            type="email"
            placeholder="Email del dueño"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <input
            placeholder="Contraseña (opcional — se genera una si lo dejás vacío)"
            value={passwordElegida}
            onChange={(e) => setPasswordElegida(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
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
