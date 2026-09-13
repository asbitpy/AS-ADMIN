import { useEffect, useState } from 'react';
import { Receipt } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useRealtimeTick } from '../lib/realtime';
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

    const bajo = (productosRes.data || []).filter((p) => {
      const stockTotal = p.tiene_variantes
        ? (p.variantes_producto || []).filter((v) => v.activo).reduce((a, v) => a + v.stock, 0)
        : p.stock;
      return stockTotal <= p.stock_minimo;
    });
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

      <CajaBar negocioId={negocio.id} />

      <div className="flex gap-3">
        <MetricPill label="Ventas hoy" value={completadas.length} />
        <MetricPill label="Vendido hoy" value={formatoGsCompacto(totalHoy)} tone="accent" compact />
      </div>

      {cargando ? (
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
      )}
    </div>
  );
}
