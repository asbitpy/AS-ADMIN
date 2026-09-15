import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search, Trash2, Check, Ban, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

// Pantalla nueva de escritorio (ver feedback-asadmin-movil-congelado):
// 'ordenes_compra'/'orden_compra_items' existen desde la migración 004
// pero nunca tuvieron pantalla. El ciclo de vida sigue el enum
// orden_compra_estado tal cual está en la base — no se inventa nada:
// borrador → enviada → recibida (sube el stock solo, vía
// fn_recibir_orden_compra) — o cancelada, desde borrador o enviada.
const ESTADO_LABEL = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  recibida: 'Recibida',
  cancelada: 'Cancelada',
};

const ESTADO_TONO = {
  borrador: 'bg-surface2 text-muted',
  enviada: 'bg-amber-soft text-amber',
  recibida: 'bg-accent-soft text-accent',
  cancelada: 'bg-danger-soft text-danger',
};

function fechaTexto(fecha) {
  return new Intl.DateTimeFormat('es-PY', { timeZone: 'America/Asuncion', day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    new Date(fecha)
  );
}

export default function Compras() {
  const { negocio } = useAuth();
  const [ordenes, setOrdenes] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [vistaForm, setVistaForm] = useState(false);
  const [ordenAbierta, setOrdenAbierta] = useState(null);

  useEffect(() => {
    if (!negocio) return;
    cargar();
    cargarProveedores();
  }, [negocio]);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from('ordenes_compra')
      .select('*, proveedor:proveedores(nombre)')
      .eq('negocio_id', negocio.id)
      .order('creado_en', { ascending: false })
      .limit(200);
    setOrdenes(data || []);
    setCargando(false);
  }

  async function cargarProveedores() {
    const { data } = await supabase
      .from('proveedores')
      .select('id, nombre')
      .eq('negocio_id', negocio.id)
      .eq('activo', true)
      .order('nombre');
    setProveedores(data || []);
  }

  async function abrirDetalle(orden) {
    setOrdenAbierta({ orden, items: null });
    const { data: items } = await supabase
      .from('orden_compra_items')
      .select('*, producto:productos(nombre), variante:variantes_producto(atributo1_valor, atributo2_valor)')
      .eq('orden_compra_id', orden.id);
    setOrdenAbierta({ orden, items: items || [] });
  }

  async function cambiarEstado(orden, nuevoEstado) {
    if (nuevoEstado === 'recibida') {
      const { error } = await supabase.rpc('fn_recibir_orden_compra', { p_orden_id: orden.id });
      if (error) {
        alert('No se pudo marcar como recibida: ' + error.message);
        return;
      }
    } else {
      await supabase.from('ordenes_compra').update({ estado: nuevoEstado }).eq('id', orden.id);
    }
    setOrdenAbierta(null);
    cargar();
  }

  if (ordenAbierta) {
    return (
      <DetalleOrden
        orden={ordenAbierta.orden}
        items={ordenAbierta.items}
        onVolver={() => setOrdenAbierta(null)}
        onCambiarEstado={cambiarEstado}
      />
    );
  }

  if (vistaForm) {
    return (
      <NuevaOrden
        negocio={negocio}
        proveedores={proveedores}
        onVolver={() => setVistaForm(false)}
        onCreada={() => {
          setVistaForm(false);
          cargar();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-display text-xl text-ink">Compras</p>
        <button
          onClick={() => setVistaForm(true)}
          disabled={proveedores.length === 0}
          className="flex items-center gap-1 rounded-full bg-brand px-3 py-2 text-xs font-medium text-ink active:scale-[0.98] disabled:opacity-50"
        >
          <Plus size={16} /> Nueva orden
        </button>
      </div>

      {proveedores.length === 0 && !cargando && (
        <p className="rounded-xl bg-amber-soft p-3 text-xs text-amber">
          Todavía no tenés ningún proveedor activo — cargá uno primero en Proveedores para poder armar una orden.
        </p>
      )}

      {cargando && <p className="pt-4 text-center text-sm text-muted">Cargando…</p>}

      {!cargando && ordenes.length === 0 && (
        <p className="pt-4 text-center text-sm text-muted">Todavía no armaste ninguna orden de compra.</p>
      )}

      {ordenes.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Proveedor</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ordenes.map((o) => (
                <tr key={o.id} onClick={() => abrirDetalle(o)} className="cursor-pointer hover:bg-surface2">
                  <td className="px-4 py-3 text-muted">{fechaTexto(o.fecha)}</td>
                  <td className="px-4 py-3 text-ink">{o.proveedor?.nombre || 'Proveedor eliminado'}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_TONO[o.estado]}`}>
                      {ESTADO_LABEL[o.estado]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-ink">Gs. {Number(o.total).toLocaleString('es-PY')}</td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight size={14} className="text-muted" />
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

function DetalleOrden({ orden, items, onVolver, onCambiarEstado }) {
  return (
    <div className="space-y-4">
      <button onClick={onVolver} className="flex items-center gap-1 text-sm text-muted">
        <ChevronLeft size={16} /> Volver a compras
      </button>

      <div className="rounded-2xl bg-surface p-4 shadow-card">
        <div className="flex items-center justify-between">
          <p className="font-display text-lg text-ink">{orden.proveedor?.nombre || 'Proveedor eliminado'}</p>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ESTADO_TONO[orden.estado]}`}>
            {ESTADO_LABEL[orden.estado]}
          </span>
        </div>
        <p className="text-xs text-muted">{fechaTexto(orden.fecha)}</p>
        {orden.estado === 'recibida' && orden.recibida_en && (
          <p className="mt-1 text-xs text-accent">Recibida el {fechaTexto(orden.recibida_en)} — el stock ya se sumó solo.</p>
        )}

        <div className="mt-3 space-y-1.5 border-t border-line pt-3">
          {items === null && <p className="text-sm text-muted">Cargando…</p>}
          {items?.map((it) => (
            <div key={it.id} className="flex items-center justify-between text-sm">
              <div>
                <p className="text-ink">{it.producto?.nombre || 'Producto eliminado'}</p>
                {it.variante && (
                  <p className="text-xs text-muted">
                    {[it.variante.atributo1_valor, it.variante.atributo2_valor].filter(Boolean).join(' · ')}
                  </p>
                )}
                <p className="text-xs text-muted">
                  {it.cantidad} x Gs. {Number(it.costo_unitario).toLocaleString('es-PY')}
                </p>
              </div>
              <p className="font-mono text-ink">Gs. {(it.cantidad * it.costo_unitario).toLocaleString('es-PY')}</p>
            </div>
          ))}
        </div>

        <div className="mt-3 flex justify-between border-t border-line pt-3 text-sm font-medium text-ink">
          <span>Total</span>
          <span className="font-mono">Gs. {Number(orden.total).toLocaleString('es-PY')}</span>
        </div>
      </div>

      {orden.estado === 'borrador' && (
        <button
          onClick={() => onCambiarEstado(orden, 'enviada')}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink"
        >
          <Send size={16} /> Marcar como enviada al proveedor
        </button>
      )}

      {orden.estado === 'enviada' && (
        <button
          onClick={() => onCambiarEstado(orden, 'recibida')}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink"
        >
          <Check size={16} /> Marcar como recibida (sube el stock)
        </button>
      )}

      {(orden.estado === 'borrador' || orden.estado === 'enviada') && (
        <button
          onClick={() => onCambiarEstado(orden, 'cancelada')}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-danger/30 py-3 text-sm font-medium text-danger"
        >
          <Ban size={16} /> Cancelar orden
        </button>
      )}
    </div>
  );
}

function NuevaOrden({ negocio, proveedores, onVolver, onCreada }) {
  const [proveedorId, setProveedorId] = useState(proveedores[0]?.id || '');
  const [productos, setProductos] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [items, setItems] = useState([]); // { clave, producto_id, variante_id, nombre, costo_unitario, cantidad }
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    cargarProductos();
  }, []);

  async function cargarProductos() {
    const { data } = await supabase
      .from('productos')
      .select('id, nombre, costo, tiene_variantes, variantes_producto(*)')
      .eq('negocio_id', negocio.id)
      .eq('activo', true);
    setProductos(data || []);
  }

  const resultados = useMemo(() => {
    if (!busqueda.trim()) return [];
    const q = busqueda.toLowerCase();
    return productos.filter((p) => p.nombre.toLowerCase().includes(q)).slice(0, 8);
  }, [busqueda, productos]);

  function agregarItem(producto, variante = null) {
    const clave = variante ? variante.id : producto.id;
    if (items.some((i) => i.clave === clave)) return; // ya está en la lista
    setItems((prev) => [
      ...prev,
      {
        clave,
        producto_id: producto.id,
        variante_id: variante?.id || null,
        nombre: producto.nombre + (variante ? ` · ${[variante.atributo1_valor, variante.atributo2_valor].filter(Boolean).join(' · ')}` : ''),
        costo_unitario: Number(producto.costo) || 0,
        cantidad: 1,
      },
    ]);
    setBusqueda('');
  }

  function actualizarItem(clave, campo, valor) {
    setItems((prev) => prev.map((i) => (i.clave === clave ? { ...i, [campo]: valor } : i)));
  }

  function quitarItem(clave) {
    setItems((prev) => prev.filter((i) => i.clave !== clave));
  }

  const total = items.reduce((acc, i) => acc + (Number(i.cantidad) || 0) * (Number(i.costo_unitario) || 0), 0);

  async function guardar() {
    if (!proveedorId) {
      setError('Elegí un proveedor.');
      return;
    }
    if (items.length === 0) {
      setError('Agregá al menos un producto.');
      return;
    }
    setGuardando(true);
    setError(null);

    const { data: orden, error: errOrden } = await supabase
      .from('ordenes_compra')
      .insert({ negocio_id: negocio.id, proveedor_id: proveedorId, estado: 'borrador', total })
      .select('id')
      .single();

    if (errOrden) {
      setGuardando(false);
      setError('No se pudo crear la orden. Probá de nuevo.');
      return;
    }

    const { error: errItems } = await supabase.from('orden_compra_items').insert(
      items.map((i) => ({
        orden_compra_id: orden.id,
        producto_id: i.producto_id,
        variante_id: i.variante_id,
        cantidad: Number(i.cantidad) || 1,
        costo_unitario: Number(i.costo_unitario) || 0,
      }))
    );

    setGuardando(false);
    if (errItems) {
      setError('La orden se creó, pero hubo un problema guardando los ítems. Revisala en la lista.');
      return;
    }
    onCreada();
  }

  return (
    <div className="space-y-4">
      <button onClick={onVolver} className="flex items-center gap-1 text-sm text-muted">
        <ChevronLeft size={16} /> Volver a compras
      </button>
      <p className="font-display text-xl text-ink">Nueva orden de compra</p>

      <select
        value={proveedorId}
        onChange={(e) => setProveedorId(e.target.value)}
        className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
      >
        {proveedores.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </select>

      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          placeholder="Buscar producto para agregar…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {resultados.length > 0 && (
        <div className="space-y-1.5 rounded-xl bg-surface p-2 shadow-card">
          {resultados.map((p) => (
            <button
              key={p.id}
              onClick={() => (p.tiene_variantes ? null : agregarItem(p))}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left active:bg-base"
            >
              <span className="text-sm text-ink">{p.nombre}</span>
              {p.tiene_variantes ? (
                <span className="flex flex-wrap justify-end gap-1">
                  {(p.variantes_producto || [])
                    .filter((v) => v.activo)
                    .map((v) => (
                      <span
                        key={v.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          agregarItem(p, v);
                        }}
                        className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent"
                      >
                        {[v.atributo1_valor, v.atributo2_valor].filter(Boolean).join(' · ')}
                      </span>
                    ))}
                </span>
              ) : (
                <span className="font-mono text-xs text-muted">Costo Gs. {Number(p.costo).toLocaleString('es-PY')}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <p className="pt-6 text-center text-sm text-muted">Buscá productos para agregar a la orden.</p>
      ) : (
        <div className="space-y-2">
          {items.map((i) => (
            <div key={i.clave} className="flex items-center gap-2 rounded-xl bg-surface p-3 shadow-card">
              <p className="min-w-0 flex-1 truncate text-sm text-ink">{i.nombre}</p>
              <input
                type="number"
                value={i.cantidad}
                onChange={(e) => actualizarItem(i.clave, 'cantidad', e.target.value)}
                onWheel={(e) => e.currentTarget.blur()}
                className="w-16 rounded-lg border border-line bg-base px-2 py-1.5 text-right text-xs outline-none focus:ring-2 focus:ring-accent"
              />
              <span className="text-xs text-muted">x</span>
              <input
                type="number"
                value={i.costo_unitario}
                onChange={(e) => actualizarItem(i.clave, 'costo_unitario', e.target.value)}
                onWheel={(e) => e.currentTarget.blur()}
                className="w-24 rounded-lg border border-line bg-base px-2 py-1.5 text-right text-xs outline-none focus:ring-2 focus:ring-accent"
              />
              <button onClick={() => quitarItem(i.clave)} className="shrink-0 text-muted active:text-danger">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center justify-between rounded-2xl bg-surface p-4 shadow-card">
        <div>
          <p className="text-xs text-muted">Total</p>
          <p className="font-display text-2xl font-semibold text-ink">Gs. {total.toLocaleString('es-PY')}</p>
        </div>
        <button
          onClick={guardar}
          disabled={guardando}
          className="rounded-xl bg-brand px-6 py-3 text-sm font-medium text-ink disabled:opacity-60"
        >
          {guardando ? 'Guardando…' : 'Crear orden'}
        </button>
      </div>
    </div>
  );
}
