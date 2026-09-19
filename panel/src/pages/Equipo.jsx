import { useEffect, useRef, useState } from 'react';
import { UserPlus, Crown, X, ChevronRight, ChevronLeft, Plus, Trash2, Wallet, TrendingUp, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useEsEscritorio } from '../hooks/useEsEscritorio';
import { crearCuentaAuth, resetearPassword } from '../lib/backend';
import MetricPill from '../components/MetricPill';
import { PERMISOS } from '../lib/permisos';

const ROLES = [
  { id: 'gerente', label: 'Gerente', descripcion: 'Todo lo operativo. No da de alta empleados.' },
  { id: 'cajero', label: 'Cajero', descripcion: 'Vende, abre y cierra su caja.' },
  { id: 'vendedor', label: 'Vendedor', descripcion: 'Vende, no maneja caja.' },
  { id: 'profesional', label: 'Profesional', descripcion: 'Su agenda y sus clientes.' },
];

// Mismos días y mismo formato "HH:MM-HH:MM" que negocios.config.horarios
// (ver HorariosAtencion.jsx) — un día sin franjas es un día libre, sin
// necesidad de un campo aparte para eso.
const DIAS = [
  { id: 'lun', label: 'Lunes' },
  { id: 'mar', label: 'Martes' },
  { id: 'mie', label: 'Miércoles' },
  { id: 'jue', label: 'Jueves' },
  { id: 'vie', label: 'Viernes' },
  { id: 'sab', label: 'Sábado' },
  { id: 'dom', label: 'Domingo' },
];

function partesBloque(bloque) {
  const [desde, hasta] = bloque.split('-');
  return { desde: desde || '08:00', hasta: hasta || '12:00' };
}

function fechaTexto(fecha) {
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(fecha));
}

// Mismo criterio que Productos: a partir del millón se abrevia para que
// entre en una píldora de métrica sin cortarse.
function formatoGsCompacto(monto) {
  const n = Number(monto);
  if (n >= 1_000_000) {
    return `Gs. ${(n / 1_000_000).toLocaleString('es-PY', { maximumFractionDigits: 1 })} M`;
  }
  return `Gs. ${n.toLocaleString('es-PY')}`;
}

