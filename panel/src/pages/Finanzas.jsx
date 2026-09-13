import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Lock, MessageCircle, CreditCard, Plus, X, TrendingUp, TrendingDown, Paperclip, ChevronRight, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useRealtimeTick } from '../lib/realtime';
import { subirComprobanteMovimiento, urlComprobante } from '../lib/storage';
import MetricPill from '../components/MetricPill';
import GastosFijos from '../components/GastosFijos';

const PERIODOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
];

const CATEGORIAS_LABEL = {
  servicio: 'Servicios',
  venta: 'Ventas',
  venta_anulada: 'Ventas anuladas',
  gasto: 'Gastos',
  retiro: 'Retiros',
  alquiler: 'Alquiler',
  insumos: 'Insumos',
  sueldos: 'Sueldos',
  otro: 'Otro',
};

function etiquetaCategoria(cat) {
  return CATEGORIAS_LABEL[cat] || (cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : 'Sin categoría');
}

function formatoGsCompacto(monto) {
  const n = Number(monto);
  const signo = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${signo}Gs. ${(abs / 1_000_000).toLocaleString('es-PY', { maximumFractionDigits: 1 })} M`;
  return `${signo}Gs. ${abs.toLocaleString('es-PY')}`;
}

function desdePeriodo(periodo) {
  const ahora = new Date();
  if (periodo === 'hoy') {
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(ahora);
    return new Date(`${hoy}T00:00:00-03:00`).toISOString();
  }
  if (periodo === 'semana') return new Date(ahora.getTime() - 7 * 86400000).toISOString();
  return new Date(ahora.getTime() - 30 * 86400000).toISOString();
}

export default function Finanzas() {
  const { negocio } = useAuth();
  const navigate = useNavigate();
  const tieneRetail = (negocio?.modulos_activos || []).some((m) => m === 'pos' || m === 'inventario');
  const tieneAgenda = (negocio?.modulos_activos || []).includes('agenda');

  const [periodo, setPeriodo] = useState('semana');
  const [movimientos, setMovimientos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [pendientes, setPendientes] = useState(null);

  const [vistaForm, setVistaForm] = useState(false);
  const [tipoNuevo, setTipoNuevo] = useState('egreso');
  const [montoNuevo, setMontoNuevo] = useState('');
  const [categoriaNueva, setCategoriaNueva] = useState('gasto');
  const [notaNueva, setNotaNueva] = useState('');
  const [comprobanteNuevo, setComprobanteNuevo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const guardandoRef = useRef(false);
  // Si el formulario se abrió desde "¿ya pagaste el alquiler?", este es
  // el gasto fijo que se confirma — así el movimiento queda vinculado y
  // no se vuelve a recordar este mes.
  const [gastoFijoActivo, setGastoFijoActivo] = useState(null);

  // Detalle de un movimiento individual (tocás una fila en "Movimientos").
  const [movimientoAbierto, setMovimientoAbierto] = useState(null);
  const [comprobanteUrlDetalle, setComprobanteUrlDetalle] = useState(null);
  const [cargandoComprobanteDetalle, setCargandoComprobanteDetalle] = useState(false);
  const [subiendoComprobanteDetalle, setSubiendoComprobanteDetalle] = useState(false);

  const tickMovimientos = useRealtimeTick('movimientos_financieros', negocio?.id);
  const tickCaja = useRealtimeTick('caja_sesiones', negocio?.id);
  const tickConversaciones = useRealtimeTick('conversaciones', negocio?.id);
  const tickProductos = useRealtimeTick('productos', negocio?.id);

  useEffect(() => {
    if (!negocio) return;
    cargarMovimientos();
  }, [negocio, periodo, tickMovimientos]);

  useEffect(() => {
    if (!negocio) return;
    cargarPendientes();
  }, [negocio, tickCaja, tickConversaciones, tickProductos]);

  async function cargarMovimientos() {
    setCargando(true);
    const { data } = await supabase
      .from('movimientos_financieros')
      .select('*')
      .eq('negocio_id', negocio.id)
      .gte('fecha', desdePeriodo(periodo).slice(0, 10))
      .order('fecha', { ascending: false })
      .order('creado_en', { ascending: false })
      .limit(300);
    setMovimientos(data || []);
    setCargando(false);
  }

  async function cargarPendientes() {
    const hoyISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());
    const inicioHoy = `${hoyISO}T00:00:00-03:00`;
    const diaDeHoy = Number(hoyISO.slice(8, 10));
    const inicioMes = `${hoyISO.slice(0, 7)}-01`;

    const consultas = [
      // Caja abierta de un día anterior: el riesgo #1 de olvido en un mostrador.
      supabase
        .from('caja_sesiones')
        .select('id, abierta_en')
        .eq('negocio_id', negocio.id)
        .eq('estado', 'abierta')
        .lt('abierta_en', inicioHoy),
      // Conversaciones que el bot ya derivó y siguen sin que alguien responda.
      supabase
        .from('conversaciones')
        .select('id, prioridad, cliente:clientes(nombre)')
        .eq('negocio_id', negocio.id)
        .eq('estado', 'derivado_humano'),
      // Todos los gastos fijos activos (el estado de cada uno — pagado,
      // vencido, próximo — se calcula al renderizar, no acá).
      supabase
        .from('gastos_fijos')
        .select('id, nombre, categoria, monto_estimado, dia_mes')
        .eq('negocio_id', negocio.id)
        .eq('activo', true)
        .order('dia_mes'),
      // De esos, cuáles ya se confirmaron pagados este mes.
      supabase
        .from('movimientos_financieros')
        .select('gasto_fijo_id')
        .eq('negocio_id', negocio.id)
        .not('gasto_fijo_id', 'is', null)
        .gte('fecha', inicioMes),
    ];

    if (tieneRetail) {
      consultas.push(
        supabase
          .from('productos')
          .select('id, nombre, stock, stock_minimo, tiene_variantes, variantes_producto(stock, activo)')
          .eq('negocio_id', negocio.id)
          .eq('activo', true),
        supabase
          .from('creditos_clientes')
          .select('id, monto, saldo_pendiente, fecha_vencimiento, cliente:clientes(nombre)')
          .eq('negocio_id', negocio.id)
          .eq('estado', 'pendiente')
          .lt('fecha_vencimiento', hoyISO)
      );
    }

    const [cajasRes, conversRes, gastosFijosRes, movsGastoFijoRes, productosRes, creditosRes] = await Promise.all(
      consultas
    );

    const stockBajo = tieneRetail
      ? (productosRes?.data || []).filter((p) => {
          const stockTotal = p.tiene_variantes
            ? (p.variantes_producto || []).filter((v) => v.activo).reduce((a, v) => a + v.stock, 0)
            : p.stock;
          return stockTotal <= p.stock_minimo;
        })
      : [];

    const gastosFijosPagadosIds = new Set((movsGastoFijoRes?.data || []).map((m) => m.gasto_fijo_id));

    setPendientes({
      cajasSinCerrar: cajasRes?.data || [],
      conversaciones: conversRes?.data || [],
      stockBajo,
      creditosVencidos: creditosRes?.data || [],
      gastosFijos: gastosFijosRes?.data || [],
      gastosFijosPagadosIds,
    });
  }

  const diaDeHoy = useMemo(
    () => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date()).slice(8, 10)),
    []
  );

  const totalPendientes = pendientes
    ? pendientes.cajasSinCerrar.length +
      pendientes.conversaciones.length +
      pendientes.stockBajo.length +
      pendientes.creditosVencidos.length
    : 0;

  const ingresos = useMemo(
    () => movimientos.filter((m) => m.tipo === 'ingreso').reduce((a, m) => a + Number(m.monto), 0),
    [movimientos]
  );
  const egresos = useMemo(
    () => movimientos.filter((m) => m.tipo === 'egreso').reduce((a, m) => a + Number(m.monto), 0),
    [movimientos]
  );
  const neto = ingresos - egresos;

  const porCategoria = useMemo(() => {
    const mapa = {};
    for (const m of movimientos) {
      const clave = `${m.tipo}:${m.categoria || 'otro'}`;
      mapa[clave] = (mapa[clave] || 0) + Number(m.monto);
    }
    return Object.entries(mapa)
      .map(([clave, monto]) => {
        const [tipo, categoria] = clave.split(':');
        return { tipo, categoria, monto };
      })
      .sort((a, b) => b.monto - a.monto);
  }, [movimientos]);

  async function agregarMovimiento(e) {
    e.preventDefault();
    if (guardandoRef.current) return;
    setError(null);

    const monto = Number(montoNuevo);
    if (!monto || monto <= 0) {
      setError('Poné un monto válido.');
      return;
    }

    guardandoRef.current = true;
    setGuardando(true);

    const { data: nuevo, error: errInsert } = await supabase
      .from('movimientos_financieros')
      .insert({
        negocio_id: negocio.id,
        tipo: tipoNuevo,
        monto,
        categoria: categoriaNueva,
        origen: 'manual',
        notas: notaNueva || null,
        gasto_fijo_id: gastoFijoActivo,
      })
      .select()
      .single();

    if (errInsert) {
      guardandoRef.current = false;
      setGuardando(false);
      setError('No se pudo guardar. Probá de nuevo.');
      return;
    }

    // Comprobante (opcional): en un try aparte — si falla, el movimiento
    // ya quedó guardado igual, no tiene sentido tirar todo abajo por eso.
    if (comprobanteNuevo) {
      try {
        const ruta = await subirComprobanteMovimiento({
          negocioId: negocio.id,
          movimientoId: nuevo.id,
          file: comprobanteNuevo,
        });
        await supabase.from('movimientos_financieros').update({ comprobante_url: ruta }).eq('id', nuevo.id);
      } catch (errComp) {
        console.error('Error subiendo el comprobante:', errComp);
      }
    }

    guardandoRef.current = false;
    setGuardando(false);
    setMontoNuevo('');
    setNotaNueva('');
    setComprobanteNuevo(null);
    setGastoFijoActivo(null);
    setVistaForm(false);
    cargarMovimientos();
    cargarPendientes(); // este gasto fijo deja de aparecer como vencido
  }

  // Abre el formulario ya cargado con los datos del gasto fijo, para
  // confirmar en un toque — el monto y la nota siguen siendo editables
  // por si esta vez salió distinto (ej. la luz).
  function iniciarPagoGastoFijo(g) {
    setTipoNuevo('egreso');
    setCategoriaNueva(g.categoria);
    setMontoNuevo(String(g.monto_estimado));
    setNotaNueva(g.nombre);
    setGastoFijoActivo(g.id);
    setVistaForm(true);
  }

  async function verComprobanteDetalle(ruta) {
    setCargandoComprobanteDetalle(true);
    try {
      const url = await urlComprobante(ruta);
      setComprobanteUrlDetalle(url);
    } catch (err) {
      console.error('Error obteniendo el comprobante:', err);
    } finally {
      setCargandoComprobanteDetalle(false);
    }
  }

  async function adjuntarComprobanteDetalle(file) {
    if (!file || !movimientoAbierto) return;
    setSubiendoComprobanteDetalle(true);
    try {
      const ruta = await subirComprobanteMovimiento({
        negocioId: negocio.id,
        movimientoId: movimientoAbierto.id,
        file,
      });
      await supabase.from('movimientos_financieros').update({ comprobante_url: ruta }).eq('id', movimientoAbierto.id);
      setMovimientoAbierto((m) => ({ ...m, comprobante_url: ruta }));
      cargarMovimientos();
    } catch (err) {
      console.error('Error adjuntando el comprobante:', err);
    } finally {
      setSubiendoComprobanteDetalle(false);
    }
  }

  return (
    <div className="space-y-4 pb-4">
      <p className="font-display text-xl text-ink">Finanzas</p>

      {/* ---- Pendientes: lo primero que hay que mirar, antes que ningún número ---- */}
      {pendientes && totalPendientes > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Necesita atención</p>

          {pendientes.cajasSinCerrar.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-xl bg-danger-soft p-3">
              <Lock size={16} className="shrink-0 text-danger" />
              <p className="text-sm text-danger">
                Quedó una caja abierta desde el{' '}
                {new Intl.DateTimeFormat('es-PY', { timeZone: 'America/Asuncion', day: '2-digit', month: '2-digit' }).format(
                  new Date(c.abierta_en)
                )}{' '}
                — andá a Vender para cerrarla.
              </p>
            </div>
          ))}

          {pendientes.conversaciones.map((c) => (
            <button
              key={c.id}
              onClick={() => navigate('/clientes')}
              className={`flex w-full items-center gap-3 rounded-xl p-3 text-left ${
                c.prioridad === 'alta' ? 'bg-danger-soft' : 'bg-amber-soft'
              }`}
            >
              <MessageCircle size={16} className={`shrink-0 ${c.prioridad === 'alta' ? 'text-danger' : 'text-amber'}`} />
              <p className={`text-sm ${c.prioridad === 'alta' ? 'text-danger' : 'text-amber'}`}>
                {c.cliente?.nombre || 'Un cliente'} está esperando respuesta
                {c.prioridad === 'alta' ? ' — prioridad alta' : ''}
              </p>
            </button>
          ))}

          {pendientes.stockBajo.length > 0 && (
            <div className="flex items-center gap-3 rounded-xl bg-amber-soft p-3">
              <AlertTriangle size={16} className="shrink-0 text-amber" />
              <p className="text-sm text-amber">
                {pendientes.stockBajo.length === 1
                  ? `"${pendientes.stockBajo[0].nombre}" está por debajo del stock mínimo.`
                  : `${pendientes.stockBajo.length} productos están por debajo del stock mínimo.`}
              </p>
            </div>
          )}

          {pendientes.creditosVencidos.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-xl bg-danger-soft p-3">
              <CreditCard size={16} className="shrink-0 text-danger" />
              <p className="text-sm text-danger">
                {c.cliente?.nombre || 'Un cliente'} debe Gs. {Number(c.saldo_pendiente).toLocaleString('es-PY')}, vencido.
              </p>
            </div>
          ))}

        </div>
      )}

      {pendientes && totalPendientes === 0 && (
        <div className="rounded-xl bg-accent-soft p-3 text-center text-sm text-accent">
          Nada pendiente por ahora — todo al día ✓
        </div>
      )}

      {/* ---- Plata ---- */}
      <div className="flex gap-2 overflow-x-auto pb-1">
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
      </div>

      <div className="flex gap-3">
        <MetricPill label="Ingresos" value={formatoGsCompacto(ingresos)} tone="accent" compact />
        <MetricPill label="Egresos" value={formatoGsCompacto(egresos)} tone="danger" compact />
        <MetricPill label="Neto" value={formatoGsCompacto(neto)} tone={neto >= 0 ? 'accent' : 'danger'} compact />
      </div>

      <button
        onClick={() => {
          setTipoNuevo('egreso');
          setCategoriaNueva('gasto');
          setMontoNuevo('');
          setNotaNueva('');
          setGastoFijoActivo(null);
          setVistaForm(true);
        }}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand py-2.5 text-xs font-medium text-ink"
      >
        <Plus size={14} /> Cargar un gasto o ingreso manual
      </button>

      <GastosFijos negocioId={negocio.id} onCambio={cargarPendientes} />

      {/* ---- Gastos fijos de este mes: arriba de todo, antes de los
           movimientos sueltos — es plata que ya sabés que se viene ---- */}
      {pendientes && pendientes.gastosFijos.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Gastos fijos de este mes</p>
          <div className="space-y-1.5 rounded-xl bg-surface p-2 shadow-card">
            {pendientes.gastosFijos.map((g) => {
              const pagado = pendientes.gastosFijosPagadosIds.has(g.id);
              const vencido = !pagado && g.dia_mes <= diaDeHoy;
              return (
                <div key={g.id} className="flex items-center justify-between rounded-lg px-2.5 py-2">
                  <div>
                    <p className="text-sm text-ink">{g.nombre}</p>
                    <p className={`text-xs ${vencido ? 'text-amber' : 'text-muted'}`}>
                      Gs. {Number(g.monto_estimado).toLocaleString('es-PY')} ·{' '}
                      {pagado
                        ? 'Pagado este mes'
                        : vencido
                          ? `Venció el día ${g.dia_mes}`
                          : `Vence el día ${g.dia_mes}`}
                    </p>
                  </div>
                  {pagado ? (
                    <Check size={18} className="shrink-0 text-accent" />
                  ) : (
                    <button
                      onClick={() => iniciarPagoGastoFijo(g)}
                      className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${
                        vencido ? 'bg-amber-soft text-amber' : 'bg-base text-muted'
                      }`}
                    >
                      Confirmar pago
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {cargando && <p className="pt-4 text-center text-sm text-muted">Cargando…</p>}

      {!cargando && porCategoria.length === 0 && (
        <p className="pt-4 text-center text-sm text-muted">
          Sin movimientos en este período. Los ingresos aparecen solos cuando se cobra una venta o se completa un turno.
        </p>
      )}

      {porCategoria.length > 0 && (
        <div className="space-y-1.5 rounded-xl bg-surface p-2 shadow-card">
          {porCategoria.map(({ tipo, categoria, monto }) => (
            <div key={`${tipo}:${categoria}`} className="flex items-center justify-between rounded-lg px-2.5 py-2">
              <div className="flex items-center gap-2">
                {tipo === 'ingreso' ? (
                  <TrendingUp size={14} className="text-accent" />
                ) : (
                  <TrendingDown size={14} className="text-danger" />
                )}
                <span className="text-sm text-ink">{etiquetaCategoria(categoria)}</span>
              </div>
              <span className={`font-mono text-sm ${tipo === 'ingreso' ? 'text-accent' : 'text-danger'}`}>
                {tipo === 'ingreso' ? '+' : '−'} Gs. {monto.toLocaleString('es-PY')}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ---- Movimientos individuales: para poder abrir el detalle de
           uno puntual, no solo ver el total por categoría ---- */}
      {movimientos.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Movimientos</p>
          <div className="max-h-96 space-y-1.5 overflow-y-auto rounded-xl bg-surface p-2 shadow-card">
            {movimientos.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setMovimientoAbierto(m);
                  setComprobanteUrlDetalle(null);
                }}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left active:bg-base"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-ink">{etiquetaCategoria(m.categoria)}</span>
                    {m.comprobante_url && <Paperclip size={12} className="shrink-0 text-muted" />}
                  </div>
                  <p className="truncate text-xs text-muted">
                    {new Intl.DateTimeFormat('es-PY', { timeZone: 'America/Asuncion', day: '2-digit', month: '2-digit' }).format(
                      new Date(m.fecha)
                    )}
                    {m.notas ? ` · ${m.notas}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className={`font-mono text-sm ${m.tipo === 'ingreso' ? 'text-accent' : 'text-danger'}`}>
                    {m.tipo === 'ingreso' ? '+' : '−'} Gs. {Number(m.monto).toLocaleString('es-PY')}
                  </span>
                  <ChevronRight size={14} className="text-muted" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {vistaForm && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/60"
          onClick={() => {
            setVistaForm(false);
            setGastoFijoActivo(null);
          }}
        >
          <div className="mx-auto w-full max-w-md rounded-t-2xl bg-surface p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-display text-lg text-ink">
                {gastoFijoActivo ? 'Confirmar pago' : 'Cargar movimiento'}
              </p>
              <button
                onClick={() => {
                  setVistaForm(false);
                  setGastoFijoActivo(null);
                }}
                className="text-muted"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={agregarMovimiento} className="mt-3 space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTipoNuevo('egreso')}
                  className={`flex-1 rounded-xl py-2 text-xs font-medium ${
                    tipoNuevo === 'egreso' ? 'bg-danger text-white' : 'bg-base text-muted'
                  }`}
                >
                  Gasto
                </button>
                <button
                  type="button"
                  onClick={() => setTipoNuevo('ingreso')}
                  className={`flex-1 rounded-xl py-2 text-xs font-medium ${
                    tipoNuevo === 'ingreso' ? 'bg-accent text-accent-ink' : 'bg-base text-muted'
                  }`}
                >
                  Ingreso
                </button>
              </div>

              <input
                type="number"
                autoFocus
                placeholder="Monto (Gs.)"
                value={montoNuevo}
                onChange={(e) => setMontoNuevo(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
              />

              <select
                value={categoriaNueva}
                onChange={(e) => setCategoriaNueva(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
              >
                {tipoNuevo === 'egreso' ? (
                  <>
                    <option value="gasto">Gasto</option>
                    <option value="alquiler">Alquiler</option>
                    <option value="insumos">Insumos</option>
                    <option value="sueldos">Sueldos</option>
                    <option value="retiro">Retiro</option>
                    <option value="otro">Otro</option>
                  </>
                ) : (
                  <>
                    <option value="otro">Otro ingreso</option>
                    <option value="servicio">Servicio (cobrado fuera del sistema)</option>
                  </>
                )}
              </select>

              <input
                placeholder="Motivo (opcional)"
                value={notaNueva}
                onChange={(e) => setNotaNueva(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
              />

              <label className="flex items-center gap-2 rounded-xl border border-dashed border-line bg-surface px-3 py-2.5 text-xs text-muted">
                <Paperclip size={14} className="shrink-0" />
                <span className="flex-1 truncate">
                  {comprobanteNuevo ? comprobanteNuevo.name : 'Adjuntar comprobante (opcional)'}
                </span>
                {comprobanteNuevo && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setComprobanteNuevo(null);
                    }}
                    className="shrink-0 text-muted active:text-danger"
                  >
                    <X size={14} />
                  </button>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setComprobanteNuevo(e.target.files?.[0] || null)}
                />
              </label>

              {error && <p className="text-sm text-danger">{error}</p>}

              <button
                type="submit"
                disabled={guardando}
                className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink disabled:opacity-60"
              >
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </form>
          </div>
        </div>
      )}

      {movimientoAbierto && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/60"
          onClick={() => setMovimientoAbierto(null)}
        >
          <div
            className="mx-auto w-full max-w-md rounded-t-2xl bg-surface p-5 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="font-display text-lg text-ink">{etiquetaCategoria(movimientoAbierto.categoria)}</p>
              <button onClick={() => setMovimientoAbierto(null)} className="text-muted">
                <X size={20} />
              </button>
            </div>

            <div className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Monto</span>
                <span
                  className={`font-mono font-medium ${
                    movimientoAbierto.tipo === 'ingreso' ? 'text-accent' : 'text-danger'
                  }`}
                >
                  {movimientoAbierto.tipo === 'ingreso' ? '+' : '−'} Gs.{' '}
                  {Number(movimientoAbierto.monto).toLocaleString('es-PY')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Fecha</span>
                <span className="text-ink">
                  {new Intl.DateTimeFormat('es-PY', { timeZone: 'America/Asuncion', day: '2-digit', month: '2-digit', year: 'numeric' }).format(
                    new Date(movimientoAbierto.fecha)
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Origen</span>
                <span className="text-ink">{movimientoAbierto.origen === 'manual' ? 'Cargado a mano' : 'Automático'}</span>
              </div>
              {movimientoAbierto.notas && (
                <div className="flex justify-between gap-3">
                  <span className="shrink-0 text-muted">Motivo</span>
                  <span className="text-right text-ink">{movimientoAbierto.notas}</span>
                </div>
              )}
            </div>

            <div className="mt-4 border-t border-line pt-3">
              {movimientoAbierto.comprobante_url ? (
                comprobanteUrlDetalle ? (
                  <a href={comprobanteUrlDetalle} target="_blank" rel="noreferrer">
                    <img
                      src={comprobanteUrlDetalle}
                      alt="Comprobante"
                      className="max-h-64 w-full rounded-lg object-contain"
                    />
                  </a>
                ) : (
                  <button
                    onClick={() => verComprobanteDetalle(movimientoAbierto.comprobante_url)}
                    disabled={cargandoComprobanteDetalle}
                    className="flex items-center gap-1.5 text-xs font-medium text-accent disabled:opacity-60"
                  >
                    <Paperclip size={14} />
                    {cargandoComprobanteDetalle ? 'Cargando…' : 'Ver comprobante adjunto'}
                  </button>
                )
              ) : (
                <label className="flex items-center gap-2 rounded-xl border border-dashed border-line bg-base px-3 py-2.5 text-xs text-muted">
                  <Paperclip size={14} className="shrink-0" />
                  <span className="flex-1">
                    {subiendoComprobanteDetalle ? 'Subiendo…' : 'Adjuntar comprobante'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={subiendoComprobanteDetalle}
                    onChange={(e) => adjuntarComprobanteDetalle(e.target.files?.[0])}
                  />
                </label>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
