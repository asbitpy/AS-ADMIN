import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useRealtimeTick } from '../lib/realtime';
import { useEsEscritorio } from '../hooks/useEsEscritorio';
import TurnoCard from '../components/TurnoCard';
import EstadoBadge from '../components/EstadoBadge';
import MetricPill from '../components/MetricPill';

const FILTROS = [
  { id: 'proximos', label: 'Próximos' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'todos', label: 'Todos' },
];

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const ESTADO_BORDE = {
  pendiente: 'bg-amber',
  confirmado: 'bg-accent',
  reprogramado: 'bg-amber',
  cancelado: 'bg-danger',
  completado: 'bg-accent',
  no_show: 'bg-danger',
};

const ESTADOS_FILTRO = [
  { id: 'todos', label: 'Todos los estados' },
  { id: 'pendiente', label: 'Sin responder' },
  { id: 'confirmado', label: 'Confirmado' },
  { id: 'completado', label: 'Completado' },
  { id: 'cancelado', label: 'Cancelado' },
  { id: 'no_show', label: 'No vino' },
];

function horaCorta(fecha) {
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(fecha));
}

function fechaHoraCompleta(fecha) {
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(fecha));
}

// Lunes de la semana actual + offset semanas (offset 0 = esta semana).
function inicioSemana(offset) {
  const hoy = new Date();
  const dia = hoy.getDay(); // 0 = domingo
  const diffLunes = dia === 0 ? -6 : 1 - dia;
  const lunes = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + diffLunes + offset * 7);
  lunes.setHours(0, 0, 0, 0);
  return lunes;
}

function hoyInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Turnos() {
  const { negocio } = useAuth();
  const { esEscritorio } = useEsEscritorio();
  const tickTurnos = useRealtimeTick('turnos', negocio?.id);

  // ------------------------------------------------------------
  // Celular: sin cambios — lista con chips de filtro, tal cual estaba.
  // ------------------------------------------------------------
  const [filtro, setFiltro] = useState('proximos');
  const [turnos, setTurnos] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!negocio || esEscritorio) return;
    cargar();
  }, [negocio, filtro, tickTurnos, esEscritorio]);

  async function cargar() {
    setCargando(true);
    let query = supabase
      .from('turnos')
      .select('*, cliente:clientes(nombre, telefono), servicio:servicios(nombre), profesional:profesionales(nombre)')
      .eq('negocio_id', negocio.id)
      .order('fecha_hora', { ascending: filtro !== 'todos' });

    if (filtro === 'proximos') {
      query = query.gte('fecha_hora', new Date().toISOString()).limit(30);
    } else if (filtro === 'semana') {
      const hasta = new Date(Date.now() + 7 * 86400000).toISOString();
      query = query.gte('fecha_hora', new Date().toISOString()).lte('fecha_hora', hasta);
    } else {
      query = query.limit(50);
    }

    const { data } = await query;
    setTurnos(data || []);
    setCargando(false);
  }

  async function onCambiarEstado(turnoId, nuevoEstado) {
    await supabase.from('turnos').update({ estado: nuevoEstado }).eq('id', turnoId);
    cargar();
  }

  // ------------------------------------------------------------
  // Escritorio: pantalla nueva (ver feedback-asadmin-movil-congelado) —
  // tablero semanal, filtros, métricas y carga manual de un turno.
  // ------------------------------------------------------------
  const [semanaOffset, setSemanaOffset] = useState(0);
  const [turnosSemana, setTurnosSemana] = useState([]);
  const [cargandoSemana, setCargandoSemana] = useState(true);
  const [profesionales, setProfesionales] = useState([]);
  const [filtroProfesional, setFiltroProfesional] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('todos');
  const [turnoAbierto, setTurnoAbierto] = useState(null);
  const [formAbierto, setFormAbierto] = useState(false);

  useEffect(() => {
    if (!negocio || !esEscritorio) return;
    cargarProfesionales();
  }, [negocio, esEscritorio]);

  useEffect(() => {
    if (!negocio || !esEscritorio) return;
    cargarSemana();
  }, [negocio, esEscritorio, semanaOffset, filtroProfesional, tickTurnos]);

  async function cargarProfesionales() {
    const { data } = await supabase
      .from('profesionales')
      .select('id, nombre')
      .eq('negocio_id', negocio.id)
      .eq('activo', true)
      .order('nombre');
    setProfesionales(data || []);
  }

  async function cargarSemana() {
    setCargandoSemana(true);
    const lunes = inicioSemana(semanaOffset);
    const domingoFin = new Date(lunes.getTime() + 7 * 86400000);
    let query = supabase
      .from('turnos')
      .select('*, cliente:clientes(nombre, telefono), servicio:servicios(nombre, duracion_minutos), profesional:profesionales(nombre)')
      .eq('negocio_id', negocio.id)
      .gte('fecha_hora', lunes.toISOString())
      .lt('fecha_hora', domingoFin.toISOString())
      .order('fecha_hora');
    if (filtroProfesional) query = query.eq('profesional_id', filtroProfesional);
    const { data } = await query;
    setTurnosSemana(data || []);
    setCargandoSemana(false);
  }

  async function cambiarEstadoSemana(turnoId, nuevoEstado) {
    await supabase.from('turnos').update({ estado: nuevoEstado }).eq('id', turnoId);
    setTurnoAbierto(null);
    cargarSemana();
  }

  const dias = Array.from({ length: 7 }, (_, i) => new Date(inicioSemana(semanaOffset).getTime() + i * 86400000));
  const hoyStr = new Date().toDateString();

  const turnosPorDia = dias.map((d) =>
    turnosSemana.filter((t) => {
      if (filtroEstado !== 'todos' && t.estado !== filtroEstado) return false;
      return new Date(t.fecha_hora).toDateString() === d.toDateString();
    })
  );

  const rangoTexto = `${dias[0].toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit' })} – ${dias[6].toLocaleDateString(
    'es-PY',
    { day: '2-digit', month: '2-digit' }
  )}`;

  const metricas = {
    total: turnosSemana.length,
    confirmados: turnosSemana.filter((t) => t.estado === 'confirmado').length,
    pendientes: turnosSemana.filter((t) => t.estado === 'pendiente').length,
    noShows: turnosSemana.filter((t) => t.estado === 'no_show').length,
  };

  return (
    <div className="space-y-4">
      {!esEscritorio && (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {FILTROS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFiltro(f.id)}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium ${
                  filtro === f.id ? 'bg-accent text-accent-ink' : 'bg-surface text-muted'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {cargando && <p className="pt-6 text-center text-sm text-muted">Cargando…</p>}

          {!cargando && turnos.length === 0 && (
            <p className="pt-6 text-center text-sm text-muted">No hay turnos para mostrar acá.</p>
          )}

          <div className="space-y-3">
            {turnos.map((t) => (
              <TurnoCard key={t.id} turno={t} onCambiarEstado={onCambiarEstado} />
            ))}
          </div>
        </>
      )}

      {esEscritorio && (
        <>
          <div className="flex items-center justify-between">
            <p className="font-display text-xl text-ink">Turnos</p>
            <button
              onClick={() => setFormAbierto(true)}
              className="flex items-center gap-1 rounded-full bg-brand px-3 py-2 text-xs font-medium text-ink active:scale-[0.98]"
            >
              <Plus size={16} /> Nuevo turno
            </button>
          </div>

          <div className="flex gap-3">
            <MetricPill label="Turnos (semana)" value={metricas.total} />
            <MetricPill label="Confirmados" value={metricas.confirmados} tone="accent" />
            <MetricPill label="Pendientes" value={metricas.pendientes} tone="amber" />
            <MetricPill label="No-shows" value={metricas.noShows} tone="danger" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSemanaOffset((o) => o - 1)}
                className="rounded-lg p-1.5 text-muted hover:bg-surface2"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={() => setSemanaOffset(0)}
                className="rounded-full bg-surface2 px-3 py-1 text-xs font-medium text-ink"
              >
                Hoy
              </button>
              <button
                onClick={() => setSemanaOffset((o) => o + 1)}
                className="rounded-lg p-1.5 text-muted hover:bg-surface2"
              >
                <ChevronRight size={18} />
              </button>
              <p className="text-sm text-muted">{rangoTexto}</p>
            </div>

            <div className="flex gap-2">
              {profesionales.length > 0 && (
                <select
                  value={filtroProfesional}
                  onChange={(e) => setFiltroProfesional(e.target.value)}
                  className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">Todo el equipo</option>
                  {profesionales.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              )}
              <select
                value={filtroEstado}
                onChange={(e) => setFiltroEstado(e.target.value)}
                className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-accent"
              >
                {ESTADOS_FILTRO.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {cargandoSemana ? (
            <p className="pt-6 text-center text-sm text-muted">Cargando…</p>
          ) : (
            <div className="grid grid-cols-7 gap-2">
              {dias.map((d, i) => {
                const esHoy = d.toDateString() === hoyStr;
                return (
                  <div key={i} className="space-y-2">
                    <div className={`rounded-xl px-2 py-1.5 text-center ${esHoy ? 'bg-accent-soft' : ''}`}>
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{DIAS_SEMANA[i]}</p>
                      <p className={`font-display text-base ${esHoy ? 'text-accent' : 'text-ink'}`}>{d.getDate()}</p>
                    </div>
                    <div className="space-y-1.5">
                      {turnosPorDia[i].length === 0 && <p className="px-1 text-center text-[10px] text-muted">—</p>}
                      {turnosPorDia[i].map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setTurnoAbierto(t)}
                          className="relative block w-full overflow-hidden rounded-lg bg-surface py-1.5 pl-2.5 pr-1.5 text-left shadow-card"
                        >
                          <span className={`absolute inset-y-0 left-0 w-1 ${ESTADO_BORDE[t.estado] || 'bg-line'}`} />
                          <p className="font-mono text-[10px] text-muted">{horaCorta(t.fecha_hora)}</p>
                          <p className="truncate text-xs font-medium text-ink">{t.cliente?.nombre || 'Cliente'}</p>
                          <p className="truncate text-[10px] text-muted">{t.servicio?.nombre}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {turnoAbierto && (
        <DetalleTurnoModal turno={turnoAbierto} onCerrar={() => setTurnoAbierto(null)} onCambiarEstado={cambiarEstadoSemana} />
      )}

      {formAbierto && (
        <NuevoTurnoModal
          negocio={negocio}
          profesionales={profesionales}
          onCerrar={() => setFormAbierto(false)}
          onCreado={() => {
            setFormAbierto(false);
            cargarSemana();
          }}
        />
      )}
    </div>
  );
}

function DetalleTurnoModal({ turno, onCerrar, onCambiarEstado }) {
  const puedeGestionar = ['pendiente', 'confirmado'].includes(turno.estado);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCerrar}>
      <div className="w-full max-w-sm rounded-2xl bg-surface p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <p className="font-display text-lg text-ink">{turno.cliente?.nombre || 'Cliente'}</p>
            <p className="text-sm text-muted">
              {turno.servicio?.nombre}
              {turno.profesional?.nombre ? ` · ${turno.profesional.nombre}` : ''}
            </p>
          </div>
          <button onClick={onCerrar} className="shrink-0 text-muted">
            <X size={20} />
          </button>
        </div>

        <p className="mt-2 font-mono text-sm text-ink">{fechaHoraCompleta(turno.fecha_hora)}</p>
        <div className="mt-2">
          <EstadoBadge estado={turno.estado} />
        </div>

        {turno.cliente?.telefono && (
          <a
            href={`https://wa.me/${turno.cliente.telefono}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border border-line py-2 text-xs font-medium text-ink"
          >
            Abrir WhatsApp con el cliente
          </a>
        )}

        {turno.notas && <p className="mt-3 rounded-lg bg-base p-2.5 text-xs text-muted">{turno.notas}</p>}

        {puedeGestionar && (
          <div className="mt-4 flex gap-2 border-t border-line pt-3">
            <button
              onClick={() => onCambiarEstado(turno.id, 'completado')}
              className="flex-1 rounded-lg bg-accent-soft px-3 py-2 text-xs font-medium text-accent"
            >
              Marcar atendido
            </button>
            <button
              onClick={() => onCambiarEstado(turno.id, 'no_show')}
              className="flex-1 rounded-lg bg-amber-soft px-3 py-2 text-xs font-medium text-amber"
            >
              No vino
            </button>
            <button
              onClick={() => onCambiarEstado(turno.id, 'cancelado')}
              className="flex-1 rounded-lg bg-danger-soft px-3 py-2 text-xs font-medium text-danger"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Hasta ahora todo turno nacía del bot — si alguien escribía fuera de
// WhatsApp o llamaba por teléfono, no había forma de cargarlo. Cliente
// (buscar o crear al vuelo, mismo criterio que Venta.jsx), servicio,
// profesional opcional, fecha/hora y un aviso NO bloqueante si ya hay
// otro turno cerca de ese horario — se puede guardar igual (dos sillas,
// una emergencia, etc.), solo se pide confirmar una segunda vez.
function NuevoTurnoModal({ negocio, profesionales, onCerrar, onCreado }) {
  const [servicios, setServicios] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [cargandoDatos, setCargandoDatos] = useState(true);

  const [busquedaCliente, setBusquedaCliente] = useState('');
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
  const [mostrarNuevoCliente, setMostrarNuevoCliente] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoTelefono, setNuevoTelefono] = useState('');

  const [servicioId, setServicioId] = useState('');
  const [profesionalId, setProfesionalId] = useState('');
  const [fecha, setFecha] = useState(hoyInputValue());
  const [hora, setHora] = useState('09:00');
  const [monto, setMonto] = useState('');
  const [notas, setNotas] = useState('');

  const [advertencia, setAdvertencia] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    cargarDatos();
  }, []);

  useEffect(() => {
    setAdvertencia(null);
    setConfirmando(false);
  }, [fecha, hora, servicioId, profesionalId]);

  async function cargarDatos() {
    setCargandoDatos(true);
    const [servRes, cliRes] = await Promise.all([
      supabase.from('servicios').select('id, nombre, precio, duracion_minutos').eq('negocio_id', negocio.id).eq('activo', true).order('nombre'),
      supabase.from('clientes').select('id, nombre, telefono').eq('negocio_id', negocio.id).order('nombre').limit(500),
    ]);
    setServicios(servRes.data || []);
    setClientes(cliRes.data || []);
    setCargandoDatos(false);
  }

  const servicioElegido = servicios.find((s) => s.id === servicioId);

  useEffect(() => {
    if (servicioElegido) setMonto(String(servicioElegido.precio));
  }, [servicioId]); // eslint-disable-line react-hooks/exhaustive-deps

  const resultadosCliente = busquedaCliente.trim()
    ? clientes
        .filter(
          (c) =>
            c.nombre.toLowerCase().includes(busquedaCliente.toLowerCase()) || c.telefono.includes(busquedaCliente)
        )
        .slice(0, 6)
    : [];

  async function resolverClienteId() {
    if (clienteSeleccionado) return clienteSeleccionado.id;
    const nombre = nuevoNombre.trim();
    const telefono = nuevoTelefono.trim();
    const { data: existente } = await supabase
      .from('clientes')
      .select('id')
      .eq('negocio_id', negocio.id)
      .eq('telefono', telefono)
      .maybeSingle();
    if (existente) return existente.id;
    const { data: creado, error: errCliente } = await supabase
      .from('clientes')
      .insert({ negocio_id: negocio.id, nombre, telefono })
      .select('id')
      .single();
    if (errCliente) return null;
    return creado.id;
  }

  async function hayConflicto(fechaHoraISO, duracionMin) {
    const desde = new Date(fechaHoraISO);
    const hasta = new Date(desde.getTime() + duracionMin * 60000);
    let query = supabase
      .from('turnos')
      .select('id, fecha_hora, servicio:servicios(duracion_minutos)')
      .eq('negocio_id', negocio.id)
      .not('estado', 'in', '(cancelado,no_show)')
      .gte('fecha_hora', new Date(desde.getTime() - 6 * 3600000).toISOString())
      .lte('fecha_hora', new Date(hasta.getTime() + 6 * 3600000).toISOString());
    if (profesionalId) query = query.eq('profesional_id', profesionalId);
    const { data } = await query;
    return (data || []).some((t) => {
      const tIni = new Date(t.fecha_hora);
      const tFin = new Date(tIni.getTime() + (t.servicio?.duracion_minutos || 30) * 60000);
      return tIni < hasta && desde < tFin;
    });
  }

  async function guardar(e) {
    e.preventDefault();
    setError(null);

    const tieneCliente = clienteSeleccionado || (nuevoNombre.trim() && nuevoTelefono.trim());
    if (!tieneCliente) {
      setError('Elegí un cliente de la lista, o cargá nombre y teléfono para uno nuevo.');
      return;
    }
    if (!servicioId) {
      setError('Elegí un servicio.');
      return;
    }
    if (!fecha || !hora) {
      setError('Falta la fecha o la hora.');
      return;
    }

    const fechaHoraISO = new Date(`${fecha}T${hora}:00`).toISOString();

    if (!confirmando) {
      setGuardando(true);
      const conflicto = await hayConflicto(fechaHoraISO, servicioElegido?.duracion_minutos || 30);
      setGuardando(false);
      if (conflicto) {
        setAdvertencia(
          `Ya hay otro turno cerca de ese horario${profesionalId ? ' para esa persona' : ''} — guardá de nuevo si igual querés cargarlo.`
        );
        setConfirmando(true);
        return;
      }
    }

    setGuardando(true);
    const clienteId = await resolverClienteId();
    if (!clienteId) {
      setGuardando(false);
      setError('No se pudo guardar el cliente. Probá de nuevo.');
      return;
    }

    const { error: errTurno } = await supabase.from('turnos').insert({
      negocio_id: negocio.id,
      cliente_id: clienteId,
      profesional_id: profesionalId || null,
      servicio_id: servicioId,
      fecha_hora: fechaHoraISO,
      estado: 'confirmado',
      origen: 'manual',
      monto: Number(monto) || servicioElegido?.precio || 0,
      notas: notas.trim() || null,
    });

    setGuardando(false);
    if (errTurno) {
      setError('No se pudo guardar el turno. Probá de nuevo.');
      return;
    }
    onCreado();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCerrar}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="font-display text-xl text-ink">Nuevo turno</p>
          <button onClick={onCerrar} className="shrink-0 text-muted">
            <X size={20} />
          </button>
        </div>

        {cargandoDatos ? (
          <p className="pt-6 text-center text-sm text-muted">Cargando…</p>
        ) : (
          <form onSubmit={guardar} className="mt-3 space-y-3">
            <div>
              <label className="text-xs text-muted">Cliente</label>
              {clienteSeleccionado ? (
                <div className="mt-1 flex items-center justify-between rounded-xl bg-accent-soft px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-accent">{clienteSeleccionado.nombre}</p>
                    <p className="text-xs text-accent/80">{clienteSeleccionado.telefono}</p>
                  </div>
                  <button type="button" onClick={() => setClienteSeleccionado(null)} className="text-accent">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative mt-1">
                    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      value={busquedaCliente}
                      onChange={(e) => setBusquedaCliente(e.target.value)}
                      placeholder="Buscar por nombre o teléfono…"
                      className="w-full rounded-xl border border-line bg-surface py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-accent"
                    />
                  </div>

                  {resultadosCliente.length > 0 && (
                    <div className="mt-1.5 space-y-1 rounded-xl bg-base p-1.5">
                      {resultadosCliente.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setClienteSeleccionado(c);
                            setBusquedaCliente('');
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm active:bg-surface2"
                        >
                          <span className="text-ink">{c.nombre}</span>
                          <span className="text-xs text-muted">{c.telefono}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {!mostrarNuevoCliente ? (
                    <button
                      type="button"
                      onClick={() => setMostrarNuevoCliente(true)}
                      className="mt-1.5 text-xs font-medium text-accent"
                    >
                      + Cliente nuevo
                    </button>
                  ) : (
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      <input
                        value={nuevoNombre}
                        onChange={(e) => setNuevoNombre(e.target.value)}
                        placeholder="Nombre"
                        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
                      />
                      <input
                        value={nuevoTelefono}
                        onChange={(e) => setNuevoTelefono(e.target.value)}
                        placeholder="Teléfono"
                        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            <div>
              <label className="text-xs text-muted">Servicio</label>
              <select
                value={servicioId}
                onChange={(e) => setServicioId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="">Elegí un servicio…</option>
                {servicios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre} · {s.duracion_minutos} min
                  </option>
                ))}
              </select>
            </div>

            {profesionales.length > 0 && (
              <div>
                <label className="text-xs text-muted">Profesional</label>
                <select
                  value={profesionalId}
                  onChange={(e) => setProfesionalId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="">Sin preferencia</option>
                  {profesionales.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted">Fecha</label>
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div>
                <label className="text-xs text-muted">Hora</label>
                <input
                  type="time"
                  value={hora}
                  onChange={(e) => setHora(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-muted">Monto (Gs.)</label>
              <input
                type="number"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                onWheel={(e) => e.currentTarget.blur()}
                className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            <div>
              <label className="text-xs text-muted">Notas (opcional)</label>
              <textarea
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                rows={2}
                className="mt-1 w-full resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            {advertencia && <p className="rounded-lg bg-amber-soft p-2.5 text-xs text-amber">{advertencia}</p>}
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
                {guardando ? 'Guardando…' : confirmando ? 'Guardar de todos modos' : 'Guardar turno'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
