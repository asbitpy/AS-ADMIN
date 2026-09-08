import { useEffect, useState } from 'react';
import { Plus, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import ProductoCard from '../components/ProductoCard';
import ProductoForm from '../components/ProductoForm';

export default function Productos() {
  const { negocio } = useAuth();
  const [productos, setProductos] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState('lista'); // 'lista' | 'form'
  const [productoEditando, setProductoEditando] = useState(null);

  useEffect(() => {
    if (!negocio) return;
    cargar();
  }, [negocio]);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from('productos')
      .select('*, variantes_producto(stock, activo)')
      .eq('negocio_id', negocio.id)
      .eq('activo', true)
      .order('nombre');

    const conStockTotal = (data || []).map((p) => {
      const variantesActivas = (p.variantes_producto || []).filter((v) => v.activo);
      const stock_total = p.tiene_variantes
        ? variantesActivas.reduce((acc, v) => acc + v.stock, 0)
        : p.stock;
      return { ...p, stock_total, variantes_count: variantesActivas.length };
    });

    setProductos(conStockTotal);
    setCargando(false);
  }

  const filtrados = productos.filter((p) => p.nombre.toLowerCase().includes(busqueda.toLowerCase()));
  const conStockBajo = productos.filter((p) => p.stock_total <= p.stock_minimo);

  if (vista === 'form') {
    return (
      <ProductoForm
        productoExistente={productoEditando}
        onCancelar={() => setVista('lista')}
        onGuardado={() => {
          setVista('lista');
          cargar();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-display text-xl text-ink">Productos</p>
        <button
          onClick={() => {
            setProductoEditando(null);
            setVista('form');
          }}
          className="flex items-center gap-1 rounded-full bg-accent px-3 py-2 text-xs font-medium text-white active:scale-[0.98]"
        >
          <Plus size={16} /> Agregar
        </button>
      </div>

      {conStockBajo.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-soft px-3 py-2 text-xs text-amber">
          <AlertTriangle size={16} />
          {conStockBajo.length === 1
            ? '1 producto está por debajo del stock mínimo.'
            : `${conStockBajo.length} productos están por debajo del stock mínimo.`}
        </div>
      )}

      <input
        placeholder="Buscar producto…"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
      />

      {cargando && <p className="pt-6 text-center text-sm text-muted">Cargando…</p>}

      {!cargando && filtrados.length === 0 && (
        <p className="pt-6 text-center text-sm text-muted">
          {busqueda ? 'No encontré productos con ese nombre.' : 'Todavía no cargaste ningún producto.'}
        </p>
      )}

      <div className="space-y-2">
        {filtrados.map((p) => (
          <ProductoCard
            key={p.id}
            producto={p}
            onClick={() => {
              setProductoEditando(p);
              setVista('form');
            }}
          />
        ))}
      </div>
    </div>
  );
}
