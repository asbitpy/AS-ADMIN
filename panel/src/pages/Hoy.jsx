import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useRealtimeTick } from '../lib/realtime';
import ConversacionAlerta from '../components/ConversacionAlerta';

const DOT_ESTADO = {
  confirmado: 'bg-success',
  completado: 'bg-success',
  pendiente: 'bg-amber',
  reprogramado: 'bg-amber',
  no_show: 'bg-danger',
};

function fechaISOParaguay(fecha) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(fecha);
}

function rangoDiaISO(fechaISO) {
  return {
    desde: new Date(`${fechaISO}T00:00:00-03:00`).toISOString(),
    hasta: new Date(`${fechaISO}T23:59:59-03:00`).toISOString(),
  };
}

function horaTexto(fecha) {
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(fecha));
}

export default function Hoy() {
  const { negocio } = useAuth();
  const hoyISO = fechaISOParaguay(new Date());
  const [fechaSeleccionada, setFechaSeleccionada] = useState(hoyISO);
  const [turnos, setTurnos] = useState([]);
  const [derivadas, setDerivadas] = useState([]);
  const [ingresoSemana, setIngresoSemana] = useState(0);
  const [cargando, setCargando] = useState(true);

  // El día de hoy + los 4 anteriores, para "ver el movimiento" sin tener
  // que salir de esta pantalla. Nunca más de 4 días atrás — a propósito,
  // no es un calendario completo, es un vistazo rápido de lo reciente.
  const dias = useMemo(() => {
    const ahora = Date.now();
    const lista = [];
    for (let i = 4; i >= 0; i--) {
      const fecha = new Date(ahora - i * 86400000);
      lista.push({
        iso: fechaISOParaguay(fecha),
        diaCorto: new Intl.DateTimeFormat('es-PY', { timeZone: 'America/Asuncion', weekday: 'short' })
          .format(fecha)
          .replace('.', ''),
        diaNum: new Intl.DateTimeFormat('es-PY', { timeZone: 'America/Asuncion', day: 'numeric' }).format(fecha),
        esHoy: i === 0,
      });
    }
    return lista;
  }, [hoyISO]);

  // Si el bot agenda un turno o deriva una conversación mientras el
  // dueño tiene esta pantalla abierta, se ve solo — sin recargar.
  const tickTurnos = useRealtimeTick('turnos', negocio?.id);
  const tickConversaciones = useRealtimeTick('conversaciones', negocio?.id);

  useEffect(() => {
    if (!negocio) return;
    cargarDatos();
  }, [negocio, fechaSeleccionada, tickTurnos, tickConversaciones]);

  async function cargarDatos() {
    setCargando(true);
    const { desde, hasta } = rangoDiaISO(fechaSeleccionada);
    const hace7dias = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    const [turnosRes, derivadasRes, ingresoRes] = await Promise.all([
      supabase
        .from('turnos')
        .select('*, cliente:clientes(nombre, telefono), servicio:servicios(nombre)')
        .eq('negocio_id', negocio.id)
        .gte('fecha_hora', desde)
        .lte('fecha_hora', hasta)
        .neq('estado', 'cancelado')
        .order('fecha_hora'),
      // Las conversaciones derivadas no son de un día puntual — son "lo
      // que está esperando respuesta ahora", se muestran sin importar
      // qué día del navegador esté seleccionado.
      supabase
        .from('conversaciones')
        .select('*, cliente:clientes(nombre, telefono)')
        .eq('negocio_id', negocio.id)
        .eq('estado', 'derivado_humano')
        .order('prioridad', { ascending: false }),
      supabase
        .from('movimientos_financieros')
        .select('monto')
        .eq('negocio_id', negocio.id)
        .eq('tipo', 'ingreso')
        .gte('fecha', hace7dias),
    ]);

    setTurnos(turnosRes.data || []);
    setDerivadas(derivadasRes.data || []);
    setIngresoSemana((ingresoRes.data || []).reduce((acc, m) => acc + Number(m.monto), 0));
    setCargando(false);
  }

  async function cambiarEstado(turnoId, nuevoEstado) {
    await supabase.from('turnos').update({ estado: nuevoEstado }).eq('id', turnoId);
    cargarDatos();
  }

  const confirmados = turnos.filter((t) => t.estado === 'confirmado').length;
  const esHoySeleccionado = fechaSeleccionada === hoyISO;
  const fechaTexto = new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  })
    .format(new Date(`${fechaSeleccionada}T12:00:00-03:00`))
    .replace(/^\w/, (c) => c.toUpperCase());

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between">
        <p className="font-display text-xl text-ink">{fechaTexto}</p>
        <div className="flex items-center gap-3 font-mono text-sm">
          <span className="text-ink">
            {turnos.length} <span className="font-sans text-xs text-muted">turnos</span>
          </span>
          <span className="text-accent">
            {confirmados}/{turnos.length} <span className="font-sans text-xs text-muted">ok</span>
          </span>
        </div>
      </div>

      {/* Navegador de días: hoy + los 4 anteriores */}
      <div className="flex gap-1.5">
        {dias.map((d) => (
          <button
            key={d.iso}
            onClick={() => setFechaSeleccionada(d.iso)}
            className={`rounded-xl py-2 text-center transition-colors ${
              d.iso === fechaSeleccionada ? 'flex-[1.3] bg-brand' : 'flex-1 bg-surface'
            }`}
          >
            <span
              className={`block text-[9.5px] font-semibold uppercase tracking-wide ${
                d.iso === fechaSeleccionada ? 'text-ink' : 'text-muted'
              }`}
            >
              {d.esHoy ? 'Hoy' : d.diaCorto}
            </span>
            <span className={`mt-0.5 block font-mono text-xs ${d.iso === fechaSeleccionada ? 'font-semibold text-ink' : 'text-muted'}`}>
              {d.diaNum}
            </span>
          </button>
        ))}
      </div>
      {!esHoySeleccionado && (
        <button onClick={() => setFechaSeleccionada(hoyISO)} className="-mt-2 text-xs font-medium text-accent">
          ← Volver a hoy
        </button>
      )}

      {derivadas.length > 0 && (
        <div className="space-y-1.5">
          {derivadas.map((c) => (
            <ConversacionAlerta key={c.id} conversacion={c} />
          ))}
        </div>
      )}

      {cargando ? (
        <p className="pt-6 text-center text-sm text-muted">Cargando…</p>
      ) : (
        <div className="rounded-2xl bg-surface shadow-card">
          {turnos.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              {esHoySeleccionado ? 'Hoy no tenés turnos agendados.' : 'No hubo turnos ese día.'}
            </p>
          ) : (
            turnos.map((t) => {
              const puedeGestionar = ['pendiente', 'confirmado'].includes(t.estado);
              const sinConfirmar = t.estado === 'pendiente';
              return (
                <div
                  key={t.id}
                  className={`flex items-center gap-2.5 border-b border-line px-3.5 py-2.5 last:border-0 ${
                    !puedeGestionar ? 'opacity-50' : ''
                  }`}
                >
                  <span className="w-11 shrink-0 font-mono text-xs text-muted">{horaTexto(t.fecha_hora)}</span>
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_ESTADO[t.estado] || 'bg-line'}`} />
                  <span className="flex-1 truncate text-sm font-medium text-ink">{t.cliente?.nombre || 'Cliente'}</span>
                  <span className={`shrink-0 text-xs ${sinConfirmar ? 'font-medium text-amber' : 'text-muted'}`}>
                    {t.servicio?.nombre}
                    {sinConfirmar && ' · sin confirmar'}
                  </span>
                  {puedeGestionar && (
                    <button
                      onClick={() => cambiarEstado(t.id, 'completado')}
                      title="Marcar atendido"
                      className="shrink-0 rounded-full p-1 text-accent active:scale-90"
                    >
                      <Check size={18} />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      <div className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3 shadow-card">
        <span className="text-xs text-muted">Facturado esta semana</span>
        <span className="font-mono text-sm font-semibold text-accent">
          Gs. {ingresoSemana.toLocaleString('es-PY')}
        </span>
      </div>
    </div>
  );
}
