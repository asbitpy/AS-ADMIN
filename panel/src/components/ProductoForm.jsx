import { useEffect, useRef, useState } from 'react';
import { Plus, X, Camera, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { subirFotoProducto } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import VarianteRow from './VarianteRow';

const VACIO = {
  nombre: '',
  categoria_id: '',
  marca: '',
  descripcion: '',
  costo: '',
  precio: '',
  precio_mayorista: '',
  impuesto_porcentaje: 10,
  sku: '',
  codigo_barras: '',
  stock: '',
  stock_minimo: '5',
  tiene_variantes: false,
};

export default function ProductoForm({ productoExistente, onGuardado, onCancelar }) {
  const { negocio } = useAuth();
  const [datos, setDatos] = useState(VACIO);
  const [categorias, setCategorias] = useState([]);
  const [nuevaCategoria, setNuevaCategoria] = useState('');
  const [variantesExistentes, setVariantesExistentes] = useState([]);
  const [variantesNuevas, setVariantesNuevas] = useState([]);
  const [foto, setFoto] = useState(null);
  const [fotoPreview, setFotoPreview] = useState(productoExistente?.foto_url || null);
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false);
  const [error, setError] = useState(null);
  // "disabled={guardando}" depende de que React vuelva a pintar la
  // pantalla, y entre un clic y el siguiente hay una ventana chica donde
  // el botón sigue habilitado. Un doble clic (o un toque impaciente
  // mientras la conexión tarda) puede entrar dos veces al mismo tiempo y
  // crear el producto duplicado. Este ref no depende del repintado: se
  // lee y se escribe en el mismo instante en que entra el clic.
  const enviandoRef = useRef(false);
  const eliminandoRef = useRef(false);

  const esEdicion = Boolean(productoExistente);

  useEffect(() => {
    cargarCategorias();
    if (productoExistente) {
      setDatos({
        nombre: productoExistente.nombre || '',
        categoria_id: productoExistente.categoria_id || '',
        marca: productoExistente.marca || '',
        descripcion: productoExistente.descripcion || '',
        costo: productoExistente.costo ?? '',
        precio: productoExistente.precio ?? '',
        precio_mayorista: productoExistente.precio_mayorista ?? '',
        impuesto_porcentaje: productoExistente.impuesto_porcentaje ?? 10,
        sku: productoExistente.sku || '',
        codigo_barras: productoExistente.codigo_barras || '',
        stock: productoExistente.stock ?? '',
        stock_minimo: productoExistente.stock_minimo ?? '5',
        tiene_variantes: productoExistente.tiene_variantes || false,
      });
      cargarVariantes(productoExistente.id);
    }
  }, [productoExistente]);

  async function cargarCategorias() {
    const { data } = await supabase
      .from('categorias')
      .select('*')
      .eq('negocio_id', negocio.id)
      .order('nombre');
    setCategorias(data || []);
  }

  async function cargarVariantes(productoId) {
    const { data } = await supabase
      .from('variantes_producto')
      .select('*')
      .eq('producto_id', productoId)
      .eq('activo', true)
      .order('atributo1_valor');
    setVariantesExistentes(data || []);
  }

  function agregarFilaVariante() {
    setVariantesNuevas([...variantesNuevas, { talle: '', color: '', stock: '' }]);
  }

  function quitarFilaVariante(i) {
    setVariantesNuevas(variantesNuevas.filter((_, idx) => idx !== i));
  }

  async function crearCategoria() {
    if (!nuevaCategoria.trim()) return;
    const { data, error } = await supabase
      .from('categorias')
      .insert({ negocio_id: negocio.id, nombre: nuevaCategoria.trim() })
      .select()
      .single();
    if (!error) {
      setCategorias([...categorias, data]);
      setDatos({ ...datos, categoria_id: data.id });
      setNuevaCategoria('');
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (enviandoRef.current) return; // ya se está guardando: ignora el segundo clic
    setError(null);

    if (!datos.nombre.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    if (!datos.precio) {
      setError('El precio de venta es obligatorio.');
      return;
    }
    if (datos.tiene_variantes && !esEdicion && variantesNuevas.length === 0) {
      setError('Agregá al menos una variante (talle/color) o desmarcá "tiene variantes".');
      return;
    }

    enviandoRef.current = true;
    setGuardando(true);
    try {
      const payload = {
        negocio_id: negocio.id,
        nombre: datos.nombre.trim(),
        categoria_id: datos.categoria_id || null,
        marca: datos.marca || null,
        descripcion: datos.descripcion || null,
        costo: datos.costo ? Number(datos.costo) : null,
        precio: Number(datos.precio),
        precio_mayorista: datos.precio_mayorista ? Number(datos.precio_mayorista) : null,
        impuesto_porcentaje: Number(datos.impuesto_porcentaje) || 0,
        sku: datos.tiene_variantes ? null : datos.sku || null,
        codigo_barras: datos.tiene_variantes ? null : datos.codigo_barras || null,
        stock: datos.tiene_variantes ? 0 : Number(datos.stock) || 0,
        stock_minimo: Number(datos.stock_minimo) || 0,
        tiene_variantes: datos.tiene_variantes,
        activo: true,
      };

      let productoId = productoExistente?.id;

      if (esEdicion) {
        const { error: errUpdate } = await supabase.from('productos').update(payload).eq('id', productoId);
        if (errUpdate) throw errUpdate;
      } else {
        const { data: nuevo, error: errInsert } = await supabase
          .from('productos')
          .insert(payload)
          .select()
          .single();
        if (errInsert) throw errInsert;
        productoId = nuevo.id;
      }

      // Foto (opcional)
      if (foto) {
        const url = await subirFotoProducto({ negocioId: negocio.id, productoId, file: foto });
        await supabase.from('productos').update({ foto_url: url }).eq('id', productoId);
      }

      // Variantes existentes: solo actualizamos el stock que hayan tocado
      for (const v of variantesExistentes) {
        await supabase.from('variantes_producto').update({ stock: Number(v.stock) || 0 }).eq('id', v.id);
      }

      // Variantes nuevas
      if (datos.tiene_variantes && variantesNuevas.length > 0) {
        const filas = variantesNuevas
          .filter((v) => v.talle || v.color)
          .map((v) => ({
            producto_id: productoId,
            negocio_id: negocio.id,
            atributo1_nombre: 'Talle',
            atributo1_valor: v.talle || null,
            atributo2_nombre: 'Color',
            atributo2_valor: v.color || null,
            stock: Number(v.stock) || 0,
          }));
        if (filas.length) {
          const { error: errVar } = await supabase.from('variantes_producto').insert(filas);
          if (errVar) throw errVar;
        }
      }

      onGuardado();
    } catch (err) {
      console.error(err);
      setError('No se pudo guardar. Probá de nuevo en un momento.');
    } finally {
      enviandoRef.current = false;
      setGuardando(false);
    }
  }

  async function eliminarProducto() {
    if (!productoExistente || eliminandoRef.current) return;
    eliminandoRef.current = true;
    setEliminando(true);
    const { error: errDelete } = await supabase
      .from('productos')
      .update({ activo: false })
      .eq('id', productoExistente.id);
    eliminandoRef.current = false;
    setEliminando(false);
    if (errDelete) {
      setError('No se pudo eliminar. Probá de nuevo en un momento.');
      return;
    }
    onGuardado();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-ink">
          {esEdicion ? 'Editar producto' : 'Nuevo producto'}
        </h2>
        <button type="button" onClick={onCancelar} className="rounded-full p-1.5 text-muted">
          <X size={20} />
        </button>
      </div>

      {/* Foto */}
      <label className="flex h-32 w-32 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border border-dashed border-line bg-surface">
        {fotoPreview ? (
          <img src={fotoPreview} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-muted">
            <Camera size={22} />
            <span className="text-xs">Agregar foto</span>
          </span>
        )}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setFoto(f);
              setFotoPreview(URL.createObjectURL(f));
            }
          }}
        />
      </label>

      <input
        placeholder="Nombre del producto"
        value={datos.nombre}
        onChange={(e) => setDatos({ ...datos, nombre: e.target.value })}
        className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
      />

      {/* Categoría */}
      <div className="flex gap-2">
        <select
          value={datos.categoria_id}
          onChange={(e) => setDatos({ ...datos, categoria_id: e.target.value })}
          className="flex-1 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">Sin categoría</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <input
          placeholder="Nueva categoría"
          value={nuevaCategoria}
          onChange={(e) => setNuevaCategoria(e.target.value)}
          className="flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="button"
          onClick={crearCategoria}
          className="rounded-xl bg-accent-soft px-3 text-xs font-medium text-accent"
        >
          Crear
        </button>
      </div>

      <input
        placeholder="Marca (opcional)"
        value={datos.marca}
        onChange={(e) => setDatos({ ...datos, marca: e.target.value })}
        className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
      />

      <textarea
        placeholder="Descripción (opcional)"
        value={datos.descripcion}
        onChange={(e) => setDatos({ ...datos, descripcion: e.target.value })}
        rows={2}
        className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
      />

      {/* Precios */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted">Costo (Gs.)</label>
          <input
            type="number"
            value={datos.costo}
            onChange={(e) => setDatos({ ...datos, costo: e.target.value })}
            className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div>
          <label className="text-xs text-muted">Precio de venta (Gs.)*</label>
          <input
            type="number"
            value={datos.precio}
            onChange={(e) => setDatos({ ...datos, precio: e.target.value })}
            className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div>
          <label className="text-xs text-muted">Precio mayorista (opcional)</label>
          <input
            type="number"
            value={datos.precio_mayorista}
            onChange={(e) => setDatos({ ...datos, precio_mayorista: e.target.value })}
            className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <div>
          <label className="text-xs text-muted">IVA %</label>
          <input
            type="number"
            value={datos.impuesto_porcentaje}
            onChange={(e) => setDatos({ ...datos, impuesto_porcentaje: e.target.value })}
            className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      </div>

      {/* Toggle variantes */}
      <label className="flex items-center justify-between rounded-xl bg-surface px-4 py-3 shadow-card">
        <span className="text-sm text-ink">Tiene variantes (talle / color)</span>
        <input
          type="checkbox"
          checked={datos.tiene_variantes}
          disabled={esEdicion} // no se cambia una vez creado, para no romper el stock ya cargado
          onChange={(e) => setDatos({ ...datos, tiene_variantes: e.target.checked })}
          className="h-5 w-5 accent-accent"
        />
      </label>

      {!datos.tiene_variantes && (
        <div className="grid grid-cols-3 gap-2">
          <input
            placeholder="SKU"
            value={datos.sku}
            onChange={(e) => setDatos({ ...datos, sku: e.target.value })}
            className="rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <input
            placeholder="Cód. barras"
            value={datos.codigo_barras}
            onChange={(e) => setDatos({ ...datos, codigo_barras: e.target.value })}
            className="rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <input
            type="number"
            placeholder="Stock"
            value={datos.stock}
            onChange={(e) => setDatos({ ...datos, stock: e.target.value })}
            className="rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      )}

      <div>
        <label className="text-xs text-muted">Stock mínimo (para avisarte cuando esté bajo)</label>
        <input
          type="number"
          value={datos.stock_minimo}
          onChange={(e) => setDatos({ ...datos, stock_minimo: e.target.value })}
          className="mt-1 w-24 rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {/* Variantes */}
      {datos.tiene_variantes && (
        <div className="space-y-2 rounded-xl bg-surface p-3 shadow-card">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Variantes</p>

          {variantesExistentes.map((v) => (
            <VarianteRow
              key={v.id}
              variante={v}
              soloStock
              onChange={(nueva) =>
                setVariantesExistentes(variantesExistentes.map((x) => (x.id === v.id ? nueva : x)))
              }
              onQuitar={async () => {
                await supabase.from('variantes_producto').update({ activo: false }).eq('id', v.id);
                setVariantesExistentes(variantesExistentes.filter((x) => x.id !== v.id));
              }}
            />
          ))}

          {variantesNuevas.map((v, i) => (
            <VarianteRow
              key={i}
              variante={v}
              onChange={(nueva) => setVariantesNuevas(variantesNuevas.map((x, idx) => (idx === i ? nueva : x)))}
              onQuitar={() => quitarFilaVariante(i)}
            />
          ))}

          <button
            type="button"
            onClick={agregarFilaVariante}
            className="flex w-full items-center justify-center gap-1 rounded-lg bg-accent-soft py-2 text-xs font-medium text-accent"
          >
            <Plus size={14} /> Agregar talle/color
          </button>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={guardando}
        className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink active:scale-[0.98] disabled:opacity-60"
      >
        {guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Agregar producto'}
      </button>

      {esEdicion && !confirmandoEliminar && (
        <button
          type="button"
          onClick={() => setConfirmandoEliminar(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-danger/30 py-3 text-sm font-medium text-danger"
        >
          <Trash2 size={16} /> Eliminar producto
        </button>
      )}

      {/* Confirmación propia, no window.confirm(): el diálogo nativo del
          navegador se puede quedar mudo (Chrome ofrece "no volver a
          preguntar en esta página" después de un par de confirmaciones,
          y si alguna vez se tocó por error, el botón parece "no hacer
          nada" para siempre). Esto no depende del navegador. */}
      {confirmandoEliminar && (
        <div className="space-y-2 rounded-xl bg-danger-soft p-3">
          <p className="text-xs text-danger">
            ¿Eliminar "{productoExistente?.nombre}"? El historial de ventas ya hechas con este producto
            no se borra — solo deja de aparecer en el catálogo.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmandoEliminar(false)}
              disabled={eliminando}
              className="flex-1 rounded-lg border border-line bg-surface py-2 text-xs font-medium text-ink disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={eliminarProducto}
              disabled={eliminando}
              className="flex-1 rounded-lg bg-danger py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              {eliminando ? 'Eliminando…' : 'Sí, eliminar'}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