export default function Equipo() {
  const { negocio, esDueno } = useAuth();
  const { esEscritorio } = useEsEscritorio();
  const tieneRetail = (negocio?.modulos_activos || []).some((m) => m === 'pos' || m === 'inventario');
  const [usuarios, setUsuarios] = useState([]);
  const [actividad, setActividad] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState('lista'); // 'lista' | 'form'
  const [empleadoAbierto, setEmpleadoAbierto] = useState(null);

  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [passwordElegida, setPasswordElegida] = useState('');
  const [rol, setRol] = useState('cajero');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [cuentaCreada, setCuentaCreada] = useState(null); // { email, password } — se muestra una sola vez
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
    cargarActividad(data || []);
  }

  // "Todos juntos" (lo que pidió Arturo): cuánto trabajó y cuánto vendió
  // cada persona, dueño incluido si también usa la caja. Se arma acá
  // (no en una vista de Postgres) porque cruza dos tablas con id de dos
  // orígenes distintos (auth.uid() del dueño vs. usuarios.auth_user_id).
  async function cargarActividad(listaUsuarios) {
    if (!tieneRetail) {
      setActividad([]);
      return;
    }
    const [ventasRes, cajasRes] = await Promise.all([
      supabase.from('ventas').select('usuario_id, total').eq('negocio_id', negocio.id).eq('estado', 'completada'),
      supabase.from('caja_sesiones').select('usuario_id').eq('negocio_id', negocio.id),
    ]);

    const mapa = new Map();
    // Una venta o caja sin usuario_id es de antes de que fn_crear_venta
    // empezara a grabarlo, o se hizo sin cajero asignado — se cuenta
    // como del dueño, no como "Sin asignar" (lo pidió Arturo: esa plata
    // la vendió alguien, y por descarte solo puede ser él).
    function fila(idCrudo) {
      const id = idCrudo || negocio.auth_user_id;
      if (!mapa.has(id)) {
        let nombre = 'Sin asignar';
        if (id === negocio.auth_user_id) nombre = negocio.nombre_dueno || 'Vos';
        else {
          const u = listaUsuarios.find((x) => x.auth_user_id === id);
          if (u) nombre = u.nombre;
        }
        mapa.set(id, { id, nombre, diasTrabajados: 0, ventasCount: 0, totalVendido: 0 });
      }
      return mapa.get(id);
    }

    for (const c of cajasRes.data || []) fila(c.usuario_id).diasTrabajados += 1;
    for (const v of ventasRes.data || []) {
      const f = fila(v.usuario_id);
      f.ventasCount += 1;
      f.totalVendido += Number(v.total);
    }

    setActividad(Array.from(mapa.values()).sort((a, b) => b.totalVendido - a.totalVendido));
  }

  async function agregarUsuario(e) {
    e.preventDefault();
    if (guardandoRef.current) return;
    setError(null);

    if (!nombre.trim()) {
      setError('Falta el nombre.');
      return;
    }
    if (!email.trim()) {
      setError('Falta el email.');
      return;
    }
    if (passwordElegida.trim() && passwordElegida.trim().length < 6) {
      setError('La contraseña tiene que tener al menos 6 caracteres.');
      return;
    }

    guardandoRef.current = true;
    setGuardando(true);

    try {
      // El backend crea la cuenta de Supabase Auth (necesita la service
      // key, por eso no se puede hacer directo desde acá) — reemplaza el
      // paso manual de ir a Supabase → Authentication → Add user. Si no
      // se eligió contraseña, el backend genera una temporal sola.
      const { auth_user_id, password } = await crearCuentaAuth({
        email: email.trim(),
        nombre: nombre.trim(),
        password: passwordElegida.trim() || undefined,
      });

      const { error: errInsert } = await supabase.from('usuarios').insert({
        negocio_id: negocio.id,
        auth_user_id,
        nombre: nombre.trim(),
        rol,
      });

      if (errInsert) {
        // La cuenta ya se creó en Auth aunque esto falle — se avisa el
        // UUID para no dejarla huérfana sin forma de recuperarla.
        throw new Error(
          errInsert.code === '23505'
            ? 'Esa cuenta ya está vinculada a un negocio.'
            : `La cuenta se creó pero no se pudo vincular al equipo. Volvé a intentar, o pasale este UUID a soporte: ${auth_user_id}`
        );
      }

      setCuentaCreada({ email: email.trim(), password });
      setNombre('');
      setEmail('');
      setPasswordElegida('');
      setRol('cajero');
      cargar();
    } catch (err) {
      setError(err.message || 'No se pudo agregar. Probá de nuevo.');
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  }

  async function cambiarRol(id, nuevoRol) {
    await supabase.from('usuarios').update({ rol: nuevoRol }).eq('id', id);
    cargar();
  }

  async function toggleActivo(u) {
    await supabase.from('usuarios').update({ activo: !u.activo }).eq('id', u.id);
    cargar();
  }

  // En escritorio la ficha va como panel lateral (más abajo, dentro del
  // grid de dos columnas) en vez de tapar toda la pantalla — en celular
  // sigue siendo una pantalla completa, sin cambios.
  if (empleadoAbierto && !esEscritorio) {
    return (
      <FichaEmpleado
        empleado={empleadoAbierto}
        onVolver={() => setEmpleadoAbierto(null)}
        onActualizado={(actualizado) => {
          setEmpleadoAbierto(actualizado);
          cargar();
        }}
      />
    );
  }

  function cerrarFormulario() {
    setVista('lista');
    setCuentaCreada(null);
    setError(null);
    setPasswordElegida('');
  }

  const formulario = (
    <div
      className={`fixed inset-0 z-50 flex bg-black/60 ${esEscritorio ? 'items-center justify-center' : 'items-end'}`}
      onClick={cerrarFormulario}
    >
      <div
        className={`flex max-h-[85vh] w-full flex-col overflow-y-auto bg-surface p-5 pb-6 ${
          esEscritorio ? 'max-w-md rounded-2xl' : 'mx-auto max-w-md rounded-t-2xl'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {cuentaCreada ? (
          <>
            <div className="flex items-center justify-between">
              <p className="font-display text-xl text-ink">Cuenta creada</p>
              <button onClick={cerrarFormulario} className="shrink-0 text-muted">
                <X size={20} />
              </button>
            </div>

            <p className="mt-3 text-sm text-ink">
              Ya se agregó al equipo. Pasale estos datos para que entre por primera vez — la contraseña
              no se vuelve a mostrar, si se pierde hay que pedir una nueva.
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

            <button
              onClick={cerrarFormulario}
              className="mt-4 w-full rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink"
            >
              Listo
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="font-display text-xl text-ink">Agregar a alguien del equipo</p>
              <button onClick={cerrarFormulario} className="shrink-0 text-muted">
                <X size={20} />
              </button>
            </div>

            <p className="mt-3 text-xs text-muted">
              Se crea la cuenta sola con el email que cargues acá. Si no le ponés contraseña, se
              genera una automática que te mostramos al final.
            </p>

            <form onSubmit={agregarUsuario} className="mt-3 space-y-3">
              <input
                placeholder="Nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
              />
              <input
                type="email"
                placeholder="Email"
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

              <div className="space-y-2">
                {ROLES.map((r) => (
                  <label
                    key={r.id}
                    className={`flex items-center justify-between rounded-xl p-3 shadow-card ${
                      rol === r.id ? 'bg-accent-soft' : 'bg-surface2'
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
                  onClick={cerrarFormulario}
                  className="flex-1 rounded-xl border border-line py-3 text-sm text-muted"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardando}
                  className="flex-1 rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink disabled:opacity-60"
                >
                  {guardando ? 'Creando cuenta…' : 'Agregar'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-display text-xl text-ink">Equipo</p>
        {esDueno && (
          <button
            onClick={() => setVista('form')}
            className="flex items-center gap-1 rounded-full bg-brand px-3 py-2 text-xs font-medium text-ink active:scale-[0.98]"
          >
            <UserPlus size={16} /> Agregar
          </button>
        )}
      </div>

      {esEscritorio && !cargando && (
        <div className="flex gap-3">
          <MetricPill label="Personas" value={usuarios.length + 1} />
          <MetricPill label="Activos" value={usuarios.filter((u) => u.activo).length + 1} tone="accent" />
          {tieneRetail && (
            <MetricPill
              label="Vendido (equipo)"
              value={formatoGsCompacto(actividad.reduce((acc, a) => acc + a.totalVendido, 0))}
              tone="accent"
              compact
            />
          )}
        </div>
      )}

      {!esEscritorio && (
        <div className="flex items-center gap-3 rounded-xl bg-surface p-3 shadow-card">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-soft">
            <Crown size={16} className="text-amber" />
          </span>
          <div>
            <p className="text-sm font-medium text-ink">{negocio?.nombre_dueno || 'Vos'}</p>
            <p className="text-xs text-muted">Dueño — acceso total, no se puede editar acá</p>
          </div>
        </div>
      )}

      {cargando && <p className="pt-4 text-center text-sm text-muted">Cargando…</p>}

      {!cargando && usuarios.length === 0 && !esEscritorio && (
        <p className="pt-4 text-center text-sm text-muted">
          Todavía no agregaste a nadie más. Con "Agregar" sumás la primera persona de tu equipo.
        </p>
      )}

      {!cargando && usuarios.length > 0 && !esEscritorio && (
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
      )}

      {!cargando && esEscritorio && (
        <div className="grid items-start gap-4" style={{ gridTemplateColumns: '1fr 480px' }}>
          <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs font-medium uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3">Rol</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <tr>
                  <td className="px-4 py-3 font-medium text-ink">
                    <span className="flex items-center gap-1.5">
                      <Crown size={14} className="text-amber" /> {negocio?.nombre_dueno || 'Vos'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted">Dueño</td>
                  <td className="px-4 py-3 text-muted">Activo</td>
                  <td className="px-4 py-3 text-right text-xs text-muted">Acceso total</td>
                </tr>
                {usuarios.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => setEmpleadoAbierto(u)}
                    className={`cursor-pointer hover:bg-surface2 ${!u.activo ? 'opacity-50' : ''} ${
                      empleadoAbierto?.id === u.id ? 'bg-accent-soft' : ''
                    }`}
                  >
                    <td className="px-4 py-3 font-medium text-ink">
                      <span className="flex items-center gap-1.5">
                        {u.nombre}
                        {empleadoAbierto?.id === u.id && <ChevronRight size={14} className="text-accent" />}
                      </span>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={u.rol}
                        onChange={(e) => cambiarRol(u.id, e.target.value)}
                        disabled={!u.activo}
                        className="rounded-lg border border-line bg-base px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
                      >
                        {ROLES.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-muted">{u.activo ? 'Activo' : 'Inactivo'}</td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleActivo(u)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                          u.activo ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'
                        }`}
                      >
                        {u.activo ? 'Dar de baja' : 'Reactivar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {usuarios.length === 0 && (
              <p className="p-4 text-center text-xs text-muted">
                Todavía no agregaste a nadie más. Con "Agregar" sumás la primera persona de tu equipo.
              </p>
            )}
          </div>

          <div className="space-y-3">
            {empleadoAbierto ? (
              <FichaEmpleado
                panel
                empleado={empleadoAbierto}
                onVolver={() => setEmpleadoAbierto(null)}
                onActualizado={(actualizado) => {
                  setEmpleadoAbierto(actualizado);
                  cargar();
                }}
              />
            ) : (
              <ActividadRanking actividad={actividad} tieneRetail={tieneRetail} />
            )}
          </div>
        </div>
      )}

      {vista === 'form' && formulario}
    </div>
  );
}

const ETIQUETAS_ROL = {
  gerente: 'Gerente',
  cajero: 'Cajero',
  vendedor: 'Vendedor',
  profesional: 'Profesional',
};

// Contenido por defecto del panel lateral de escritorio, cuando no hay
// nadie seleccionado en la tabla: reemplaza a la vieja lista apretada
// de "Actividad del equipo" por un ranking con barra, más fácil de leer
// de un vistazo (quién vendió más, sin tener que comparar números).
function ActividadRanking({ actividad, tieneRetail }) {
  if (!tieneRetail) {
    return (
      <div className="rounded-2xl bg-surface p-6 text-center shadow-card">
        <Users size={20} className="mx-auto text-muted" />
        <p className="mt-2 text-sm text-muted">Hacé clic en una persona para ver o editar su sueldo y horario.</p>
      </div>
    );
  }

  if (actividad.length === 0) {
    return (
      <div className="rounded-2xl bg-surface p-6 text-center shadow-card">
        <TrendingUp size={20} className="mx-auto text-muted" />
        <p className="mt-2 text-sm text-muted">Todavía no hay ventas ni cajas registradas para mostrar actividad.</p>
      </div>
    );
  }

  const max = Math.max(...actividad.map((a) => a.totalVendido), 1);

  return (
    <div className="rounded-2xl bg-surface p-4 shadow-card">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
        <TrendingUp size={13} /> Actividad del equipo
      </p>
      <p className="mt-0.5 text-xs text-muted">Quién vendió más y cuántos días trabajó, todos juntos.</p>

      <div className="mt-3 space-y-3">
        {actividad.map((a, i) => (
          <div key={a.id}>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5 truncate font-medium text-ink">
                {i === 0 && a.totalVendido > 0 && <Crown size={13} className="shrink-0 text-amber" />}
                <span className="truncate">{a.nombre}</span>
              </span>
              <span className="shrink-0 font-mono text-xs text-accent">Gs. {a.totalVendido.toLocaleString('es-PY')}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${(a.totalVendido / max) * 100}%` }} />
            </div>
            <p className="mt-0.5 text-[10px] text-muted">
              {a.diasTrabajados} días · {a.ventasCount} ventas
            </p>
          </div>
        ))}
      </div>

      <p className="mt-3 border-t border-line pt-2 text-[11px] text-muted">
        Hacé clic en una persona de la lista para ver su ficha, sueldo y horario.
      </p>
    </div>
  );
}

