import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Phone, Calendar, ShoppingBag, CreditCard, MessageCircle, Plus, Check, Cake, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useEsEscritorio } from '../hooks/useEsEscritorio';
import HistorialConversacion from '../components/HistorialConversacion';

// "YYYY-MM-DD" → mes (0-11), sin pasar por Date() para no correrse de
// día por huso horario (misma precaución que dia_mes en GastosFijos).
function mesDeFechaISO(fechaISO) {
  return Number(fechaISO.slice(5, 7)) - 1;
}

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
  const { esEscritorio } = useEsEscritorio();
  const tieneRetail = (negocio?.modulos_activos || []).some((m) => m === 'pos' || m === 'inventario');
  const [clientes, setClientes] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [soloConDeuda, setSoloConDeuda] = useState(false);
  const [soloCumpleanos, setSoloCumpleanos] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [clienteAbierto, setClienteAbierto] = useState(null);
  const [clienteParaDeuda, setClienteParaDeuda] = useState(null);
  const [montoDeuda, setMontoDeuda] = useState('');
  const [vencimientoDeuda, setVencimientoDeuda] = useState('');
  const [guardandoDeuda, setGuardandoDeuda] = useState(false);

  useEffect(() => {
    if (!negocio) return;
    cargar();
  }, [negocio]);

  async function agregarDeudaRapida(e) {
    e.preventDefault();
    const monto = Number(montoDeuda);
    if (!monto || monto <= 0) return;

    setGuardandoDeuda(true);
    await supabase.from('creditos_clientes').insert({
      negocio_id: negocio.id,
      cliente_id: clienteParaDeuda.id,
      monto,
      saldo_pendiente: monto,
      fecha_vencimiento: vencimientoDeuda || null,
    });
    setGuardandoDeuda(false);
    setMontoDeuda('');
    setVencimientoDeuda('');
    setClienteParaDeuda(null);
    cargar();
  }

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

  const mesActual = new Date().getMonth();

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    let lista = clientes;
    if (q) lista = lista.filter((c) => c.nombre.toLowerCase().includes(q) || c.telefono.includes(q));
    if (soloConDeuda) lista = lista.filter((c) => Number(c.deuda_pendiente) > 0);
    if (soloCumpleanos) {
      lista = lista.filter((c) => c.fecha_nacimiento && mesDeFechaISO(c.fecha_nacimiento) === mesActual);
    }
    return lista;
  }, [busqueda, clientes, soloConDeuda, soloCumpleanos, mesActual]);

  if (clienteAbierto) {
    return (
      <FichaCliente
        cliente={clienteAbierto}
        esEscritorio={esEscritorio}
        onVolver={() => setClienteAbierto(null)}
        onActualizado={(actualizado) => {
          setClienteAbierto(actualizado);
          cargar();
        }}
      />
    );
  }

  const sinResultados = !cargando && filtrados.length === 0;

  return (
    <div className="space-y-4">
      <p className="font-display text-xl text-ink">Clientes</p>

      <div className={esEscritorio ? 'flex items-center gap-3' : 'space-y-2'}>
        <input
          placeholder="Buscar por nombre o teléfono…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className={`rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent ${
            esEscritorio ? 'w-72' : 'w-full'
          }`}
        />

        {esEscritorio && (
          <>
            {tieneRetail && (
              <button
                onClick={() => setSoloConDeuda((v) => !v)}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium ${
                  soloConDeuda ? 'bg-danger-soft text-danger' : 'bg-surface text-muted'
                }`}
              >
                <CreditCard size={14} /> Con deuda
              </button>
            )}
            <button
              onClick={() => setSoloCumpleanos((v) => !v)}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium ${
                soloCumpleanos ? 'bg-accent-soft text-accent' : 'bg-surface text-muted'
              }`}
            >
              <Cake size={14} /> Cumplen este mes
            </button>
          </>
        )}
      </div>

      {cargando && <p className="pt-6 text-center text-sm text-muted">Cargando…</p>}

      {sinResultados && (
        <p className="pt-6 text-center text-sm text-muted">
          {busqueda || soloConDeuda || soloCumpleanos
            ? 'No encontré ningún cliente con eso.'
            : 'Todavía no hay clientes. Se cargan solos cuando alguien agenda un turno o compra algo.'}
        </p>
      )}

      {!cargando && !sinResultados && !esEscritorio && (
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
      )}

      {!cargando && !sinResultados && esEscritorio && (
        <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Teléfono</th>
                <th className="px-4 py-3">Última actividad</th>
                <th className="px-4 py-3 text-right">Turnos</th>
                <th className="px-4 py-3 text-right">Compras</th>
                <th className="px-4 py-3 text-right">Gastado</th>
                {tieneRetail && <th className="px-4 py-3 text-right">Deuda</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtrados.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setClienteAbierto(c)}
                  className="cursor-pointer hover:bg-surface2"
                >
                  <td className="px-4 py-3 font-medium text-ink">{c.nombre}</td>
                  <td className="px-4 py-3 text-muted">{c.telefono}</td>
                  <td className="px-4 py-3 text-muted">{fechaTexto(c.ultima_actividad)}</td>
                  <td className="px-4 py-3 text-right text-ink">{c.turnos_totales}</td>
                  <td className="px-4 py-3 text-right text-ink">{c.compras_totales}</td>
                  <td className="px-4 py-3 text-right font-mono text-ink">
                    Gs. {Number(c.total_gastado).toLocaleString('es-PY')}
                  </td>
                  {tieneRetail && (
                    <td className="px-4 py-3 text-right font-mono">
                      <div className="flex items-center justify-end gap-2">
                        {Number(c.deuda_pendiente) > 0 ? (
                          <span className="text-danger">Gs. {Number(c.deuda_pendiente).toLocaleString('es-PY')}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setClienteParaDeuda(c);
                          }}
                          title="Añadir deuda"
                          className="rounded-full bg-danger-soft p-1 text-danger"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {clienteParaDeuda && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setClienteParaDeuda(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-surface p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-display text-lg text-ink">Añadir deuda</p>
                <p className="text-xs text-muted">{clienteParaDeuda.nombre}</p>
              </div>
              <button onClick={() => setClienteParaDeuda(null)} className="shrink-0 text-muted">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={agregarDeudaRapida} className="mt-3 space-y-2">
              <input
                type="number"
                placeholder="Monto Gs."
                autoFocus
                value={montoDeuda}
                onChange={(e) => setMontoDeuda(e.target.value)}
                onWheel={(e) => e.currentTarget.blur()}
                className="w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
              />
              <input
                type="date"
                value={vencimientoDeuda}
                onChange={(e) => setVencimientoDeuda(e.target.value)}
                className="w-full rounded-lg border border-line bg-base px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="submit"
                disabled={guardandoDeuda}
                className="w-full rounded-lg bg-accent py-2.5 text-sm font-medium text-accent-ink disabled:opacity-60"
              >
                {guardandoDeuda ? 'Guardando…' : 'Registrar deuda'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function FichaCliente({ cliente, esEscritorio, onVolver, onActualizado }) {
  const { negocio } = useAuth();
  const tieneRetail = (negocio?.modulos_activos || []).some((m) => m === 'pos' || m === 'inventario');
  const [nombre, setNombre] = useState(cliente.nombre);
  const [notas, setNotas] = useState(cliente.notas || '');
  const [fechaNacimiento, setFechaNacimiento] = useState(cliente.fecha_nacimiento || '');
  const [guardando, setGuardando] = useState(false);
  const [historial, setHistorial] = useState(null);
  const [conversacionAbierta, setConversacionAbierta] = useState(null);
  const [creditos, setCreditos] = useState([]);
  const [vistaCredito, setVistaCredito] = useState(false);
  const [montoCredito, setMontoCredito] = useState('');
  const [vencimientoCredito, setVencimientoCredito] = useState('');
  const [guardandoCredito, setGuardandoCredito] = useState(false);

  useEffect(() => {
    cargarHistorial();
    if (tieneRetail) cargarCreditos();
  }, [cliente.id]);

  async function cargarCreditos() {
    const { data } = await supabase
      .from('creditos_clientes')
      .select('*')
      .eq('cliente_id', cliente.id)
      .order('fecha_vencimiento', { ascending: true, nullsFirst: false });
    setCreditos(data || []);
  }

  async function marcarPagado(creditoId) {
    await supabase
      .from('creditos_clientes')
      .update({ estado: 'pagado', saldo_pendiente: 0 })
      .eq('id', creditoId);
    cargarCreditos();
  }

  async function agregarCredito(e) {
    e.preventDefault();
    const monto = Number(montoCredito);
    if (!monto || monto <= 0) return;

    setGuardandoCredito(true);
    await supabase.from('creditos_clientes').insert({
      negocio_id: negocio.id,
      cliente_id: cliente.id,
      monto,
      saldo_pendiente: monto,
      fecha_vencimiento: vencimientoCredito || null,
    });
    setGuardandoCredito(false);
    setMontoCredito('');
    setVencimientoCredito('');
    setVistaCredito(false);
    cargarCreditos();
  }

  async function cargarHistorial() {
    // Línea de tiempo unificada (turnos + compras + conversaciones): lo
    // que la sección 6.8 del doc de pantallas marca como el diferencial
    // real frente a la competencia — nadie más junta estas tres cosas.
    const [turnosRes, ventasRes, conversacionesRes] = await Promise.all([
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
      supabase
        .from('conversaciones')
        .select('id, estado, ultima_actividad')
        .eq('cliente_id', cliente.id)
        .order('ultima_actividad', { ascending: false })
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
      ...(conversacionesRes.data || []).map((cv) => ({
        tipo: 'conversacion',
        fecha: cv.ultima_actividad,
        titulo: 'Conversación por WhatsApp',
        estado: cv.estado,
        conversacionId: cv.id,
      })),
    ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    setHistorial(eventos);
  }

  async function guardar() {
    setGuardando(true);
    const { data } = await supabase
      .from('clientes')
      .update({ nombre, notas, fecha_nacimiento: fechaNacimiento || null })
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

      <div className={esEscritorio ? 'grid grid-cols-[380px_1fr] items-start gap-6' : 'space-y-4'}>
      <div className="space-y-4">
      <div className="rounded-2xl bg-surface p-4 shadow-card">
        <label className="text-xs text-muted">Nombre</label>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
        />

        <div className="mt-3 flex items-center gap-2 text-sm text-muted">
          <Phone size={14} />
          <a href={`https://wa.me/${cliente.telefono}`} target="_blank" rel="noreferrer" className="text-accent">
            {cliente.telefono}
          </a>
        </div>

        <label className="mt-3 block text-xs text-muted">Cumpleaños (opcional)</label>
        <input
          type="date"
          value={fechaNacimiento}
          onChange={(e) => setFechaNacimiento(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
        />

        <label className="mt-3 block text-xs text-muted">Notas</label>
        <textarea
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
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

      {tieneRetail && (
        <div>
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Créditos</p>
            <button
              onClick={() => setVistaCredito((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-accent"
            >
              <Plus size={12} /> Agregar
            </button>
          </div>

          {vistaCredito && (
            <form onSubmit={agregarCredito} className="mt-2 space-y-2 rounded-xl bg-surface p-3 shadow-card">
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Monto Gs."
                  value={montoCredito}
                  onChange={(e) => setMontoCredito(e.target.value)}
                  onWheel={(e) => e.currentTarget.blur()}
                  className="flex-1 rounded-lg border border-line bg-base px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
                />
                <input
                  type="date"
                  value={vencimientoCredito}
                  onChange={(e) => setVencimientoCredito(e.target.value)}
                  className="flex-1 rounded-lg border border-line bg-base px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <button
                type="submit"
                disabled={guardandoCredito}
                className="w-full rounded-lg bg-accent py-2 text-xs font-medium text-accent-ink disabled:opacity-60"
              >
                {guardandoCredito ? 'Guardando…' : 'Registrar crédito'}
              </button>
            </form>
          )}

          <div className="mt-2 space-y-2">
            {creditos.length === 0 && !vistaCredito && (
              <p className="pt-2 text-center text-sm text-muted">Sin créditos registrados.</p>
            )}
            {creditos.map((cr) => (
              <div key={cr.id} className="flex items-center justify-between rounded-xl bg-surface p-3 shadow-card">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger-soft">
                    <CreditCard size={14} className="text-danger" />
                  </span>
                  <div>
                    <p className="text-sm text-ink">
                      Gs. {Number(cr.saldo_pendiente).toLocaleString('es-PY')}
                      {cr.estado === 'pagado' && <span className="ml-1.5 text-xs text-accent">· pagado</span>}
                    </p>
                    <p className="text-xs text-muted">
                      {cr.fecha_vencimiento ? `Vence ${fechaTexto(cr.fecha_vencimiento)}` : 'Sin vencimiento'}
                    </p>
                  </div>
                </div>
                {cr.estado !== 'pagado' && (
                  <button
                    onClick={() => marcarPagado(cr.id)}
                    className="flex shrink-0 items-center gap-1 rounded-lg bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent"
                  >
                    <Check size={12} /> Pagado
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Historial</p>
        <p className="mt-0.5 text-xs text-muted">Turnos, compras y conversaciones, todo en una sola línea de tiempo.</p>
        <div className="mt-2 space-y-2">
          {historial === null && <p className="pt-4 text-center text-sm text-muted">Cargando…</p>}
          {historial?.length === 0 && (
            <p className="pt-4 text-center text-sm text-muted">Todavía no tiene turnos, compras ni conversaciones.</p>
          )}
          {historial?.map((ev, i) => {
            const esConversacion = ev.tipo === 'conversacion';
            const Icono = ev.tipo === 'turno' ? Calendar : ev.tipo === 'venta' ? ShoppingBag : MessageCircle;
            const contenido = (
              <>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft">
                  <Icono size={14} className="text-accent" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{ev.titulo}</p>
                  <p className="text-xs text-muted">{fechaHoraTexto(ev.fecha)}</p>
                </div>
              </>
            );
            return esConversacion ? (
              <button
                key={i}
                onClick={() => setConversacionAbierta({ id: ev.conversacionId, cliente: { nombre, telefono: cliente.telefono } })}
                className="flex w-full items-center gap-3 rounded-xl bg-surface p-3 text-left shadow-card active:scale-[0.99]"
              >
                {contenido}
              </button>
            ) : (
              <div key={i} className="flex items-center gap-3 rounded-xl bg-surface p-3 shadow-card">
                {contenido}
              </div>
            );
          })}
        </div>
      </div>
      </div>

      {conversacionAbierta && (
        <HistorialConversacion conversacion={conversacionAbierta} onCerrar={() => setConversacionAbierta(null)} />
      )}
    </div>
  );
}
