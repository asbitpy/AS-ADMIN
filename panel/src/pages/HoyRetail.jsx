import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, MessageCircle, Receipt } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useRealtimeTick } from '../lib/realtime';
import { useEsEscritorio } from '../hooks/useEsEscritorio';
import ConversacionAlerta from '../components/ConversacionAlerta';
import CajaBar from '../components/CajaBar';
import MetricPill from '../components/MetricPill';

function fechaISOParaguay(fecha) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(fecha);
}

function horaTexto(fecha) {
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(fecha));
}

function formatoGsCompacto(monto) {
  const n = Number(monto);
  if (n >= 1_000_000) return `Gs. ${(n / 1_000_000).toLocaleString('es-PY', { maximumFractionDigits: 1 })} M`;
  return `Gs. ${n.toLocaleString('es-PY')}`;
}

// "Hoy" para negocios retail sin módulo de agenda — antes no tenían
// portada propia y caían directo a una pantalla operativa (Vender)
// sin un resumen del día primero.
export default function HoyRetail() {
  const { negocio } = useAuth();
  const { esEscritorio } = useEsEscritorio();
  const [ventas, setVentas] = useState([]);
  const [derivadas, setDerivadas] = useState([]);
  const [stockBajo, setStockBajo] = useState([]);
  const [cargando, setCargando] = useState(true);

  const tickVentas = useRealtimeTick('ventas', negocio?.id);
  const tickConversaciones = useRealtimeTick('conversaciones', negocio?.id);
  const tickProductos = useRealtimeTick('productos', negocio?.id);

  useEffect(() => {
    if (!negocio) return;
    cargar();
  }, [negocio, tickVentas, tickConversaciones, tickProductos]);

  async function cargar() {
    setCargando(true);
    const desde = `${fechaISOParaguay(new Date())}T00:00:00-03:00`;

    const [ventasRes, derivadasRes, productosRes] = await Promise.all([
      supabase
        .from('ventas')
        .select('*, cliente:clientes(nombre)')
        .eq('negocio_id', negocio.id)
        .gte('creado_en', desde)
        .order('creado_en', { ascending: false }),
      supabase
        .from('conversaciones')
        .select('*, cliente:clientes(nombre, telefono)')
        .eq('negocio_id', negocio.id)
        .eq('estado', 'derivado_humano')
        .order('prioridad', { ascending: false }),
      supabase
        .from('productos')
        .select('id, nombre, stock, stock_minimo, tiene_variantes, variantes_producto(stock, activo)')
        .eq('negocio_id', negocio.id)
        .eq('activo', true),
    ]);

    setVentas(ventasRes.data || []);
    setDerivadas(derivadasRes.data || []);

    const bajo = (productosRes.data || [])
      .map((p) => ({
        ...p,
        stockTotal: p.tiene_variantes
          ? (p.variantes_producto || []).filter((v) => v.activo).reduce((a, v) => a + v.stock, 0)
          : p.stock,
      }))
      .filter((p) => p.stockTotal <= p.stock_minimo);
    setStockBajo(bajo);
    setCargando(false);
  }

  const completadas = ventas.filter((v) => v.estado === 'completada');
  const totalHoy = completadas.reduce((a, v) => a + Number(v.total), 0);
  const fechaTexto = new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  })
    .format(new Date())
    .replace(/^\w/, (c) => c.toUpperCase());

  return (
    <div className="space-y-3.5">
      <p className="font-display text-xl text-ink">{fechaTexto}</p>

      {!esEscritorio && (
        <>
          {derivadas.length > 0 && (
            <div className="space-y-1.5">
              {derivadas.map((c) => (
                <ConversacionAlerta key={c.id} conversacion={c} />
              ))}
            </div>
          )}

          {stockBajo.length > 0 && (
            <div className="rounded-xl bg-amber-soft px-3 py-2 text-xs text-amber">
              {stockBajo.length === 1
                ? `"${stockBajo[0].nombre}" está por debajo del stock mínimo.`
                : `${stockBajo.length} productos están por debajo del stock mínimo.`}
            </div>
          )}
        </>
      )}

      <CajaBar negocioId={negocio.id} />

      <div className="flex gap-3">
        <MetricPill label="Ventas hoy" value={completadas.length} />
        <MetricPill label="Vendido hoy" value={formatoGsCompacto(totalHoy)} tone="accent" compact />
        {esEscritorio && <MetricPill label="Stock bajo" value={stockBajo.length} tone={stockBajo.length > 0 ? 'danger' : 'ink'} />}
      </div>

      {!esEscritorio &&
        (cargando ? (
          <p className="pt-6 text-center text-sm text-muted">Cargando…</p>
        ) : (
          <div className="rounded-2xl bg-surface shadow-card">
            {ventas.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">Todavía no hay ventas hoy.</p>
            ) : (
              ventas.slice(0, 10).map((v) => (
                <div
                  key={v.id}
                  className={`flex items-center gap-2.5 border-b border-line px-3.5 py-2.5 last:border-0 ${
                    v.estado === 'anulada' ? 'opacity-50' : ''
                  }`}
                >
                  <Receipt size={16} className="shrink-0 text-accent" />
                  <span className="w-11 shrink-0 font-mono text-xs text-muted">{horaTexto(v.creado_en)}</span>
                  <span className="flex-1 truncate text-sm text-ink">{v.cliente?.nombre || 'Cliente sin registrar'}</span>
                  <span className="shrink-0 font-mono text-xs text-ink">Gs. {Number(v.total).toLocaleString('es-PY')}</span>
                </div>
              ))
            )}
          </div>
        ))}

      {esEscritorio && (
        <div className="grid items-start gap-4" style={{ gridTemplateColumns: '1fr 380px' }}>
          {cargando ? (
            <p className="pt-6 text-center text-sm text-muted">Cargando…</p>
          ) : (
            <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
              {ventas.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted">Todavía no hay ventas hoy.</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs font-medium uppercase tracking-wide text-muted">
                      <th className="px-4 py-3">Hora</th>
                      <th className="px-4 py-3">Cliente</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {ventas.map((v) => (
                      <tr key={v.id} className={v.estado === 'anulada' ? 'opacity-50' : ''}>
                        <td className="px-4 py-3 font-mono text-xs text-muted">{horaTexto(v.creado_en)}</td>
                        <td className="px-4 py-3 text-ink">{v.cliente?.nombre || 'Cliente sin registrar'}</td>
                        <td className="px-4 py-3 text-muted">{v.estado === 'anulada' ? 'Anulada' : 'Completada'}</td>
                        <td className="px-4 py-3 text-right font-mono text-ink">Gs. {Number(v.total).toLocaleString('es-PY')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div className="space-y-4">
            <div className="rounded-2xl bg-surface p-4 shadow-card">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
                <AlertTriangle size={13} /> Stock bajo
              </p>
              {stockBajo.length === 0 ? (
                <p className="mt-2 text-sm text-muted">Todo el stock está por encima del mínimo.</p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {stockBajo.slice(0, 6).map((p) => (
                    <Link
                      key={p.id}
                      to="/productos"
                      className="flex items-center justify-between rounded-lg bg-amber-soft px-2.5 py-2 text-xs font-medium text-amber"
                    >
                      <span className="truncate">{p.nombre}</span>
                      <span className="shrink-0 font-mono">
                        {p.stockTotal}/{p.stock_minimo}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              {stockBajo.length > 0 && (
                <Link to="/productos" className="mt-3 block text-center text-xs font-medium text-accent">
                  Ver en Productos →
                </Link>
              )}
            </div>

            <div className="rounded-2xl bg-surface p-4 shadow-card">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Necesita atención</p>
              {derivadas.length === 0 ? (
                <p className="mt-2 text-sm text-muted">Nada esperando respuesta ahora.</p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {derivadas.slice(0, 5).map((c) => (
                    <Link
                      key={c.id}
                      to="/conversaciones"
                      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium ${
                        c.prioridad === 'alta' ? 'bg-danger-soft text-danger' : 'bg-amber-soft text-amber'
                      }`}
                    >
                      <MessageCircle size={13} className="shrink-0" />
                      <span className="flex-1 truncate">{c.cliente?.nombre || 'Un cliente'} está esperando</span>
                    </Link>
                  ))}
                </div>
              )}
              {derivadas.length > 0 && (
                <Link to="/conversaciones" className="mt-3 block text-center text-xs font-medium text-accent">
                  Ver todas en Conversaciones →
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
