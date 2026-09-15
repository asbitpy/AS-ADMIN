import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { Plus, AlertTriangle, Upload, Download, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useRealtimeTick } from '../lib/realtime';
import { useEsEscritorio } from '../hooks/useEsEscritorio';
import ProductoCard from '../components/ProductoCard';
import ProductoForm from '../components/ProductoForm';
import ImportarProductos from '../components/ImportarProductos';
import MetricPill from '../components/MetricPill';

// "Gs. 41.685.000" no entra en un tercio de pantalla ni achicando la
// letra — a partir del millón se abrevia, que es además como se habla
// la plata en Paraguay ("41 millones y medio", no "cuarenta y un mil...").
function formatoGsCompacto(monto) {
  const n = Number(monto);
  if (n >= 1_000_000) {
    return `Gs. ${(n / 1_000_000).toLocaleString('es-PY', { maximumFractionDigits: 1 })} M`;
  }
  return `Gs. ${n.toLocaleString('es-PY')}`;
}

export default function Productos() {
  const { negocio } = useAuth();
  const { esEscritorio } = useEsEscritorio();
  const [productos, setProductos] = useState([]);
  const [exportando, setExportando] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState('lista'); // 'lista' | 'form' | 'importar'
  const [productoEditando, setProductoEditando] = useState(null);
  const [avisoFoto, setAvisoFoto] = useState(null);

  const tickProductos = useRealtimeTick('productos', negocio?.id);
  const tickVariantes = useRealtimeTick('variantes_producto', negocio?.id);

  useEffect(() => {
    if (!negocio) return;
    cargar();
  }, [negocio, tickProductos, tickVariantes]);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from('productos')
      .select('*, variantes_producto(stock, activo, precio_override)')
      .eq('negocio_id', negocio.id)
      .eq('activo', true)
      .order('nombre');

    const conStockTotal = (data || []).map((p) => {
      const variantesActivas = (p.variantes_producto || []).filter((v) => v.activo);
      const stock_total = p.tiene_variantes
        ? variantesActivas.reduce((acc, v) => acc + v.stock, 0)
        : p.stock;
      // Valor de lo que hay en estante, al precio de venta de cada variante
      // (o del producto si no tiene variantes) — no es ganancia, es cuánto
      // representa el stock parado si se vendiera todo hoy.
      const valor_en_stock = p.tiene_variantes
        ? variantesActivas.reduce((acc, v) => acc + v.stock * Number(v.precio_override ?? p.precio), 0)
        : p.stock * Number(p.precio);
      return { ...p, stock_total, variantes_count: variantesActivas.length, valor_en_stock };
    });

    setProductos(conStockTotal);
    setCargando(false);
  }

  // Excel de verdad (no CSV) con el mismo formato de columnas que
  // Importar — así se puede exportar, editar en Excel y volver a
  // importar sin transformar nada. Trae categoría/proveedor por nombre
  // (no el id) y una fila por variante, igual que espera Importar.
  async function exportarXLSX() {
    setExportando(true);
    try {
      const { data } = await supabase
        .from('productos')
        .select(
          '*, categoria:categorias(nombre), proveedor:proveedores(nombre), variantes_producto(atributo1_valor, atributo2_valor, sku, codigo_barras, stock, precio_override, activo)'
        )
        .eq('negocio_id', negocio.id)
        .eq('activo', true)
        .order('nombre');

      const filas = [];
      for (const p of data || []) {
        const base = {
          nombre: p.nombre,
          precio: p.precio,
          costo: p.costo || '',
          stock_minimo: p.stock_minimo || 0,
          categoria: p.categoria?.nombre || '',
          proveedor: p.proveedor?.nombre || '',
          marca: p.marca || '',
          descripcion: p.descripcion || '',
        };
        const variantesActivas = (p.variantes_producto || []).filter((v) => v.activo);
        if (p.tiene_variantes && variantesActivas.length > 0) {
          for (const v of variantesActivas) {
            filas.push({
              ...base,
              stock: v.stock,
              sku: v.sku || '',
              codigo_barras: v.codigo_barras || '',
              talle: v.atributo1_valor || '',
              color: v.atributo2_valor || '',
              precio_override: v.precio_override || '',
            });
          }
        } else {
          filas.push({ ...base, stock: p.stock, sku: p.sku || '', codigo_barras: p.codigo_barras || '', talle: '', color: '', precio_override: '' });
        }
      }

      const hoja = XLSX.utils.json_to_sheet(filas, {
        header: ['nombre', 'precio', 'costo', 'stock', 'stock_minimo', 'categoria', 'proveedor', 'sku', 'codigo_barras', 'marca', 'talle', 'color', 'precio_override', 'descripcion'],
      });
      const libro = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(libro, hoja, 'Productos');
      XLSX.writeFile(libro, `productos_${negocio.nombre.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExportando(false);
    }
  }

  const filtrados = productos.filter((p) => p.nombre.toLowerCase().includes(busqueda.toLowerCase()));
  const conStockBajo = productos.filter((p) => p.stock_total <= p.stock_minimo);
  const valorTotalInventario = productos.reduce((acc, p) => acc + p.valor_en_stock, 0);
  const unidadesTotales = productos.reduce((acc, p) => acc + p.stock_total, 0);

  if (vista === 'form') {
    return (
      <ProductoForm
        productoExistente={productoEditando}
        onCancelar={() => setVista('lista')}
        onGuardado={(aviso) => {
          setVista('lista');
          setAvisoFoto(aviso || null);
          cargar();
        }}
      />
    );
  }

  if (vista === 'importar') {
    return (
      <ImportarProductos
        onCancelar={() => setVista('lista')}
        onImportado={() => {
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
        <div className="flex gap-2">
          {esEscritorio && (
            <button
              onClick={exportarXLSX}
              disabled={exportando || productos.length === 0}
              className="flex items-center gap-1 rounded-full bg-accent-soft px-3 py-2 text-xs font-medium text-accent active:scale-[0.98] disabled:opacity-50"
            >
              <Download size={16} /> {exportando ? 'Exportando…' : 'Exportar'}
            </button>
          )}
          <button
            onClick={() => setVista('importar')}
            className="flex items-center gap-1 rounded-full bg-accent-soft px-3 py-2 text-xs font-medium text-accent active:scale-[0.98]"
          >
            <Upload size={16} /> Importar
          </button>
          <button
            onClick={() => {
              setProductoEditando(null);
              setVista('form');
            }}
            className="flex items-center gap-1 rounded-full bg-brand px-3 py-2 text-xs font-medium text-ink active:scale-[0.98]"
          >
            <Plus size={16} /> Agregar
          </button>
        </div>
      </div>

      {!cargando && productos.length > 0 && (
        <div className="flex gap-3">
          <MetricPill label="Productos" value={productos.length} />
          <MetricPill label="Unidades en stock" value={unidadesTotales} />
          <MetricPill
            label="Valor en estante"
            value={formatoGsCompacto(valorTotalInventario)}
            tone="accent"
            compact
          />
        </div>
      )}

      {avisoFoto && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-soft px-3 py-2 text-xs text-amber">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p className="flex-1">{avisoFoto}</p>
          <button onClick={() => setAvisoFoto(null)} className="shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

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