// Sueldo y horario semanal de un empleado — lo pidió Arturo para que
// la ficha quede completa. A propósito NO es el módulo de "Jornadas"
// del documento de pantallas (grilla + fichaje + comisiones): esto es
// más chico, un horario de referencia por persona, mismo formato que
// ya usa HorariosAtencion.jsx para el negocio.
function FichaEmpleado({ empleado, onVolver, onActualizado, panel = false }) {
  const { negocio } = useAuth();
  const tieneRetail = (negocio?.modulos_activos || []).some((m) => m === 'pos' || m === 'inventario');
  const [sueldo, setSueldo] = useState(empleado.sueldo ?? '');
  const [horario, setHorario] = useState(empleado.horario || {});
  // Datos de contacto/referencia — solo se editan desde el panel de
  // escritorio (más abajo, gateado con `panel`), pero el estado vive acá
  // igual para que el guardado sea uno solo. En celular no hay campos
  // para tocarlos, así que viajan de vuelta sin cambios.
  const [telefono, setTelefono] = useState(empleado.telefono || '');
  const [email, setEmail] = useState(empleado.email || '');
  const [documento, setDocumento] = useState(empleado.documento || '');
  const [fechaIngreso, setFechaIngreso] = useState(empleado.fecha_ingreso || '');
  const [notas, setNotas] = useState(empleado.notas || '');
  // Permisos por excepción (migración 029) — hoy el único que hace algo
  // de verdad es 'anular_ventas': por default eso quedó restringido a
  // dueño/gerente, esto es la forma de darle esa excepción puntual a
  // un cajero o vendedor sin ascenderlo.
  const [permisosExtra, setPermisosExtra] = useState(empleado.permisos_extra || []);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [guardadoOk, setGuardadoOk] = useState(false);
  const [cajas, setCajas] = useState(null);
  const [resumenVentas, setResumenVentas] = useState(null);
  // Resetear contraseña (por si se olvidó) — solo panel de escritorio.
  const [confirmarReset, setConfirmarReset] = useState(false);
  const [reseteando, setReseteando] = useState(false);
  const [passwordNueva, setPasswordNueva] = useState(null);

  async function resetearPasswordEmpleado() {
    setReseteando(true);
    try {
      const { password } = await resetearPassword({ authUserId: empleado.auth_user_id });
      setPasswordNueva(password);
      setConfirmarReset(false);
    } catch (err) {
      setError(err.message || 'No se pudo resetear la contraseña.');
    } finally {
      setReseteando(false);
    }
  }

  useEffect(() => {
    if (!tieneRetail) return;
    cargarActividadPropia();
  }, [empleado.id]);

  async function cargarActividadPropia() {
    const [cajasRes, ventasRes] = await Promise.all([
      supabase
        .from('caja_sesiones')
        .select('id, abierta_en, cerrada_en, monto_inicial, monto_real, diferencia, estado')
        .eq('usuario_id', empleado.auth_user_id)
        .eq('negocio_id', negocio.id)
        .order('abierta_en', { ascending: false })
        .limit(20),
      supabase
        .from('ventas')
        .select('total')
        .eq('usuario_id', empleado.auth_user_id)
        .eq('negocio_id', negocio.id)
        .eq('estado', 'completada'),
    ]);
    setCajas(cajasRes.data || []);
    const ventas = ventasRes.data || [];
    setResumenVentas({
      cantidad: ventas.length,
      total: ventas.reduce((acc, v) => acc + Number(v.total), 0),
    });
  }

  function agregarBloque(dia) {
    setHorario((prev) => ({ ...prev, [dia]: [...(prev[dia] || []), '08:00-12:00'] }));
  }

  function quitarBloque(dia, i) {
    setHorario((prev) => ({ ...prev, [dia]: prev[dia].filter((_, idx) => idx !== i) }));
  }

  function cambiarBloque(dia, i, parte, valor) {
    setHorario((prev) => {
      const bloques = [...prev[dia]];
      const actuales = partesBloque(bloques[i]);
      const nuevo = { ...actuales, [parte]: valor };
      bloques[i] = `${nuevo.desde}-${nuevo.hasta}`;
      return { ...prev, [dia]: bloques };
    });
  }

  async function guardar() {
    setError(null);
    setGuardadoOk(false);
    setGuardando(true);
    const { data, error: errUpdate } = await supabase
      .from('usuarios')
      .update({
        sueldo: sueldo === '' ? null : Number(sueldo),
        horario,
        telefono: telefono.trim() || null,
        email: email.trim() || null,
        documento: documento.trim() || null,
        fecha_ingreso: fechaIngreso || null,
        notas: notas.trim() || null,
        permisos_extra: permisosExtra,
      })
      .eq('id', empleado.id)
      .select()
      .maybeSingle();
    setGuardando(false);
    if (errUpdate) {
      setError('No se pudo guardar. Probá de nuevo.');
      return;
    }
    if (data) onActualizado({ ...empleado, ...data });
    setGuardadoOk(true);
    setTimeout(() => setGuardadoOk(false), 2500);
  }

  return (
    <div className="space-y-4">
      {panel ? (
        <div className="flex items-center justify-between rounded-2xl bg-surface p-5 shadow-card">
          <div>
            <p className="font-display text-2xl text-ink">{empleado.nombre}</p>
            <p className="text-sm text-muted">{ETIQUETAS_ROL[empleado.rol] || empleado.rol}</p>
          </div>
          <button onClick={onVolver} className="shrink-0 text-muted">
            <X size={20} />
          </button>
        </div>
      ) : (
        <>
          <button onClick={onVolver} className="flex items-center gap-1 text-sm text-muted">
            <ChevronLeft size={16} /> Volver a Equipo
          </button>

          <div>
            <p className="font-display text-xl text-ink">{empleado.nombre}</p>
            <p className="text-xs text-muted">{ETIQUETAS_ROL[empleado.rol] || empleado.rol}</p>
          </div>
        </>
      )}

      {panel && (
        <div className="rounded-2xl bg-surface p-4 shadow-card">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Datos del empleado</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted">Teléfono</label>
              <input
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="0981 234 567"
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="text-xs text-muted">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="correo@ejemplo.com"
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="text-xs text-muted">Cédula (CI)</label>
              <input
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                placeholder="1.234.567"
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="text-xs text-muted">Fecha de ingreso</label>
              <input
                type="date"
                value={fechaIngreso}
                onChange={(e) => setFechaIngreso(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="text-xs text-muted">Notas</label>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              placeholder="Observaciones, contacto de emergencia, etc."
              className="mt-1 w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
        </div>
      )}

      {panel && (
        <div className="rounded-2xl bg-surface p-4 shadow-card">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Permisos especiales</p>
          <p className="mt-0.5 text-xs text-muted">
            {empleado.rol === 'gerente'
              ? 'Un gerente ya tiene todos estos accesos.'
              : 'Por default cada rol ve solo lo suyo. Marcá lo que quieras habilitarle a esta persona además de su rol; se aplica la próxima vez que entre.'}
          </p>
          <div className="mt-2 space-y-1.5">
            {PERMISOS.map((p) => (
              <label key={p.id} className="flex items-start gap-2 rounded-lg bg-base px-3 py-2 text-sm text-ink">
                <input
                  type="checkbox"
                  disabled={empleado.rol === 'gerente'}
                  checked={empleado.rol === 'gerente' || permisosExtra.includes(p.id)}
                  onChange={(e) =>
                    setPermisosExtra((prev) =>
                      e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)
                    )
                  }
                  className="mt-0.5 h-4 w-4 accent-accent"
                />
                <span>
                  {p.label}
                  <span className="block text-xs text-muted">{p.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {panel && (
        <div className="rounded-2xl bg-surface p-4 shadow-card">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Acceso</p>
          {passwordNueva ? (
            <>
              <p className="mt-2 text-xs text-muted">
                Nueva contraseña generada — pasásela ahora, no se vuelve a mostrar:
              </p>
              <p className="mt-1 select-all rounded-lg bg-accent-soft px-3 py-2 font-mono text-lg text-accent">
                {passwordNueva}
              </p>
              <button onClick={() => setPasswordNueva(null)} className="mt-2 text-xs font-medium text-accent">
                Listo
              </button>
            </>
          ) : confirmarReset ? (
            <>
              <p className="mt-2 text-xs text-amber">La contraseña anterior de esta persona deja de funcionar. ¿Seguro?</p>
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
                  onClick={resetearPasswordEmpleado}
                  disabled={reseteando}
                  className="flex-1 rounded-lg bg-accent py-2 text-xs font-medium text-accent-ink disabled:opacity-60"
                >
                  {reseteando ? 'Generando…' : 'Sí, generar'}
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmarReset(true)}
              className="mt-2 text-xs font-medium text-accent"
            >
              Generar nueva contraseña (se olvidó la suya)
            </button>
          )}
        </div>
      )}

      <div className="rounded-2xl bg-surface p-4 shadow-card">
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <Wallet size={13} /> Sueldo mensual (Gs.)
        </label>
        <input
          type="number"
          placeholder="Sin cargar"
          value={sueldo}
          onChange={(e) => setSueldo(e.target.value)}
          onWheel={(e) => e.currentTarget.blur()}
          className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <div className="rounded-2xl bg-surface p-4 shadow-card">
        <p className="text-xs text-muted">
          Horario semanal — un día sin franjas queda como su día libre.
        </p>

        <div className="mt-3 space-y-3">
          {DIAS.map((d) => {
            const bloques = horario[d.id] || [];
            return (
              <div key={d.id} className="rounded-xl bg-base p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-ink">{d.label}</p>
                  <button
                    type="button"
                    onClick={() => agregarBloque(d.id)}
                    className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-1 text-[11px] font-medium text-accent"
                  >
                    <Plus size={12} /> Franja
                  </button>
                </div>

                {bloques.length === 0 && <p className="mt-1.5 text-xs text-muted">Día libre</p>}

                {bloques.length > 0 && (
                  <div className="mt-1.5 space-y-1.5">
                    {bloques.map((bloque, i) => {
                      const { desde, hasta } = partesBloque(bloque);
                      return (
                        <div key={i} className="flex items-center gap-1.5">
                          <input
                            type="time"
                            value={desde}
                            onChange={(e) => cambiarBloque(d.id, i, 'desde', e.target.value)}
                            className="flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:ring-2 focus:ring-accent"
                          />
                          <span className="text-xs text-muted">a</span>
                          <input
                            type="time"
                            value={hasta}
                            onChange={(e) => cambiarBloque(d.id, i, 'hasta', e.target.value)}
                            className="flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:ring-2 focus:ring-accent"
                          />
                          <button
                            type="button"
                            onClick={() => quitarBloque(d.id, i)}
                            className="shrink-0 rounded-full p-1.5 text-muted active:text-danger"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {tieneRetail && (
        <div className="rounded-2xl bg-surface p-4 shadow-card">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
            <TrendingUp size={13} /> Actividad
          </p>

          <div className="mt-3 flex gap-3">
            <div className="flex-1 rounded-xl bg-base p-3 text-center">
              <p className="font-display text-xl font-semibold text-ink">{cajas === null ? '—' : cajas.length}</p>
              <p className="text-xs text-muted">Días de caja</p>
            </div>
            <div className="flex-1 rounded-xl bg-base p-3 text-center">
              <p className="font-display text-xl font-semibold text-ink">
                {resumenVentas === null ? '—' : resumenVentas.cantidad}
              </p>
              <p className="text-xs text-muted">Ventas</p>
            </div>
            <div className="flex-1 rounded-xl bg-base p-3 text-center">
              <p className="font-display text-xl font-semibold text-accent">
                {resumenVentas === null ? '—' : `Gs. ${resumenVentas.total.toLocaleString('es-PY')}`}
              </p>
              <p className="text-xs text-muted">Vendido</p>
            </div>
          </div>

          {cajas !== null && cajas.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs text-muted">Últimas cajas abiertas</p>
              {cajas.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-lg bg-base px-3 py-2 text-xs">
                  <span className="text-ink">{fechaTexto(c.abierta_en)}</span>
                  <span className="text-muted">{c.estado === 'abierta' ? 'Abierta' : 'Cerrada'}</span>
                  {c.diferencia !== null && (
                    <span className={Number(c.diferencia) === 0 ? 'text-success' : 'text-danger'}>
                      {Number(c.diferencia) === 0 ? 'Sin diferencia' : `Dif. Gs. ${Number(c.diferencia).toLocaleString('es-PY')}`}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {cajas !== null && cajas.length === 0 && (
            <p className="mt-3 text-center text-xs text-muted">Todavía no abrió ninguna caja.</p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
      {guardadoOk && <p className="text-center text-sm text-success">Cambios guardados ✓</p>}

      <button
        onClick={guardar}
        disabled={guardando}
        className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink disabled:opacity-60"
      >
        {guardando ? 'Guardando…' : 'Guardar cambios'}
      </button>
    </div>
  );
}
