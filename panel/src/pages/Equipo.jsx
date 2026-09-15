import { useEffect, useRef, useState } from 'react';
import { UserPlus, Crown, X, ChevronRight, ChevronLeft, Plus, Trash2, Wallet, TrendingUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useEsEscritorio } from '../hooks/useEsEscritorio';

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

export default function Equipo() {
  const { negocio } = useAuth();
  const { esEscritorio } = useEsEscritorio();
  const tieneRetail = (negocio?.modulos_activos || []).some((m) => m === 'pos' || m === 'inventario');
  const [usuarios, setUsuarios] = useState([]);
  const [actividad, setActividad] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState('lista'); // 'lista' | 'form'
  const [empleadoAbierto, setEmpleadoAbierto] = useState(null);

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
    function fila(idCrudo) {
      const id = idCrudo || 'sin_asignar';
      if (!mapa.has(id)) {
        let nombre = 'Sin asignar';
        if (id === negocio.auth_user_id) nombre = 'Vos';
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

  if (empleadoAbierto) {
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

  const formulario = (
    <div
      className={`fixed inset-0 z-50 flex bg-black/60 ${esEscritorio ? 'items-center justify-center' : 'items-end'}`}
      onClick={() => setVista('lista')}
    >
      <div
        className={`flex max-h-[85vh] w-full flex-col overflow-y-auto bg-surface p-5 pb-6 ${
          esEscritorio ? 'max-w-md rounded-2xl' : 'mx-auto max-w-md rounded-t-2xl'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="font-display text-xl text-ink">Agregar a alguien del equipo</p>
          <button onClick={() => setVista('lista')} className="shrink-0 text-muted">
            <X size={20} />
          </button>
        </div>

        <div className="mt-3 rounded-xl bg-accent-soft p-3 text-xs text-accent">
          Primero creá su cuenta en Supabase → Authentication → Add user (con "Auto Confirm User"
          marcado) y copiá el UUID que le queda asignado. Recién con ese UUID lo agregás acá.
        </div>

        <form onSubmit={agregarUsuario} className="mt-3 space-y-3">
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
    </div>
  );

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

      {!cargando && usuarios.length > 0 && esEscritorio && (
        <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Rol</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Acción</th>
                <th className="px-4 py-3 text-right">Sueldo y horario</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {usuarios.map((u) => (
                <tr key={u.id} className={!u.activo ? 'opacity-50' : ''}>
                  <td className="px-4 py-3 font-medium text-ink">{u.nombre}</td>
                  <td className="px-4 py-3">
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
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => toggleActivo(u)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                        u.activo ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'
                      }`}
                    >
                      {u.activo ? 'Dar de baja' : 'Reactivar'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setEmpleadoAbierto(u)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-accent"
                    >
                      Ver <ChevronRight size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {esEscritorio && tieneRetail && actividad.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
            <TrendingUp size={13} /> Actividad del equipo
          </p>
          <p className="mt-0.5 text-xs text-muted">Días de caja abierta y ventas de cada persona, todos juntos.</p>
          <div className="mt-2 space-y-1.5">
            {actividad.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-xl bg-surface p-3 shadow-card">
                <p className="truncate text-sm font-medium text-ink">{a.nombre}</p>
                <div className="flex shrink-0 items-center gap-4 text-right">
                  <div>
                    <p className="text-sm text-ink">{a.diasTrabajados}</p>
                    <p className="text-[10px] text-muted">días</p>
                  </div>
                  <div>
                    <p className="text-sm text-ink">{a.ventasCount}</p>
                    <p className="text-[10px] text-muted">ventas</p>
                  </div>
                  <div className="w-28">
                    <p className="font-mono text-sm text-accent">Gs. {a.totalVendido.toLocaleString('es-PY')}</p>
                    <p className="text-[10px] text-muted">vendido</p>
                  </div>
                </div>
              </div>
            ))}
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

// Sueldo y horario semanal de un empleado — lo pidió Arturo para que
// la ficha quede completa. A propósito NO es el módulo de "Jornadas"
// del documento de pantallas (grilla + fichaje + comisiones): esto es
// más chico, un horario de referencia por persona, mismo formato que
// ya usa HorariosAtencion.jsx para el negocio.
function FichaEmpleado({ empleado, onVolver, onActualizado }) {
  const { negocio } = useAuth();
  const tieneRetail = (negocio?.modulos_activos || []).some((m) => m === 'pos' || m === 'inventario');
  const [sueldo, setSueldo] = useState(empleado.sueldo ?? '');
  const [horario, setHorario] = useState(empleado.horario || {});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [guardadoOk, setGuardadoOk] = useState(false);
  const [cajas, setCajas] = useState(null);
  const [resumenVentas, setResumenVentas] = useState(null);

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
      .update({ sueldo: sueldo === '' ? null : Number(sueldo), horario })
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
      <button onClick={onVolver} className="flex items-center gap-1 text-sm text-muted">
        <ChevronLeft size={16} /> Volver a Equipo
      </button>

      <div>
        <p className="font-display text-xl text-ink">{empleado.nombre}</p>
        <p className="text-xs text-muted">{ETIQUETAS_ROL[empleado.rol] || empleado.rol}</p>
      </div>

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
