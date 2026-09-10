import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Receipt, Ban } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import MetricPill from '../components/MetricPill';

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
  const [periodo, setPeriodo] = useState('hoy');
  const [ventas, setVentas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [ventaAbierta, setVentaAbierta] = useState(null); // id de la venta con el detalle abierto
  const [detalle, setDetalle] = useState(null);
  const [anulando, setAnulando] = useState(false);
  const anulandoRef = useRef(false);
  const [errorAnular, setErrorAnular] = useState(null);

  useEffect(() => {
    if (!negocio) return;
    cargar();
  }, [negocio, periodo]);

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

  const completadas = useMemo(() => ventas.filter((v) => v.estado !== 'anulada'), [ventas]);
  const totalVendido = completadas.reduce((acc, v) => acc + Number(v.total), 0);
  const ticketPromedio = completadas.length ? Math.round(totalVendido / completadas.length) : 0;

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
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="font-display text-xl text-ink">Ventas</p>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {PERIODOS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriodo(p.id)}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium ${
              periodo === p.id ? 'bg-accent text-white' : 'bg-surface text-muted'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex gap-3">
        <MetricPill label="Vendido" value={formatoGsCompacto(totalVendido)} tone="accent" compact />
        <MetricPill label="Ventas" value={completadas.length} />
        <MetricPill label="Ticket prom." value={formatoGsCompacto(ticketPromedio)} compact />
      </div>

      {cargando && <p className="pt-6 text-center text-sm text-muted">Cargando…</p>}

      {!cargando && ventas.length === 0 && (
        <p className="pt-6 text-center text-sm text-muted">
          Todavía no hay ventas para este período. Cuando cobres algo en Vender, va a aparecer acá.
        </p>
      )}

      <div className="space-y-2">
        {ventas.map((v) => (
          <button
            key={v.id}
            onClick={() => abrirDetalle(v)}
            className={`flex w-full items-center justify-between rounded-xl bg-surface p-3 text-left shadow-card active:scale-[0.99] ${
              v.estado === 'anulada' ? 'opacity-50' : ''
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft">
                {v.estado === 'anulada' ? (
                  <Ban size={16} className="text-danger" />
                ) : (
                  <Receipt size={16} className="text-accent" />
                )}
              </span>
              <div>
                <p className="text-sm font-medium text-ink">
                  {v.cliente?.nombre || 'Cliente sin registrar'}
                  {v.estado === 'anulada' && <span className="ml-1.5 text-xs text-danger">· anulada</span>}
                </p>
                <p className="text-xs text-muted">
                  {fechaHoraTexto(v.creado_en)} · {v.metodo_pago ? METODOS_LABEL[v.metodo_pago] || v.metodo_pago : 'Pago dividido'}
                </p>
              </div>
            </div>
            <p className={`font-mono text-sm ${v.estado === 'anulada' ? 'text-muted line-through' : 'text-ink'}`}>
              Gs. {Number(v.total).toLocaleString('es-PY')}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function DetalleVenta({ venta, items, pagos = [], onAnular, anulando, error }) {
  const [confirmando, setConfirmando] = useState(false);
  const [motivo, setMotivo] = useState('');

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
        </div>
        <p className="text-xs text-muted">{fechaHoraTexto(venta.creado_en)}</p>

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

        {venta.estado === 'anulada' && venta.anulada_motivo && (
          <p className="mt-3 rounded-lg bg-danger-soft p-2.5 text-xs text-danger">
            Motivo de anulación: {venta.anulada_motivo}
          </p>
        )}
      </div>

      {error && <p className="rounded-xl bg-danger-soft p-3 text-xs text-danger">{error}</p>}

      {venta.estado !== 'anulada' && !confirmando && (
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
    </div>
  );
}
