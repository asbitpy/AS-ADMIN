import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Receipt, Ban, Clock, Paperclip, Download } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useRealtimeTick } from '../lib/realtime';
import { urlComprobante } from '../lib/storage';
import MetricPill from '../components/MetricPill';
import { useEsEscritorio } from '../hooks/useEsEscritorio';
import { descargarPDF } from '../lib/pdf';

// Mismo criterio que Productos.jsx: un monto de más de 7 cifras no entra
// en un tercio de pantalla, así que se abrevia en millones.
function formatoGsCompacto(monto) {
  const n = Number(monto);
  if (n >= 1_000_000) {
    return `Gs. ${(n / 1_000_000).toLocaleString('es-PY', { maximumFractionDigits: 1 })} M`;
  }
  return `Gs. ${n.toLocaleString('es-PY')}`;
}

const PERIODOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
  { id: 'todo', label: 'Todo' },
];

const METODOS_LABEL = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  qr: 'QR',
  credito: 'Crédito',
};

const METODOS_PAGO = ['efectivo', 'transferencia', 'tarjeta', 'qr'];

const CANAL_LABEL = {
  local: 'Local',
  ecommerce: 'Ecommerce',
  whatsapp: 'WhatsApp',
};

function fechaDDMMYYYY(fechaISO) {
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(fechaISO));
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

function desdePeriodo(periodo) {
  const ahora = new Date();
  if (periodo === 'hoy') {
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(ahora);
    return new Date(`${hoy}T00:00:00-03:00`).toISOString();
  }
  if (periodo === 'semana') return new Date(ahora.getTime() - 7 * 86400000).toISOString();
  if (periodo === 'mes') return new Date(ahora.getTime() - 30 * 86400000).toISOString();
  return null; // 'todo'
}

