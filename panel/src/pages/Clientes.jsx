import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Phone, Calendar, ShoppingBag } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

function fechaTexto(fecha) {
  if (!fecha) return 'Sin actividad todavía';
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(fecha));
}

function fechaHoraTexto(fecha) {
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(fecha));
}

export default function Clientes() {
  const { negocio } = useAuth();
  const [clientes, setClientes] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [clienteAbierto, setClienteAbierto] = useState(null);

  useEffect(() => {
    if (!negocio) return;
    cargar();
  }, [negocio]);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from('vista_clientes_resumen')
      .select('*')
      .eq('negocio_id', negocio.id)
      .order('nombre');
    setClientes(data || []);
    setCargando(false);
  }

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter((c) => c.nombre.toLowerCase().includes(q) || c.telefono.includes(q));
  }, [busqueda, clientes]);

  if (clienteAbierto) {
    return (
      <FichaCliente
        cliente={clienteAbierto}
        onVolver={() => setClienteAbierto(null)}
        onActualizado={(actualizado) => {
          setClienteAbierto(actualizado);
          cargar();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="font-display text-xl text-ink">Clientes</p>

      <input
        placeholder="Buscar por nombre o teléfono…"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
      />

      {cargando && <p className="pt-6 text-center text-sm text-muted">Cargando…</p>}

      {!cargando && filtrados.length === 0 && (
        <p className="pt-6 text-center text-sm text-muted">
          {busqueda
            ? 'No encontré ningún cliente con eso.'
            : 'Todavía no hay clientes. Se cargan solos cuando alguien agenda un turno o compra algo.'}
        </p>
      )}

      <div className="space-y-2">
        {filtrados.map((c) => (
          <button
            key={c.id}
            onClick={() => setClienteAbierto(c)}
            className="flex w-full items-center justify-between rounded-xl bg-surface p-3 text-left shadow-card active:scale-[0.99]"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{c.nombre}</p>
              <p className="text-xs text-muted">{c.telefono} · última vez {fechaTexto(c.ultima_actividad)}</p>
            </div>
            {Number(c.total_gastado) > 0 && (
              <p className="shrink-0 font-mono text-sm text-ink">
                Gs. {Number(c.total_gastado).toLocaleString('es-PY')}
              </p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function FichaCliente({ cliente, onVolver, onActualizado }) {
  const [nombre, setNombre] = useState(cliente.nombre);
  const [notas, setNotas] = useState(cliente.notas || '');
  const [guardando, setGuardando] = useState(false);
  const [historial, setHistorial] = useState(null);

  useEffect(() => {
    cargarHistorial();
  }, [cliente.id]);

  async function cargarHistorial() {
    const [turnosRes, ventasRes] = await Promise.all([
      supabase
        .from('turnos')
        .select('id, fecha_hora, estado, servicio:servicios(nombre)')
        .eq('cliente_id', cliente.id)
        .order('fecha_hora', { ascending: false })
        .limit(15),
      supabase
        .from('ventas')
        .select('id, creado_en, total, estado')
        .eq('cliente_id', cliente.id)
        .order('creado_en', { ascending: false })
        .limit(15),
    ]);

    const eventos = [
      ...(turnosRes.data || []).map((t) => ({
        tipo: 'turno',
        fecha: t.fecha_hora,
        titulo: t.servicio?.nombre || 'Turno',
        estado: t.estado,
      })),
      ...(ventasRes.data || []).map((v) => ({
        tipo: 'venta',
        fecha: v.creado_en,
        titulo: `Compra · Gs. ${Number(v.total).toLocaleString('es-PY')}`,
        estado: v.estado,
      })),
    ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    setHistorial(eventos);
  }

  async function guardar() {
    setGuardando(true);
    const { data } = await supabase
      .from('clientes')
      .update({ nombre, notas })
      .eq('id', cliente.id)
      .select()
      .maybeSingle();
    setGuardando(false);
    if (data) onActualizado({ ...cliente, ...data });
  }

  return (
    <div className="space-y-4">
      <button onClick={onVolver} className="flex items-center gap-1 text-sm text-muted">
        <ChevronLeft size={16} /> Volver a clientes
      </button>

      <div className="rounded-2xl bg-surface p-4 shadow-card">
        <label className="text-xs text-muted">Nombre</label>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />

        <div className="mt-3 flex items-center gap-2 text-sm text-muted">
          <Phone size={14} />
          <a href={`https://wa.me/${cliente.telefono}`} target="_blank" rel="noreferrer" className="text-accent">
            {cliente.telefono}
          </a>
        </div>

        <label className="mt-3 block text-xs text-muted">Notas</label>
        <textarea
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />

        <button
          onClick={guardar}
          disabled={guardando}
          className="mt-3 w-full rounded-lg bg-accent py-2 text-xs font-medium text-accent-ink disabled:opacity-60"
        >
          {guardando ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 rounded-2xl bg-surface p-3 text-center shadow-card">
          <p className="font-display text-xl font-semibold text-ink">{cliente.turnos_totales}</p>
          <p className="text-xs text-muted">Turnos</p>
        </div>
        <div className="flex-1 rounded-2xl bg-surface p-3 text-center shadow-card">
          <p className="font-display text-xl font-semibold text-ink">{cliente.compras_totales}</p>
          <p className="text-xs text-muted">Compras</p>
        </div>
        <div className="flex-1 rounded-2xl bg-surface p-3 text-center shadow-card">
          <p className="font-display text-xl font-semibold text-accent">
            Gs. {Number(cliente.total_gastado).toLocaleString('es-PY')}
          </p>
          <p className="text-xs text-muted">Gastado</p>
        </div>
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Historial</p>
        <div className="mt-2 space-y-2">
          {historial === null && <p className="pt-4 text-center text-sm text-muted">Cargando…</p>}
          {historial?.length === 0 && (
            <p className="pt-4 text-center text-sm text-muted">Todavía no tiene turnos ni compras.</p>
          )}
          {historial?.map((ev, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl bg-surface p-3 shadow-card">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft">
                {ev.tipo === 'turno' ? (
                  <Calendar size={14} className="text-accent" />
                ) : (
                  <ShoppingBag size={14} className="text-accent" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">{ev.titulo}</p>
                <p className="text-xs text-muted">{fechaHoraTexto(ev.fecha)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
