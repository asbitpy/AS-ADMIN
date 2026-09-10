import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Lock, MessageCircle, CreditCard, Plus, X, TrendingUp, TrendingDown } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useRealtimeTick } from '../lib/realtime';
import MetricPill from '../components/MetricPill';

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
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const guardandoRef = useRef(false);

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

    const [cajasRes, conversRes, productosRes, creditosRes] = await Promise.all(consultas);

    const stockBajo = tieneRetail
      ? (productosRes?.data || []).filter((p) => {
          const stockTotal = p.tiene_variantes
            ? (p.variantes_producto || []).filter((v) => v.activo).reduce((a, v) => a + v.stock, 0)
            : p.stock;
          return stockTotal <= p.stock_minimo;
        })
      : [];

    setPendientes({
      cajasSinCerrar: cajasRes?.data || [],
      conversaciones: conversRes?.data || [],
      stockBajo,
      creditosVencidos: creditosRes?.data || [],
    });
  }

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

    const { error: errInsert } = await supabase.from('movimientos_financieros').insert({
      negocio_id: negocio.id,
      tipo: tipoNuevo,
      monto,
      categoria: categoriaNueva,
      origen: 'manual',
      notas: notaNueva || null,
    });

    guardandoRef.current = false;
    setGuardando(false);

    if (errInsert) {
      setError('No se pudo guardar. Probá de nuevo.');
      return;
    }

    setMontoNuevo('');
    setNotaNueva('');
    setVistaForm(false);
    cargarMovimientos();
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
        onClick={() => setVistaForm(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand py-2.5 text-xs font-medium text-ink"
      >
        <Plus size={14} /> Cargar un gasto o ingreso manual
      </button>

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

      {vistaForm && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={() => setVistaForm(false)}>
          <div className="mx-auto w-full max-w-md rounded-t-2xl bg-surface p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-display text-lg text-ink">Cargar movimiento</p>
              <button onClick={() => setVistaForm(false)} className="text-muted">
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
                className="w-full rounded-xl border border-line px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
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
                className="w-full rounded-xl border border-line px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent"
              />

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
    </div>
  );
}