export default function Ventas() {
  const { negocio } = useAuth();
  const { esEscritorio } = useEsEscritorio();
  const [periodo, setPeriodo] = useState('hoy');
  const [ventas, setVentas] = useState([]);
  const [cargando, setCargando] = useState(true);
  // Filtros de escritorio (sección 6.5 del doc de pantallas: rango de
  // fechas, método de pago, vendedor, canal) — en celular no existen,
  // así que quedan siempre "todos" ahí y la lista nunca se filtra.
  const [filtroMetodo, setFiltroMetodo] = useState('todos');
  const [filtroCanal, setFiltroCanal] = useState('todos');
  const [filtroVendedor, setFiltroVendedor] = useState('todos');
  const [nombresUsuarios, setNombresUsuarios] = useState({});
  const [ventaAbierta, setVentaAbierta] = useState(null); // id de la venta con el detalle abierto
  const [detalle, setDetalle] = useState(null);
  const [anulando, setAnulando] = useState(false);
  const anulandoRef = useRef(false);
  const [errorAnular, setErrorAnular] = useState(null);
  const [procesandoReserva, setProcesandoReserva] = useState(false);
  const procesandoReservaRef = useRef(false);
  const [errorReserva, setErrorReserva] = useState(null);

  const tickVentas = useRealtimeTick('ventas', negocio?.id);

  useEffect(() => {
    if (!negocio) return;
    cargar();
  }, [negocio, periodo, tickVentas]);

  useEffect(() => {
    if (!negocio) return;
    supabase
      .from('usuarios')
      .select('auth_user_id, nombre')
      .eq('negocio_id', negocio.id)
      .then(({ data }) => {
        const mapa = {};
        for (const u of data || []) mapa[u.auth_user_id] = u.nombre;
        setNombresUsuarios(mapa);
      });
  }, [negocio]);

  function nombreVendedor(authUserId) {
    if (!authUserId) return 'Sin asignar';
    if (authUserId === negocio.auth_user_id) return negocio.nombre_dueno || 'Vos';
    return nombresUsuarios[authUserId] || 'Ex-empleado';
  }

  async function cargar() {
    setCargando(true);
    let query = supabase
      .from('ventas')
      .select('*, cliente:clientes(nombre, telefono)')
      .eq('negocio_id', negocio.id)
      .order('creado_en', { ascending: false })
      .limit(200);

    const desde = desdePeriodo(periodo);
    if (desde) query = query.gte('creado_en', desde);

    const { data } = await query;
    setVentas(data || []);
    setCargando(false);
  }

  async function abrirDetalle(venta) {
    setVentaAbierta(venta.id);
    setDetalle(null);
    const [itemsRes, pagosRes] = await Promise.all([
      supabase
        .from('venta_items')
        .select('*, producto:productos(nombre), variante:variantes_producto(atributo1_valor, atributo2_valor)')
        .eq('venta_id', venta.id),
      supabase.from('venta_pagos').select('*').eq('venta_id', venta.id).order('creado_en'),
    ]);
    setDetalle({ venta, items: itemsRes.data || [], pagos: pagosRes.data || [] });
  }

  // Recibe el motivo como parámetro en vez de pedirlo con window.prompt():
  // el diálogo nativo del navegador se puede quedar mudo (Chrome ofrece
  // "no volver a preguntar en esta página" después de un par de
  // confirmaciones seguidas), y ahí el botón parece "no hacer nada".
  async function anular(venta, motivo) {
    if (anulandoRef.current) return;
    anulandoRef.current = true;
    setErrorAnular(null);
    setAnulando(true);
    const { error } = await supabase.rpc('fn_anular_venta', {
      p_venta_id: venta.id,
      p_motivo: motivo || null,
    });
    anulandoRef.current = false;
    setAnulando(false);

    if (error) {
      setErrorAnular('No se pudo anular: ' + error.message);
      return;
    }
    setVentaAbierta(null);
    cargar();
  }

  // Cierra un pedido reservado por WhatsApp: registra el cobro real (acá
  // recién se genera el ingreso, no cuando se apartó el producto) y no
  // vuelve a tocar el stock — ya se descontó al reservar.
  async function cobrarReserva(venta, metodoPago) {
    if (procesandoReservaRef.current) return;
    procesandoReservaRef.current = true;
    setErrorReserva(null);
    setProcesandoReserva(true);

    const { data: sesion } = await supabase
      .from('caja_sesiones')
      .select('id')
      .eq('negocio_id', venta.negocio_id)
      .eq('estado', 'abierta')
      .maybeSingle();

    const { error } = await supabase.rpc('fn_completar_reserva', {
      p_venta_id: venta.id,
      p_pagos: [{ metodo_pago: metodoPago, monto: venta.total }],
      p_caja_sesion_id: sesion?.id || null,
    });
    procesandoReservaRef.current = false;
    setProcesandoReserva(false);

    if (error) {
      setErrorReserva('No se pudo cobrar: ' + error.message);
      return;
    }
    setVentaAbierta(null);
    cargar();
  }

  // El cliente no retiró, o se arrepintió: devuelve el stock. Nunca genera
  // un movimiento financiero — una reserva nunca generó ingreso.
  async function cancelarReserva(venta, motivo) {
    if (procesandoReservaRef.current) return;
    procesandoReservaRef.current = true;
    setErrorReserva(null);
    setProcesandoReserva(true);
    const { error } = await supabase.rpc('fn_cancelar_reserva', {
      p_venta_id: venta.id,
      p_motivo: motivo || 'Cliente no retiró / canceló',
    });
    procesandoReservaRef.current = false;
    setProcesandoReserva(false);

    if (error) {
      setErrorReserva('No se pudo cancelar: ' + error.message);
      return;
    }
    setVentaAbierta(null);
    cargar();
  }

  const reservadas = useMemo(() => ventas.filter((v) => v.estado === 'reservada'), [ventas]);

  // Vendedores que aparecen en la lista actual, para llenar el filtro
  // sin tener que consultar 'usuarios' de nuevo ni mostrar a alguien
  // que nunca vendió nada en este período.
  const vendedoresEnLista = useMemo(() => {
    const ids = new Set(ventas.map((v) => v.usuario_id).filter(Boolean));
    return Array.from(ids).map((id) => ({ id, nombre: nombreVendedor(id) }));
  }, [ventas, nombresUsuarios, negocio?.auth_user_id]);

  const ventasFiltradas = useMemo(() => {
    return ventas.filter((v) => {
      if (filtroMetodo !== 'todos' && v.metodo_pago !== filtroMetodo) return false;
      if (filtroCanal !== 'todos' && v.canal !== filtroCanal) return false;
      if (filtroVendedor !== 'todos' && v.usuario_id !== filtroVendedor) return false;
      return true;
    });
  }, [ventas, filtroMetodo, filtroCanal, filtroVendedor]);

  const completadas = useMemo(() => ventasFiltradas.filter((v) => v.estado === 'completada'), [ventasFiltradas]);
  const totalVendido = completadas.reduce((acc, v) => acc + Number(v.total), 0);
  const ticketPromedio = completadas.length ? Math.round(totalVendido / completadas.length) : 0;

  // Mismo criterio que los CSV de Finanzas: ordenado cronológicamente,
  // con Ingreso separado de Anulado, y quién vendió cada una.
  function exportarVentasCSV() {
    const ordenadas = [...ventasFiltradas].sort((a, b) => a.creado_en.localeCompare(b.creado_en));
    const encabezados = [
      'Fecha',
      'Hora',
      'Cliente',
      'Canal',
      'Método de pago',
      'Estado',
      'Total (Gs.)',
      'Vendedor',
    ];
    const filas = ordenadas.map((v) => [
      fechaDDMMYYYY(v.creado_en),
      new Intl.DateTimeFormat('es-PY', { timeZone: 'America/Asuncion', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v.creado_en)),
      v.cliente?.nombre || 'Sin registrar',
      CANAL_LABEL[v.canal] || v.canal,
      v.metodo_pago ? METODOS_LABEL[v.metodo_pago] || v.metodo_pago : 'Dividido',
      v.estado === 'completada' ? 'Completada' : v.estado === 'reservada' ? 'Pendiente de retiro' : 'Anulada',
      v.total,
      nombreVendedor(v.usuario_id),
    ]);

    const totalGeneral = ordenadas
      .filter((v) => v.estado === 'completada')
      .reduce((a, v) => a + Number(v.total), 0);
    filas.push(['', '', '', '', '', '', '', '']);
    filas.push(['TOTAL', '', `${ordenadas.length} ventas`, '', '', '', totalGeneral, '']);

    const contenido = '﻿' + [encabezados, ...filas].map((f) => f.join(';')).join('\r\n');
    const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ventas_${periodo}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportarVentasPDF() {
    const ordenadas = [...ventasFiltradas].sort((a, b) => a.creado_en.localeCompare(b.creado_en));
    const hora = new Intl.DateTimeFormat('es-PY', { timeZone: 'America/Asuncion', hour: '2-digit', minute: '2-digit', hour12: false });
    const totalGeneral = ordenadas.filter((v) => v.estado === 'completada').reduce((a, v) => a + Number(v.total), 0);
    await descargarPDF({
      titulo: `Ventas — ${negocio.nombre}`,
      subtitulo: `Período: ${periodo}`,
      encabezados: ['Fecha', 'Hora', 'Cliente', 'Canal', 'Método de pago', 'Estado', 'Total (Gs.)', 'Vendedor'],
      filas: ordenadas.map((v) => [
        fechaDDMMYYYY(v.creado_en),
        hora.format(new Date(v.creado_en)),
        v.cliente?.nombre || 'Sin registrar',
        CANAL_LABEL[v.canal] || v.canal,
        v.metodo_pago ? METODOS_LABEL[v.metodo_pago] || v.metodo_pago : 'Dividido',
        v.estado === 'completada' ? 'Completada' : v.estado === 'reservada' ? 'Pendiente de retiro' : 'Anulada',
        Number(v.total).toLocaleString('es-PY'),
        nombreVendedor(v.usuario_id),
      ]),
      totales: ['TOTAL', '', `${ordenadas.length} ventas`, '', '', '', totalGeneral.toLocaleString('es-PY'), ''],
      columnasNumericas: [6],
      nombreArchivo: `ventas_${periodo}_${new Date().toISOString().slice(0, 10)}.pdf`,
    });
  }

  if (ventaAbierta) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setVentaAbierta(null)}
          className="flex items-center gap-1 text-sm text-muted"
        >
          <ChevronLeft size={16} /> Volver a ventas
        </button>

        {!detalle ? (
          <p className="pt-6 text-center text-sm text-muted">Cargando…</p>
        ) : (
          <DetalleVenta
            venta={detalle.venta}
            items={detalle.items}
            pagos={detalle.pagos}
            onAnular={anular}
            anulando={anulando}
            error={errorAnular}
            onCobrarReserva={cobrarReserva}
            onCancelarReserva={cancelarReserva}
            procesandoReserva={procesandoReserva}
            errorReserva={errorReserva}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="font-display text-xl text-ink">Ventas</p>

      <div className="flex flex-wrap items-center gap-2 overflow-x-auto pb-1">
        {PERIODOS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriodo(p.id)}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium ${
              periodo === p.id ? 'bg-accent text-accent-ink' : 'bg-surface text-muted'
            }`}
          >
            {p.label}
          </button>
        ))}

        {esEscritorio && (
          <>
            <select
              value={filtroMetodo}
              onChange={(e) => setFiltroMetodo(e.target.value)}
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-muted outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="todos">Todos los métodos</option>
              {METODOS_PAGO.map((m) => (
                <option key={m} value={m}>
                  {METODOS_LABEL[m]}
                </option>
              ))}
            </select>
            <select
              value={filtroCanal}
              onChange={(e) => setFiltroCanal(e.target.value)}
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-muted outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="todos">Todos los canales</option>
              {Object.entries(CANAL_LABEL).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            {vendedoresEnLista.length > 0 && (
              <select
                value={filtroVendedor}
                onChange={(e) => setFiltroVendedor(e.target.value)}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-muted outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="todos">Todos los vendedores</option>
                {vendedoresEnLista.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nombre}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={exportarVentasCSV}
              className="ml-auto flex items-center gap-1 text-xs font-medium text-accent"
            >
              <Download size={12} /> Exportar CSV
            </button>
            {esEscritorio && (
              <button onClick={exportarVentasPDF} className="flex items-center gap-1 text-xs font-medium text-accent">
                <Download size={12} /> Exportar PDF
              </button>
            )}
          </>
        )}
      </div>

      <div className="flex gap-3">
        <MetricPill label="Vendido" value={formatoGsCompacto(totalVendido)} tone="accent" compact />
        <MetricPill label="Ventas" value={completadas.length} />
        <MetricPill label="Ticket prom." value={formatoGsCompacto(ticketPromedio)} compact />
      </div>

      {reservadas.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-soft px-3 py-2 text-xs text-amber">
          <Clock size={16} />
          {reservadas.length === 1
            ? '1 pedido por WhatsApp pendiente de retiro.'
            : `${reservadas.length} pedidos por WhatsApp pendientes de retiro.`}
        </div>
      )}

      {cargando && <p className="pt-6 text-center text-sm text-muted">Cargando…</p>}

      {!cargando && ventas.length === 0 && (
        <p className="pt-6 text-center text-sm text-muted">
          Todavía no hay ventas para este período. Cuando cobres algo en Vender, va a aparecer acá.
        </p>
      )}

      {!cargando && ventas.length > 0 && ventasFiltradas.length === 0 && (
        <p className="pt-6 text-center text-sm text-muted">Ninguna venta con esos filtros.</p>
      )}

      {!esEscritorio && (
        <div className="space-y-2">
          {ventasFiltradas.map((v) => (
            <button
              key={v.id}
              onClick={() => abrirDetalle(v)}
              className={`flex w-full items-center justify-between rounded-xl bg-surface p-3 text-left shadow-card active:scale-[0.99] ${
                v.estado === 'anulada' ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full ${
                    v.estado === 'reservada' ? 'bg-amber-soft' : 'bg-accent-soft'
                  }`}
                >
                  {v.estado === 'anulada' ? (
                    <Ban size={16} className="text-danger" />
                  ) : v.estado === 'reservada' ? (
                    <Clock size={16} className="text-amber" />
                  ) : (
                    <Receipt size={16} className="text-accent" />
                  )}
                </span>
                <div>
                  <p className="text-sm font-medium text-ink">
                    {v.cliente?.nombre || 'Cliente sin registrar'}
                    {v.estado === 'anulada' && <span className="ml-1.5 text-xs text-danger">· anulada</span>}
                    {v.estado === 'reservada' && <span className="ml-1.5 text-xs text-amber">· pendiente de retiro</span>}
                  </p>
                  <p className="text-xs text-muted">
                    {fechaHoraTexto(v.creado_en)} ·{' '}
                    {v.estado === 'reservada'
                      ? 'Pedido por WhatsApp'
                      : v.metodo_pago
                        ? METODOS_LABEL[v.metodo_pago] || v.metodo_pago
                        : 'Pago dividido'}
                  </p>
                </div>
              </div>
              <p className={`font-mono text-sm ${v.estado === 'anulada' ? 'text-muted line-through' : 'text-ink'}`}>
                Gs. {Number(v.total).toLocaleString('es-PY')}
              </p>
            </button>
          ))}
        </div>
      )}

      {esEscritorio && ventasFiltradas.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Canal</th>
                <th className="px-4 py-3">Método</th>
                <th className="px-4 py-3">Vendedor</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ventasFiltradas.map((v) => (
                <tr
                  key={v.id}
                  onClick={() => abrirDetalle(v)}
                  className={`cursor-pointer hover:bg-surface2 ${v.estado === 'anulada' ? 'opacity-50' : ''}`}
                >
                  <td className="px-4 py-3 text-muted">{fechaHoraTexto(v.creado_en)}</td>
                  <td className="px-4 py-3 text-ink">{v.cliente?.nombre || 'Sin registrar'}</td>
                  <td className="px-4 py-3 text-muted">{CANAL_LABEL[v.canal] || v.canal}</td>
                  <td className="px-4 py-3 text-muted">
                    {v.estado === 'reservada'
                      ? 'Pedido WhatsApp'
                      : v.metodo_pago
                        ? METODOS_LABEL[v.metodo_pago] || v.metodo_pago
                        : 'Dividido'}
                  </td>
                  <td className="px-4 py-3 text-muted">{nombreVendedor(v.usuario_id)}</td>
                  <td className="px-4 py-3">
                    {v.estado === 'anulada' ? (
                      <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
                        Anulada
                      </span>
                    ) : v.estado === 'reservada' ? (
                      <span className="rounded-full bg-amber-soft px-2 py-0.5 text-xs font-medium text-amber">
                        Pendiente
                      </span>
                    ) : (
                      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                        Completada
                      </span>
                    )}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono ${
                      v.estado === 'anulada' ? 'text-muted line-through' : 'text-ink'
                    }`}
                  >
                    Gs. {Number(v.total).toLocaleString('es-PY')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DetalleVenta({
  venta,
  items,
  pagos = [],
  onAnular,
  anulando,
  error,
  onCobrarReserva,
  onCancelarReserva,
  procesandoReserva,
  errorReserva,
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [cancelandoReserva, setCancelandoReserva] = useState(false);
  const [motivoReserva, setMotivoReserva] = useState('');
  const [comprobanteUrl, setComprobanteUrl] = useState(null);
  const [cargandoComprobante, setCargandoComprobante] = useState(false);

  async function verComprobante() {
    setCargandoComprobante(true);
    try {
      const url = await urlComprobante(venta.comprobante_url);
      setComprobanteUrl(url);
    } catch (err) {
      console.error('Error obteniendo el comprobante:', err);
    } finally {
      setCargandoComprobante(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-surface p-4 shadow-card">
        <div className="flex items-center justify-between">
          <p className="font-display text-lg text-ink">{venta.cliente?.nombre || 'Cliente sin registrar'}</p>
          {venta.estado === 'anulada' && (
            <span className="rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-medium text-danger">
              Anulada
            </span>
          )}
          {venta.estado === 'reservada' && (
            <span className="rounded-full bg-amber-soft px-2.5 py-0.5 text-xs font-medium text-amber">
              Pendiente de retiro
            </span>
          )}
        </div>
        <p className="text-xs text-muted">{fechaHoraTexto(venta.creado_en)}</p>
        {venta.estado === 'reservada' && venta.reservado_hasta && (
          <p className="mt-1 flex items-center gap-1 text-xs text-amber">
            <Clock size={12} /> Apartado hasta {fechaHoraTexto(venta.reservado_hasta)} — si no lo retira, se libera solo
          </p>
        )}

        <div className="mt-3 space-y-1.5 border-t border-line pt-3">
          {items.map((it) => (
            <div key={it.id} className="flex items-center justify-between text-sm">
              <div>
                <p className="text-ink">{it.producto?.nombre}</p>
                {it.variante && (
                  <p className="text-xs text-muted">
                    {[it.variante.atributo1_valor, it.variante.atributo2_valor].filter(Boolean).join(' · ')}
                  </p>
                )}
                <p className="text-xs text-muted">
                  {it.cantidad} x Gs. {Number(it.precio_unitario).toLocaleString('es-PY')}
                  {Number(it.descuento) > 0 && ` − Gs. ${Number(it.descuento).toLocaleString('es-PY')} desc.`}
                </p>
              </div>
              <p className="font-mono text-ink">
                Gs. {(it.cantidad * it.precio_unitario - it.descuento).toLocaleString('es-PY')}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between text-muted">
            <span>Subtotal</span>
            <span className="font-mono">Gs. {Number(venta.subtotal).toLocaleString('es-PY')}</span>
          </div>
          {Number(venta.descuento) > 0 && (
            <div className="flex justify-between text-muted">
              <span>Descuento</span>
              <span className="font-mono">− Gs. {Number(venta.descuento).toLocaleString('es-PY')}</span>
            </div>
          )}
          <div className="flex justify-between font-medium text-ink">
            <span>Total</span>
            <span className="font-mono">Gs. {Number(venta.total).toLocaleString('es-PY')}</span>
          </div>
        </div>

        {pagos.length > 0 && (
          <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {pagos.length > 1 ? 'Pago dividido' : 'Método de pago'}
            </p>
            {pagos.map((p) => (
              <div key={p.id} className="flex justify-between text-muted">
                <span>{METODOS_LABEL[p.metodo_pago] || p.metodo_pago}</span>
                <span className="font-mono">Gs. {Number(p.monto).toLocaleString('es-PY')}</span>
              </div>
            ))}
          </div>
        )}

        {venta.estado === 'anulada' && venta.anulada_motivo && (
          <p className="mt-3 rounded-lg bg-danger-soft p-2.5 text-xs text-danger">
            Motivo de anulación: {venta.anulada_motivo}
          </p>
        )}

        {venta.comprobante_url && (
          <div className="mt-3 border-t border-line pt-3">
            {comprobanteUrl ? (
              <a href={comprobanteUrl} target="_blank" rel="noreferrer">
                <img src={comprobanteUrl} alt="Comprobante de pago" className="max-h-64 w-full rounded-lg object-contain" />
              </a>
            ) : (
              <button
                onClick={verComprobante}
                disabled={cargandoComprobante}
                className="flex items-center gap-1.5 text-xs font-medium text-accent disabled:opacity-60"
              >
                <Paperclip size={14} />
                {cargandoComprobante ? 'Cargando…' : 'Ver comprobante adjunto'}
              </button>
            )}
          </div>
        )}
      </div>

      {error && <p className="rounded-xl bg-danger-soft p-3 text-xs text-danger">{error}</p>}
      {errorReserva && <p className="rounded-xl bg-danger-soft p-3 text-xs text-danger">{errorReserva}</p>}

      {venta.estado === 'completada' && !confirmando && (
        <button
          onClick={() => setConfirmando(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-danger/30 py-3 text-sm font-medium text-danger"
        >
          <Ban size={16} /> Anular esta venta
        </button>
      )}

      {confirmando && (
        <div className="space-y-2 rounded-xl bg-danger-soft p-3">
          <p className="text-xs text-danger">¿Por qué anulás esta venta? (queda guardado, es opcional)</p>
          <input
            autoFocus
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej: el cliente se arrepintió"
            className="w-full rounded-lg border border-danger/30 bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-danger"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                setConfirmando(false);
                setMotivo('');
              }}
              disabled={anulando}
              className="flex-1 rounded-lg border border-line bg-surface py-2 text-xs font-medium text-ink disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={() => onAnular(venta, motivo)}
              disabled={anulando}
              className="flex-1 rounded-lg bg-danger py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              {anulando ? 'Anulando…' : 'Sí, anular'}
            </button>
          </div>
        </div>
      )}

      {venta.estado === 'reservada' && !cancelandoReserva && (
        <div className="space-y-2">
          <p className="text-center text-xs text-muted">El cliente llegó y quiere pagar. Elegí el método:</p>
          <div className="flex flex-wrap gap-2">
            {METODOS_PAGO.map((m) => (
              <button
                key={m}
                onClick={() => onCobrarReserva(venta, m)}
                disabled={procesandoReserva}
                className="flex-1 min-w-[45%] rounded-xl bg-brand py-3 text-sm font-medium text-ink disabled:opacity-50"
              >
                {procesandoReserva ? '…' : METODOS_LABEL[m]}
              </button>
            ))}
          </div>
          <button
            onClick={() => setCancelandoReserva(true)}
            disabled={procesandoReserva}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-danger/30 py-3 text-sm font-medium text-danger disabled:opacity-50"
          >
            <Ban size={16} /> Cancelar pedido (no vino / se arrepintió)
          </button>
        </div>
      )}

      {cancelandoReserva && (
        <div className="space-y-2 rounded-xl bg-danger-soft p-3">
          <p className="text-xs text-danger">¿Por qué cancelás este pedido? (queda guardado, es opcional)</p>
          <input
            autoFocus
            value={motivoReserva}
            onChange={(e) => setMotivoReserva(e.target.value)}
            placeholder="Ej: no vino a retirarlo"
            className="w-full rounded-lg border border-danger/30 bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-danger"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                setCancelandoReserva(false);
                setMotivoReserva('');
              }}
              disabled={procesandoReserva}
              className="flex-1 rounded-lg border border-line bg-surface py-2 text-xs font-medium text-ink disabled:opacity-50"
            >
              Volver
            </button>
            <button
              onClick={() => onCancelarReserva(venta, motivoReserva)}
              disabled={procesandoReserva}
              className="flex-1 rounded-lg bg-danger py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              {procesandoReserva ? 'Cancelando…' : 'Sí, cancelar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
