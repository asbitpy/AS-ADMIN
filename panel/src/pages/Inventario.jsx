import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useRealtimeTick } from '../lib/realtime';
import MetricPill from '../components/MetricPill';

// Pantalla nueva, solo de escritorio (ver feedback-asadmin-movil-congelado):
// 'movimientos_inventario' es la fuente de verdad del stock desde la
// migración 004 (nunca se toca 'stock' a mano sin dejar un registro acá)
// pero nunca tuvo una pantalla propia — el historial solo se podía
// reconstruir mirando Productos o entrando a cada Compra. Es de solo
// lectura a propósito: un ajuste manual de stock va por Productos o por
// una reposición, nunca por un insert directo a esta tabla.

const TIPO_LABEL = {
  entrada: 'Entrada',
  salida: 'Salida',
  ajuste: 'Ajuste',
  transferencia: 'Transferencia',
  venta: 'Venta',
  devolucion: 'Devolución',
};

const TIPO_TONO = {
  entrada: 'bg-accent-soft text-accent',
  salida: 'bg-danger-soft text-danger',
  ajuste: 'bg-amber-soft text-amber',
  transferencia: 'bg-surface2 text-muted',
  venta: 'bg-danger-soft text-danger',
  devolucion: 'bg-accent-soft text-accent',
};

const FILTROS_TIPO = [
  { id: 'todos', label: 'Todos' },
  { id: 'entrada', label: 'Entradas' },
  { id: 'salida', label: 'Salidas' },
  { id: 'venta', label: 'Ventas' },
  { id: 'ajuste', label: 'Ajustes' },
  { id: 'devolucion', label: 'Devoluciones' },
];

function fechaHoraTexto(fecha) {
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(fecha));
}

export default function Inventario() {
  const { negocio } = useAuth();
  const [movimientos, setMovimientos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [busqueda, setBusqueda] = useState('');
  const [nombresUsuarios, setNombresUsuarios] = useState({});

  const tick = useRealtimeTick('movimientos_inventario', negocio?.id);

  useEffect(() => {
    if (!negocio) return;
    cargar();
  }, [negocio, tick]);

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

  function nombreDe(authUserId) {
    if (!authUserId) return '—';
    if (authUserId === negocio.auth_user_id) return 'Vos';
    return nombresUsuarios[authUserId] || 'Ex-empleado';
  }

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from('movimientos_inventario')
      .select('*, producto:productos(nombre), variante:variantes_producto(atributo1_valor, atributo2_valor)')
      .eq('negocio_id', negocio.id)
      .order('creado_en', { ascending: false })
      .limit(300);
    setMovimientos(data || []);
    setCargando(false);
  }

  const filtrados = movimientos.filter((m) => {
    if (filtroTipo !== 'todos' && m.tipo !== filtroTipo) return false;
    if (!busqueda.trim()) return true;
    return (m.producto?.nombre || '').toLowerCase().includes(busqueda.toLowerCase());
  });

  const entradas = movimientos.filter((m) => m.cantidad > 0).reduce((acc, m) => acc + m.cantidad, 0);
  const salidas = movimientos.filter((m) => m.cantidad < 0).reduce((acc, m) => acc + Math.abs(m.cantidad), 0);

  return (
    <div className="space-y-4">
      <p className="font-display text-xl text-ink">Inventario</p>

      <div className="flex gap-3">
        <MetricPill label="Movimientos" value={movimientos.length} />
        <MetricPill label="Unidades ingresadas" value={entradas} tone="accent" />
        <MetricPill label="Unidades salidas" value={salidas} tone="danger" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 overflow-x-auto">
          {FILTROS_TIPO.map((f) => (
            <button
              key={f.id}
              onClick={() => setFiltroTipo(f.id)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${
                filtroTipo === f.id ? 'bg-accent text-accent-ink' : 'bg-surface2 text-muted'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            placeholder="Buscar producto…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="w-56 rounded-xl border border-line bg-surface py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>

      {cargando && <p className="pt-6 text-center text-sm text-muted">Cargando…</p>}

      {!cargando && filtrados.length === 0 && (
        <p className="pt-6 text-center text-sm text-muted">No hay movimientos que coincidan.</p>
      )}

      {filtrados.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Producto</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3 text-right">Cantidad</th>
                <th className="px-4 py-3">Motivo</th>
                <th className="px-4 py-3">Quién</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtrados.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-3 text-muted">{fechaHoraTexto(m.creado_en)}</td>
                  <td className="px-4 py-3 text-ink">
                    {m.producto?.nombre || 'Producto eliminado'}
                    {m.variante && (
                      <span className="ml-1 text-xs text-muted">
                        ({[m.variante.atributo1_valor, m.variante.atributo2_valor].filter(Boolean).join(' · ')})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TIPO_TONO[m.tipo] || 'bg-surface2 text-muted'}`}>
                      {TIPO_LABEL[m.tipo] || m.tipo}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-right font-mono ${m.cantidad > 0 ? 'text-accent' : 'text-danger'}`}>
                    {m.cantidad > 0 ? '+' : ''}
                    {m.cantidad}
                  </td>
                  <td className="px-4 py-3 text-muted">{m.motivo || '—'}</td>
                  <td className="px-4 py-3 text-muted">{nombreDe(m.usuario_id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
