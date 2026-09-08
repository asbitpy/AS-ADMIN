import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import DayTimeline from '../components/DayTimeline';
import MetricPill from '../components/MetricPill';
import ConversacionAlerta from '../components/ConversacionAlerta';

function rangoHoyISO() {
  const inicio = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
  const desde = new Date(`${inicio}T00:00:00-03:00`);
  const hasta = new Date(`${inicio}T23:59:59-03:00`);
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

export default function Hoy() {
  const { negocio } = useAuth();
  const [turnos, setTurnos] = useState([]);
  const [derivadas, setDerivadas] = useState([]);
  const [ingresoSemana, setIngresoSemana] = useState(0);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!negocio) return;
    cargarDatos();
  }, [negocio]);

  async function cargarDatos() {
    setCargando(true);
    const { desde, hasta } = rangoHoyISO();
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
  const fechaTexto = new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  if (cargando) {
    return <p className="pt-10 text-center text-sm text-muted">Cargando tu día…</p>;
  }

  return (
    <div className="space-y-4">
      <p className="font-display text-xl capitalize text-ink">{fechaTexto}</p>

      <div className="flex gap-3">
        <MetricPill label="Turnos hoy" value={turnos.length} />
        <MetricPill label="Confirmados" value={`${confirmados}/${turnos.length}`} tone="accent" />
        <MetricPill
          label="Necesitan atención"
          value={derivadas.length}
          tone={derivadas.some((d) => d.prioridad === 'alta') ? 'danger' : 'amber'}
        />
      </div>

      {derivadas.length > 0 && (
        <div className="space-y-2">
          {derivadas.map((c) => (
            <ConversacionAlerta key={c.id} conversacion={c} />
          ))}
        </div>
      )}

      <DayTimeline turnos={turnos.map((t) => ({ ...t }))} />

      <p className="text-center text-xs text-muted">
        Esta semana facturaste{' '}
        <span className="font-mono font-medium text-ink">
          Gs. {ingresoSemana.toLocaleString('es-PY')}
        </span>
      </p>

      {turnos.some((t) => ['pendiente', 'confirmado'].includes(t.estado)) && (
        <div className="space-y-2 pt-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Marcar como atendido</p>
          {turnos
            .filter((t) => ['pendiente', 'confirmado'].includes(t.estado))
            .map((t) => (
              <button
                key={t.id}
                onClick={() => cambiarEstado(t.id, 'completado')}
                className="flex w-full items-center justify-between rounded-xl bg-surface px-4 py-3 text-left shadow-card active:scale-[0.99]"
              >
                <span className="text-sm text-ink">{t.cliente?.nombre}</span>
                <span className="text-xs text-accent">Atendido ✓</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
