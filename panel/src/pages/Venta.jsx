import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ShoppingCart, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import CarritoItem from '../components/CarritoItem';
import SelectorVariante from '../components/SelectorVariante';
import CajaBar from '../components/CajaBar';

const METODOS = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'tarjeta', label: 'Tarjeta' },
  { id: 'qr', label: 'QR' },
];

export default function Venta() {
  const { negocio } = useAuth();
  const [productos, setProductos] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [indiceSeleccionado, setIndiceSeleccionado] = useState(0);
  const [carrito, setCarrito] = useState([]);
  const [cajaSesionId, setCajaSesionId] = useState(null);
  const [productoParaVariante, setProductoParaVariante] = useState(null);
  const [telefonoCliente, setTelefonoCliente] = useState('');
  const [metodoPago, setMetodoPago] = useState('efectivo');
  const [cobrando, setCobrando] = useState(false);
  const [ventaConfirmada, setVentaConfirmada] = useState(null);
  const [error, setError] = useState(null);

  const searchRef = useRef(null);
  const telefonoRef = useRef(null);
  // Mismo motivo que ProductoForm: el estado 'cobrando' no alcanza a
  // desactivar el botón antes de que un segundo clic (o un F2 repetido)
  // entre — acá el costo de ese descuido es cobrar dos veces la misma
  // venta y descontar el doble de stock. Este ref corta en seco, sin
  // esperar al repintado.
  const cobrandoRef = useRef(false);

  useEffect(() => {
    if (!negocio) return;
    cargarProductos();
  }, [negocio]);

  // El campo de búsqueda arranca con el foco: el lector de código de
  // barras es, para el sistema, un teclado escribiendo muy rápido — si
  // el foco no está acá, escanear no hace nada.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  async function cargarProductos() {
    const { data } = await supabase
      .from('productos')
      .select('*, variantes_producto(*)')
      .eq('negocio_id', negocio.id)
      .eq('activo', true);
    setProductos(data || []);
  }

  const resultados = useMemo(() => {
    if (!busqueda.trim()) return [];
    const q = busqueda.toLowerCase();
    return productos
      .filter(
        (p) =>
          p.nombre.toLowerCase().includes(q) ||
          p.sku?.toLowerCase() === q ||
          p.codigo_barras === busqueda ||
          p.variantes_producto?.some((v) => v.codigo_barras === busqueda)
      )
      .slice(0, 8);
  }, [busqueda, productos]);

  useEffect(() => {
    setIndiceSeleccionado(0);
  }, [resultados]);

  function agregarAlCarrito(producto, variante = null) {
    const stockDisponible = variante ? variante.stock : producto.stock;
    if (stockDisponible <= 0) return;

    setCarrito((prev) => {
      const clave = variante ? variante.id : producto.id;
      const existente = prev.find((i) => i.clave === clave);
      if (existente) {
        if (existente.cantidad >= stockDisponible) return prev;
        return prev.map((i) => (i.clave === clave ? { ...i, cantidad: i.cantidad + 1 } : i));
      }
      return [
        ...prev,
        {
          clave,
          producto_id: producto.id,
          variante_id: variante?.id || null,
          nombre: producto.nombre,
          variante_label: variante
            ? [variante.atributo1_valor, variante.atributo2_valor].filter(Boolean).join(' · ')
            : null,
          // Solo para mostrar el carrito: el precio que se cobra lo
          // decide fn_crear_venta leyendo el catálogo.
          precio_unitario: Number(variante?.precio_override ?? producto.precio),
          cantidad: 1,
          stock_disponible: stockDisponible,
          descuento: 0,
        },
      ];
    });
    setBusqueda('');
    setProductoParaVariante(null);
    searchRef.current?.focus();
  }

  function onSeleccionarResultado(producto) {
    if (!producto) return;
    // Barcode exacto sobre una variante puntual: la agrega directo.
    const variantePorCodigo = producto.variantes_producto?.find((v) => v.codigo_barras === busqueda);
    if (variantePorCodigo) return agregarAlCarrito(producto, variantePorCodigo);

    if (producto.tiene_variantes) {
      setProductoParaVariante(producto);
    } else {
      agregarAlCarrito(producto);
    }
  }

  function cambiarCantidad(clave, cantidad) {
    setCarrito((prev) =>
      cantidad === 0 ? prev.filter((i) => i.clave !== clave) : prev.map((i) => (i.clave === clave ? { ...i, cantidad } : i))
    );
  }

  const subtotal = carrito.reduce((acc, i) => acc + i.cantidad * i.precio_unitario - i.descuento, 0);

  async function resolverCliente() {
    const telefono = telefonoCliente.trim();
    if (!telefono) return null;

    const { data: existente } = await supabase
      .from('clientes')
      .select('id')
      .eq('negocio_id', negocio.id)
      .eq('telefono', telefono)
      .maybeSingle();
    if (existente) return existente.id;

    const { data: nuevo } = await supabase
      .from('clientes')
      .insert({ negocio_id: negocio.id, telefono, nombre: 'Sin nombre' })
      .select('id')
      .single();
    return nuevo?.id || null;
  }

  async function cobrar() {
    if (carrito.length === 0 || cobrandoRef.current) return;
    cobrandoRef.current = true;
    setError(null);
    setCobrando(true);

    try {
      const clienteId = await resolverCliente();

      // Sin precio: lo pone el servidor desde el catálogo. Si lo mandara
      // el navegador, cualquiera podría cobrarse lo que quisiera.
      const items = carrito.map((i) => ({
        producto_id: i.producto_id,
        variante_id: i.variante_id,
        cantidad: i.cantidad,
        descuento: i.descuento,
      }));

      const { data: ventaId, error: errRpc } = await supabase.rpc('fn_crear_venta', {
        p_negocio_id: negocio.id,
        p_cliente_id: clienteId,
        p_metodo_pago: metodoPago,
        p_canal: 'local',
        p_caja_sesion_id: cajaSesionId, // null si no hay caja abierta — no bloqueamos la venta por eso
        p_descuento_total: 0,
        p_items: items,
      });

      if (errRpc) throw errRpc;

      // Mostramos el total que quedó registrado, no el que calculó el
      // navegador: si un precio cambió recién, manda el del servidor.
      const { data: venta } = await supabase
        .from('ventas')
        .select('total')
        .eq('id', ventaId)
        .maybeSingle();

      setVentaConfirmada({ id: ventaId, total: Number(venta?.total ?? subtotal) });
      setCarrito([]);
      setTelefonoCliente('');
      cargarProductos(); // refresca stock mostrado
    } catch (err) {
      console.error(err);
      setError(
        err.message?.includes('Stock insuficiente')
          ? 'Uno de los productos ya no tiene stock suficiente. Revisá el carrito.'
          : 'No se pudo registrar la venta. Probá de nuevo.'
      );
    } finally {
      cobrandoRef.current = false;
      setCobrando(false);
    }
  }

  // Atajos de teclado del mostrador: F2 cobra, F8 vacía el carrito, Esc
  // limpia la búsqueda, ↑↓ navegan los resultados y Enter agrega el
  // resaltado. La regla que hace que el lector de barras nunca "se
  // pierda": si ninguna caja de texto tiene el foco y se aprieta una
  // tecla imprimible, el foco vuelve solo a la búsqueda.
  useEffect(() => {
    function onKeyDown(e) {
      if (productoParaVariante) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setProductoParaVariante(null);
          searchRef.current?.focus();
        }
        return;
      }

      if (e.key === 'F2') {
        e.preventDefault();
        cobrar();
        return;
      }
      if (e.key === 'F8') {
        e.preventDefault();
        setCarrito([]);
        setBusqueda('');
        searchRef.current?.focus();
        return;
      }
      if (e.key === 'F3') {
        e.preventDefault();
        telefonoRef.current?.focus();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setBusqueda('');
        searchRef.current?.focus();
        return;
      }

      if (document.activeElement === telefonoRef.current) return; // no interferir mientras escribe el teléfono

      if (document.activeElement === searchRef.current) {
        if (e.key === 'ArrowDown' && resultados.length > 0) {
          e.preventDefault();
          setIndiceSeleccionado((i) => Math.min(i + 1, resultados.length - 1));
        } else if (e.key === 'ArrowUp' && resultados.length > 0) {
          e.preventDefault();
          setIndiceSeleccionado((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter' && resultados.length > 0) {
          e.preventDefault();
          onSeleccionarResultado(resultados[indiceSeleccionado] || resultados[0]);
        }
        return;
      }

      // Nada tiene el foco (se hizo clic en otro lado): cualquier tecla
      // imprimible retoma la búsqueda, como si nunca la hubiera perdido.
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        searchRef.current?.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrito, cobrando, resultados, indiceSeleccionado, productoParaVariante, busqueda]);

  if (ventaConfirmada) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 pt-16 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft">
          <Check size={28} className="text-accent" />
        </div>
        <p className="font-display text-2xl text-ink">Venta registrada</p>
        <p className="font-mono text-lg text-ink">Gs. {ventaConfirmada.total.toLocaleString('es-PY')}</p>
        <button
          onClick={() => {
            setVentaConfirmada(null);
            setTimeout(() => searchRef.current?.focus(), 0);
          }}
          className="mt-4 rounded-xl bg-accent px-6 py-3 text-sm font-medium text-white active:scale-[0.98]"
        >
          Nueva venta
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-6">
      <p className="font-display text-xl text-ink">Vender</p>

      <CajaBar negocioId={negocio.id} onSesionActualizada={(s) => setCajaSesionId(s?.id || null)} />

      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          ref={searchRef}
          autoFocus
          placeholder="Buscar por nombre o escanear código de barras…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {resultados.length > 0 && (
        <div className="space-y-1.5 rounded-xl bg-surface p-2 shadow-card">
          {resultados.map((p, i) => (
            <button
              key={p.id}
              onClick={() => onSeleccionarResultado(p)}
              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left ${
                i === indiceSeleccionado ? 'bg-accent-soft' : 'active:bg-base'
              }`}
            >
              <span className="text-sm text-ink">{p.nombre}</span>
              <span className="font-mono text-xs text-muted">Gs. {Number(p.precio).toLocaleString('es-PY')}</span>
            </button>
          ))}
        </div>
      )}

      {carrito.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-surface py-10 text-center shadow-card">
          <ShoppingCart size={24} className="text-muted" />
          <p className="text-sm text-muted">Buscá un producto para empezar la venta.</p>
          <p className="text-xs text-muted">o escaneá un código de barras</p>
        </div>
      ) : (
        <div className="space-y-2">
          {carrito.map((item) => (
            <CarritoItem
              key={item.clave}
              item={item}
              onCambiarCantidad={(c) => cambiarCantidad(item.clave, c)}
              onQuitar={() => cambiarCantidad(item.clave, 0)}
            />
          ))}
        </div>
      )}

      {carrito.length > 0 && (
        <>
          <input
            ref={telefonoRef}
            placeholder="Teléfono del cliente (opcional) — F3"
            value={telefonoCliente}
            onChange={(e) => setTelefonoCliente(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
          />

          <div className="flex gap-2">
            {METODOS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMetodoPago(m.id)}
                className={`flex-1 rounded-xl py-2 text-xs font-medium ${
                  metodoPago === m.id ? 'bg-accent text-white' : 'bg-surface text-muted'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex items-center justify-between rounded-2xl bg-surface p-4 shadow-card">
            <div>
              <p className="text-xs text-muted">Total</p>
              <p className="font-display text-2xl font-semibold text-ink">
                Gs. {subtotal.toLocaleString('es-PY')}
              </p>
            </div>
            <button
              onClick={cobrar}
              disabled={cobrando}
              className="rounded-xl bg-accent px-6 py-3 text-sm font-medium text-white active:scale-[0.98] disabled:opacity-60"
            >
              {cobrando ? 'Cobrando…' : 'Cobrar (F2)'}
            </button>
          </div>

          <p className="text-center text-[11px] text-muted">F2 cobrar · F8 vaciar carrito · Esc limpiar búsqueda</p>
        </>
      )}
      {productoParaVariante && (
        <SelectorVariante
          producto={productoParaVariante}
          onElegir={(variante) => agregarAlCarrito(productoParaVariante, variante)}
          onCerrar={() => {
            setProductoParaVariante(null);
            searchRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
