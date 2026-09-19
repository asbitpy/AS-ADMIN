import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Lock, MessageCircle, CreditCard, Plus, X, TrendingUp, TrendingDown, Paperclip, ChevronRight, Check, Download, Trophy } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useRealtimeTick } from '../lib/realtime';
import { subirComprobanteMovimiento, urlComprobante } from '../lib/storage';
import MetricPill from '../components/MetricPill';
import GastosFijos from '../components/GastosFijos';
import { useEsEscritorio } from '../hooks/useEsEscritorio';
import { descargarPDF } from '../lib/pdf';

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

// Mismos valores que metodo_pago (database/004_retail_core.sql) y las
// mismas etiquetas que ya usa Venta.jsx, para no inventar otras.
const METODOS_PAGO_LABEL = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  qr: 'QR',
  credito: 'Crédito',
};

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

// "YYYY-MM-DD" + n días → "YYYY-MM-DD". Se ancla a mediodía UTC (no a
// medianoche local) justamente para que sumar un día no se corra por el
// huso horario del navegador — solo importan las partes de fecha, nunca
// la hora real.
function sumarDiasISO(fechaISO, dias) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// Mismo anclaje a mediodía UTC que sumarDiasISO, por la misma razón.
function nombreDiaISO(fechaISO) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  return DIAS_SEMANA[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
}

function fechaDDMMYYYY(fechaISO) {
  const [y, m, d] = fechaISO.split('-');
  return `${d}/${m}/${y}`;
}

// Rango del período INMEDIATAMENTE ANTERIOR, de la misma duración, para
// poder comparar ("esta semana vendiste más o menos que la pasada").
function rangoPeriodoAnterior(periodo) {
  const diasPorPeriodo = { hoy: 1, semana: 7, mes: 30 };
  const dias = diasPorPeriodo[periodo] || 7;
  const ahora = Date.now();
  const desde = new Date(ahora - dias * 2 * 86400000).toISOString().slice(0, 10);
  const hasta = new Date(ahora - dias * 86400000).toISOString().slice(0, 10);
  return { desde, hasta };
}

function calcularDelta(actual, previo) {
  if (previo === 0) {
    if (actual === 0) return null;
    return { texto: 'sin datos del período anterior', positivo: actual >= 0 };
  }
  const cambio = ((actual - previo) / Math.abs(previo)) * 100;
  const signo = cambio >= 0 ? '+' : '';
  return { texto: `${signo}${cambio.toFixed(0)}% vs. período anterior`, positivo: cambio >= 0 };
}

export default function Finanzas() {
  const { negocio } = useAuth();
  const navigate = useNavigate();
  const { esEscritorio } = useEsEscritorio();
  const tieneRetail = (negocio?.modulos_activos || []).some((m) => m === 'pos' || m === 'inventario');
  const tieneAgenda = (negocio?.modulos_activos || []).includes('agenda');

  const [periodo, setPeriodo] = useState('semana');
  const [movimientos, setMovimientos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [pendientes, setPendientes] = useState(null);
  const [anterior, setAnterior] = useState(null); // { ingresos, egresos, neto } del período previo
  const [topProductos, setTopProductos] = useState([]);
  const [topServicios, setTopServicios] = useState([]);
  const [proyectado, setProyectado] = useState(null);
  const [desglosePagos, setDesglosePagos] = useState([]);
  // Filtro de la tabla de Movimientos al tocar una categoría del
  // desglose (solo interactivo en escritorio — ver Categorías más abajo).
  const [filtroCategoria, setFiltroCategoria] = useState(null); // { tipo, categoria } | null
  // Rango de fechas propio (solo escritorio): mientras las dos fechas
  // no estén cargadas, se ignora y manda el período de los botones de
  // siempre — así en celular esto nunca cambia nada.
  const [rangoCustom, setRangoCustom] = useState({ desde: '', hasta: '' });
  // auth_user_id → nombre, para que el CSV de Movimientos pueda decir
  // quién cargó cada uno (movimientos_financieros.registrado_por ya
  // guarda ese id — ver migración 017 — nunca se había resuelto a nombre).
  const [nombresUsuarios, setNombresUsuarios] = useState({});

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

  // Si las dos fechas del rango propio están cargadas, manda eso;
  // si no, el período de los botones de siempre (con "hasta" abierto,
  // hasta ahora — mismo comportamiento que ya había).
  function rangoActivo() {
    if (rangoCustom.desde && rangoCustom.hasta) return { desde: rangoCustom.desde, hasta: rangoCustom.hasta };
    return { desde: desdePeriodo(periodo).slice(0, 10), hasta: null };
  }
  const usaRangoCustom = Boolean(rangoCustom.desde && rangoCustom.hasta);

  useEffect(() => {
    if (!negocio) return;
    cargarMovimientos();
    cargarAnterior();
    cargarTopVendidos();
    cargarDesglosePagos();
  }, [negocio, periodo, tickMovimientos, rangoCustom.desde, rangoCustom.hasta]);

  useEffect(() => {
    if (!negocio) return;
    cargarPendientes();
    cargarProyectado();
  }, [negocio, tickCaja, tickConversaciones, tickProductos, tickMovimientos]);

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

  function nombreDeUsuario(authUserId) {
    if (!authUserId) return 'Sin registrar';
    if (authUserId === negocio.auth_user_id) return negocio.nombre_dueno || 'Vos';
    return nombresUsuarios[authUserId] || 'Ex-empleado';
  }

  async function cargarMovimientos() {
    setCargando(true);
    const { desde, hasta } = rangoActivo();
    let q = supabase
      .from('movimientos_financieros')
      .select('*')
      .eq('negocio_id', negocio.id)
      .gte('fecha', desde)
      .order('fecha', { ascending: false })
      .order('creado_en', { ascending: false })
      .limit(300);
    if (hasta) q = q.lte('fecha', hasta);
    const { data } = await q;
    setMovimientos(data || []);
    setCargando(false);
  }

  async function cargarAnterior() {
    // Con un rango propio no hay un "período anterior" claro que
    // comparar — se oculta el delta en vez de inventar una comparación.
    if (usaRangoCustom) {
      setAnterior(null);
      return;
    }
    const { desde, hasta } = rangoPeriodoAnterior(periodo);
    const { data } = await supabase
      .from('movimientos_financieros')
      .select('tipo, monto')
      .eq('negocio_id', negocio.id)
      .gte('fecha', desde)
      .lt('fecha', hasta);

    const ing = (data || []).filter((m) => m.tipo === 'ingreso').reduce((a, m) => a + Number(m.monto), 0);
    const egr = (data || []).filter((m) => m.tipo === 'egreso').reduce((a, m) => a + Number(m.monto), 0);
    setAnterior({ ingresos: ing, egresos: egr, neto: ing - egr });
  }

  // Cuánto entró por cada método de pago (efectivo, transferencia...) —
  // el dato ya vive en venta_pagos, acá solo se suma por método.
  async function cargarDesglosePagos() {
    if (!tieneRetail) {
      setDesglosePagos([]);
      return;
    }
    const { desde, hasta } = rangoActivo();
    let q = supabase
      .from('ventas')
      .select('id')
      .eq('negocio_id', negocio.id)
      .eq('estado', 'completada')
      .gte('creado_en', desde);
    if (hasta) q = q.lte('creado_en', `${hasta}T23:59:59`);
    const { data: ventas } = await q;
    const ids = (ventas || []).map((v) => v.id);

    if (!ids.length) {
      setDesglosePagos([]);
      return;
    }

    const { data: pagos } = await supabase.from('venta_pagos').select('metodo_pago, monto').in('venta_id', ids);
    const mapa = {};
    for (const p of pagos || []) {
      mapa[p.metodo_pago] = (mapa[p.metodo_pago] || 0) + Number(p.monto);
    }
    setDesglosePagos(
      Object.entries(mapa)
        .map(([metodo, monto]) => ({ metodo, monto }))
        .sort((a, b) => b.monto - a.monto)
    );
  }

  // Top 5 productos (retail) y servicios (agenda) del período, por
  // cantidad vendida/atendida.
  async function cargarTopVendidos() {
    const { desde, hasta } = rangoActivo();

    if (tieneRetail) {
      let qVentas = supabase
        .from('ventas')
        .select('id')
        .eq('negocio_id', negocio.id)
        .eq('estado', 'completada')
        .gte('creado_en', desde);
      if (hasta) qVentas = qVentas.lte('creado_en', `${hasta}T23:59:59`);
      const { data: ventas } = await qVentas;
      const ids = (ventas || []).map((v) => v.id);

      if (ids.length) {
        const { data: items } = await supabase
          .from('venta_items')
          .select('cantidad, precio_unitario, descuento, producto:productos(nombre)')
          .in('venta_id', ids);

        const mapa = {};
        for (const it of items || []) {
          const nombre = it.producto?.nombre || 'Producto eliminado';
          if (!mapa[nombre]) mapa[nombre] = { nombre, cantidad: 0, monto: 0 };
          mapa[nombre].cantidad += it.cantidad;
          mapa[nombre].monto += it.cantidad * Number(it.precio_unitario) - Number(it.descuento || 0);
        }
        setTopProductos(Object.values(mapa).sort((a, b) => b.cantidad - a.cantidad).slice(0, 5));
      } else {
        setTopProductos([]);
      }
    }

    if (tieneAgenda) {
      let qTurnos = supabase
        .from('turnos')
        .select('monto, servicio:servicios(nombre)')
        .eq('negocio_id', negocio.id)
        .eq('estado', 'completado')
        .gte('fecha_hora', desde);
      if (hasta) qTurnos = qTurnos.lte('fecha_hora', `${hasta}T23:59:59`);
      const { data: turnos } = await qTurnos;

      const mapa = {};
      for (const t of turnos || []) {
        const nombre = t.servicio?.nombre || 'Servicio eliminado';
        if (!mapa[nombre]) mapa[nombre] = { nombre, cantidad: 0, monto: 0 };
        mapa[nombre].cantidad += 1;
        mapa[nombre].monto += Number(t.monto) || 0;
      }
      setTopServicios(Object.values(mapa).sort((a, b) => b.cantidad - a.cantidad).slice(0, 5));
    }
  }

  // Lo que se sabe que se viene, no lo que ya se movió: pedidos por
  // WhatsApp reservados (todavía no cobrados), créditos por cobrar, y
  // gastos fijos de este mes que faltan confirmar.
  async function cargarProyectado() {
    const consultas = [
      tieneRetail
        ? supabase.from('ventas').select('total').eq('negocio_id', negocio.id).eq('estado', 'reservada')
        : Promise.resolve({ data: [] }),
      tieneRetail
        ? supabase
            .from('creditos_clientes')
            .select('saldo_pendiente')
            .eq('negocio_id', negocio.id)
            .eq('estado', 'pendiente')
        : Promise.resolve({ data: [] }),
      supabase.from('gastos_fijos').select('id, monto_estimado').eq('negocio_id', negocio.id).eq('activo', true),
      supabase
        .from('movimientos_financieros')
        .select('gasto_fijo_id')
        .eq('negocio_id', negocio.id)
        .not('gasto_fijo_id', 'is', null)
        .gte('fecha', `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date()).slice(0, 7)}-01`),
    ];

    const [reservadoRes, creditosRes, gastosFijosRes, pagadosRes] = await Promise.all(consultas);

    const porCobrarReservas = (reservadoRes.data || []).reduce((a, v) => a + Number(v.total), 0);
    const porCobrarCreditos = (creditosRes.data || []).reduce((a, c) => a + Number(c.saldo_pendiente), 0);

    const idsPagados = new Set((pagadosRes.data || []).map((m) => m.gasto_fijo_id));
    const porPagarFijos = (gastosFijosRes.data || [])
      .filter((g) => !idsPagados.has(g.id))
      .reduce((a, g) => a + Number(g.monto_estimado), 0);

    setProyectado({ porCobrarReservas, porCobrarCreditos, porPagarFijos });
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

  // Ingresos/egresos por día del período — solo tiene sentido con más
  // de un día a la vista (no con "Hoy"). Solo se muestra en escritorio.
  // Completa TODOS los días del rango, aunque no tengan movimientos
  // (quedan en cero) — si no, un día sin ventas desaparecía del gráfico
  // y la semana se veía salteada en vez de completa.
  const tendenciaDiaria = useMemo(() => {
    if (periodo === 'hoy' && !usaRangoCustom) return [];
    const { desde, hasta } = rangoActivo();
    const hastaFinal = hasta || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());

    const mapa = {};
    for (const m of movimientos) {
      if (!mapa[m.fecha]) mapa[m.fecha] = { ingresos: 0, egresos: 0, cantidad: 0 };
      if (m.tipo === 'ingreso') mapa[m.fecha].ingresos += Number(m.monto);
      else mapa[m.fecha].egresos += Number(m.monto);
      mapa[m.fecha].cantidad += 1;
    }

    const dias = [];
    let cursor = desde;
    let resguardo = 0;
    while (cursor <= hastaFinal && resguardo < 370) {
      dias.push({
        fecha: cursor,
        ingresos: mapa[cursor]?.ingresos || 0,
        egresos: mapa[cursor]?.egresos || 0,
        cantidad: mapa[cursor]?.cantidad || 0,
      });
      cursor = sumarDiasISO(cursor, 1);
      resguardo++;
    }
    return dias;
  }, [movimientos, periodo, usaRangoCustom, rangoCustom.desde, rangoCustom.hasta]);

  // Escala simétrica sobre el NETO del día (ingreso - egreso), no sobre
  // ingreso/egreso por separado — así una barra que sube es un día que
  // dio ganancia y una que baja es un día que dio pérdida, se lee de
  // un vistazo sin tener que comparar dos barras una al lado de la otra.
  const maxTendencia = useMemo(
    () => Math.max(...tendenciaDiaria.map((d) => Math.abs(d.ingresos - d.egresos)), 1),
    [tendenciaDiaria]
  );

  const netoTendencia = useMemo(
    () => tendenciaDiaria.reduce((a, d) => a + (d.ingresos - d.egresos), 0),
    [tendenciaDiaria]
  );

  // Día por día, ordenado cronológicamente (igual que se ve en el
  // gráfico), con el día de la semana y la cantidad de movimientos —
  // y una fila de total al final, para no tener que sumar a mano.
  function exportarTendenciaCSV() {
    const encabezados = ['Fecha', 'Día', 'Ingresos (Gs.)', 'Egresos (Gs.)', 'Neto (Gs.)', 'Cant. movimientos'];
    const filas = tendenciaDiaria.map((d) => [
      fechaDDMMYYYY(d.fecha),
      nombreDiaISO(d.fecha),
      d.ingresos,
      d.egresos,
      d.ingresos - d.egresos,
      d.cantidad,
    ]);

    const totalIngresos = tendenciaDiaria.reduce((a, d) => a + d.ingresos, 0);
    const totalEgresos = tendenciaDiaria.reduce((a, d) => a + d.egresos, 0);
    const totalCantidad = tendenciaDiaria.reduce((a, d) => a + d.cantidad, 0);
    filas.push(['', '', '', '', '', '']);
    filas.push(['TOTAL', `${tendenciaDiaria.length} días`, totalIngresos, totalEgresos, totalIngresos - totalEgresos, totalCantidad]);

    const contenido = '﻿' + [encabezados, ...filas].map((f) => f.join(';')).join('\r\n');
    const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tendencia_${periodo}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Toca una categoría del desglose (solo escritorio, ver más abajo) y
  // filtra la tabla de Movimientos a esa categoría — tocar de nuevo la
  // misma la saca. En celular nunca se activa (no hay onClick ahí).
  function toggleFiltroCategoria(tipo, categoria) {
    setFiltroCategoria((prev) => (prev && prev.tipo === tipo && prev.categoria === categoria ? null : { tipo, categoria }));
  }

  const movimientosFiltrados = useMemo(() => {
    if (!filtroCategoria) return movimientos;
    return movimientos.filter(
      (m) => m.tipo === filtroCategoria.tipo && (m.categoria || 'otro') === filtroCategoria.categoria
    );
  }, [movimientos, filtroCategoria]);

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

  // CSV (se abre bien en Excel/Sheets) con los movimientos del período
  // que se está viendo — respeta el filtro de categoría si hay uno
  // activo. Mismo criterio de BOM+';' que ya usa la plantilla de
  // importar productos, para que los acentos no se rompan.
  //
  // Ordenado cronológicamente (del más viejo al más nuevo, como una
  // planilla contable de verdad) con Ingreso y Egreso en columnas
  // separadas — así una suma de columna en Excel funciona directo, sin
  // tener que filtrar por tipo primero. Cierra con una fila de totales.
  function exportarCSV() {
    const ordenados = [...movimientosFiltrados].sort(
      (a, b) => a.fecha.localeCompare(b.fecha) || (a.creado_en || '').localeCompare(b.creado_en || '')
    );

    const encabezados = [
      'Fecha',
      'Día',
      'Categoría',
      'Ingreso (Gs.)',
      'Egreso (Gs.)',
      'Notas',
      'Origen',
      'Comprobante',
      'Cargado por',
    ];
    const filas = ordenados.map((m) => [
      fechaDDMMYYYY(m.fecha),
      nombreDiaISO(m.fecha),
      etiquetaCategoria(m.categoria),
      m.tipo === 'ingreso' ? m.monto : '',
      m.tipo === 'egreso' ? m.monto : '',
      (m.notas || '').replace(/;/g, ','),
      m.origen === 'manual' ? 'Cargado a mano' : 'Automático',
      m.comprobante_url ? 'Sí' : 'No',
      nombreDeUsuario(m.registrado_por),
    ]);

    const totalIngresos = ordenados.filter((m) => m.tipo === 'ingreso').reduce((a, m) => a + Number(m.monto), 0);
    const totalEgresos = ordenados.filter((m) => m.tipo === 'egreso').reduce((a, m) => a + Number(m.monto), 0);
    filas.push(['', '', '', '', '', '', '', '', '']);
    filas.push([
      'TOTAL',
      `${ordenados.length} movimientos`,
      '',
      totalIngresos,
      totalEgresos,
      '',
      '',
      '',
      '',
    ]);

    const contenido = '﻿' + [encabezados, ...filas].map((f) => f.join(';')).join('\r\n');
    const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finanzas_${periodo}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportarPDF() {
    const ordenados = [...movimientosFiltrados].sort(
      (a, b) => a.fecha.localeCompare(b.fecha) || (a.creado_en || '').localeCompare(b.creado_en || '')
    );
    const totalIngresos = ordenados.filter((m) => m.tipo === 'ingreso').reduce((a, m) => a + Number(m.monto), 0);
    const totalEgresos = ordenados.filter((m) => m.tipo === 'egreso').reduce((a, m) => a + Number(m.monto), 0);
    await descargarPDF({
      titulo: `Finanzas — ${negocio.nombre}`,
      subtitulo: `Período: ${periodo}`,
      encabezados: ['Fecha', 'Día', 'Categoría', 'Ingreso (Gs.)', 'Egreso (Gs.)', 'Notas', 'Origen', 'Cargado por'],
      filas: ordenados.map((m) => [
        fechaDDMMYYYY(m.fecha),
        nombreDiaISO(m.fecha),
        etiquetaCategoria(m.categoria),
        m.tipo === 'ingreso' ? Number(m.monto).toLocaleString('es-PY') : '',
        m.tipo === 'egreso' ? Number(m.monto).toLocaleString('es-PY') : '',
        m.notas || '',
        m.origen === 'manual' ? 'Cargado a mano' : 'Automático',
        nombreDeUsuario(m.registrado_por),
      ]),
      totales: ['TOTAL', `${ordenados.length} mov.`, '', totalIngresos.toLocaleString('es-PY'), totalEgresos.toLocaleString('es-PY'), '', '', ''],
      columnasNumericas: [3, 4],
      nombreArchivo: `finanzas_${periodo}_${new Date().toISOString().slice(0, 10)}.pdf`,
    });
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
      <div className="flex flex-wrap items-center gap-2 overflow-x-auto pb-1">
        {PERIODOS.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setPeriodo(p.id);
              setRangoCustom({ desde: '', hasta: '' });
            }}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium ${
              !usaRangoCustom && periodo === p.id ? 'bg-accent text-accent-ink' : 'bg-surface text-muted'
            }`}
          >
            {p.label}
          </button>
        ))}

        {esEscritorio && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted">o</span>
            <input
              type="date"
              value={rangoCustom.desde}
              onChange={(e) => setRangoCustom((r) => ({ ...r, desde: e.target.value }))}
              className="rounded-full border border-line bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:ring-2 focus:ring-accent"
            />
            <span className="text-xs text-muted">a</span>
            <input
              type="date"
              value={rangoCustom.hasta}
              onChange={(e) => setRangoCustom((r) => ({ ...r, hasta: e.target.value }))}
              className="rounded-full border border-line bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:ring-2 focus:ring-accent"
            />
            {usaRangoCustom && (
              <button
                onClick={() => setRangoCustom({ desde: '', hasta: '' })}
                title="Limpiar rango"
                className="rounded-full bg-surface p-1.5 text-muted"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-3">
        <MetricPill
          label="Ingresos"
          value={formatoGsCompacto(ingresos)}
          tone="accent"
          compact
          delta={anterior ? calcularDelta(ingresos, anterior.ingresos) : null}
        />
        <MetricPill
          label="Egresos"
          value={formatoGsCompacto(egresos)}
          tone="danger"
          compact
          delta={anterior ? calcularDelta(-egresos, -anterior.egresos) : null}
        />
        <MetricPill
          label="Neto"
          value={formatoGsCompacto(neto)}
          tone={neto >= 0 ? 'accent' : 'danger'}
          compact
          delta={anterior ? calcularDelta(neto, anterior.neto) : null}
        />
      </div>

      {/* ---- Tendencia del período (solo escritorio, ancho completo):
           una barra por día = el NETO de ese día (verde arriba de la
           línea = ganó, rojo abajo = perdió) — de un vistazo se ve si
           el período viene mejorando o empeorando, no solo el total. ---- */}
      {esEscritorio && tendenciaDiaria.length > 1 && (
        <div className="rounded-2xl bg-surface p-4 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Tendencia del período</p>
              <p className="mt-0.5 text-sm">
                <span className={netoTendencia >= 0 ? 'text-accent' : 'text-danger'}>
                  Neto {formatoGsCompacto(netoTendencia)}
                </span>
                {anterior &&
                  (() => {
                    const d = calcularDelta(netoTendencia, anterior.neto);
                    return d ? (
                      <span className={`ml-1.5 text-xs ${d.positivo ? 'text-accent' : 'text-danger'}`}>· {d.texto}</span>
                    ) : null;
                  })()}
              </p>
            </div>
            <button
              onClick={exportarTendenciaCSV}
              className="flex shrink-0 items-center gap-1 text-xs font-medium text-accent"
            >
              <Download size={12} /> Descargar CSV
            </button>
          </div>

          <div className="mt-4 flex h-48 gap-0.5">
            {tendenciaDiaria.map((d) => {
              const neto = d.ingresos - d.egresos;
              const pct = Math.min((Math.abs(neto) / maxTendencia) * 100, 100);
              const mostrarValor = tendenciaDiaria.length <= 14;
              return (
                <div key={d.fecha} className="flex flex-1 flex-col items-center">
                  <div className="flex h-1/2 w-full flex-col items-center justify-end">
                    {neto >= 0 && (
                      <>
                        {mostrarValor && neto > 0 && (
                          <span className="mb-0.5 whitespace-nowrap text-[10px] font-medium text-accent">
                            {formatoGsCompacto(neto)}
                          </span>
                        )}
                        <div
                          className="w-4/5 rounded-t bg-accent"
                          style={{ height: `${Math.max(pct, neto > 0 ? 4 : 0)}%` }}
                          title={`${d.fecha}: neto ${neto.toLocaleString('es-PY')} (ingresos ${d.ingresos.toLocaleString('es-PY')}, egresos ${d.egresos.toLocaleString('es-PY')})`}
                        />
                      </>
                    )}
                  </div>
                  <div className="h-px w-full bg-line" />
                  <div className="flex h-1/2 w-full flex-col items-center">
                    {neto < 0 && (
                      <>
                        <div
                          className="w-4/5 rounded-b bg-danger"
                          style={{ height: `${Math.max(pct, 4)}%` }}
                          title={`${d.fecha}: neto ${neto.toLocaleString('es-PY')} (ingresos ${d.ingresos.toLocaleString('es-PY')}, egresos ${d.egresos.toLocaleString('es-PY')})`}
                        />
                        {mostrarValor && (
                          <span className="mt-0.5 whitespace-nowrap text-[10px] font-medium text-danger">
                            {formatoGsCompacto(neto)}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <span className="mt-1.5 text-[10px] text-muted">{d.fecha.slice(8, 10)}</span>
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex items-center gap-3 text-[10px] text-muted">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-accent" /> Día con ganancia
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-danger" /> Día con pérdida
            </span>
          </div>
        </div>
      )}

      {/* ---- Secciones reutilizables: se arman una sola vez y se
           renderizan en un orden distinto según el tamaño (ver más
           abajo) — en celular, en una sola columna en el orden de
           siempre; en escritorio, en 2 columnas con la derecha fija
           (position: sticky) para que no se pierda de vista al bajar
           por una tabla de Movimientos larga. ---- */}
      {(() => {
        const seccionProyectado = proyectado &&
          (proyectado.porCobrarReservas > 0 || proyectado.porCobrarCreditos > 0 || proyectado.porPagarFijos > 0) && (
            <div key="proyectado" className="space-y-1.5 rounded-xl bg-surface p-3 shadow-card">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Lo que se viene</p>
              {proyectado.porCobrarReservas > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Pedidos reservados por cobrar</span>
                  <span className="font-mono text-accent">+ {formatoGsCompacto(proyectado.porCobrarReservas)}</span>
                </div>
              )}
              {proyectado.porCobrarCreditos > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Créditos por cobrar</span>
                  <span className="font-mono text-accent">+ {formatoGsCompacto(proyectado.porCobrarCreditos)}</span>
                </div>
              )}
              {proyectado.porPagarFijos > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted">Gastos fijos sin confirmar este mes</span>
                  <span className="font-mono text-danger">− {formatoGsCompacto(proyectado.porPagarFijos)}</span>
                </div>
              )}
            </div>
          );

        const seccionBotonCargar = (
          <button
            key="boton-cargar"
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
        );

        const seccionGastosFijosComponente = (
          <div key="gastos-fijos-comp">
            <GastosFijos negocioId={negocio.id} onCambio={cargarPendientes} />
          </div>
        );

        const seccionGastosFijosDelMes = pendientes && pendientes.gastosFijos.length > 0 && (
          <div key="gastos-fijos-mes" className="space-y-2">
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
        );

        const seccionCargandoOVacio = (
          <div key="cargando-o-vacio">
            {cargando && <p className="pt-4 text-center text-sm text-muted">Cargando…</p>}
            {!cargando && porCategoria.length === 0 && (
              <p className="pt-4 text-center text-sm text-muted">
                Sin movimientos en este período. Los ingresos aparecen solos cuando se cobra una venta o se completa un
                turno.
              </p>
            )}
          </div>
        );

        const seccionCategorias = porCategoria.length > 0 && (
          <div key="categorias" className="space-y-1.5 rounded-xl bg-surface p-2 shadow-card">
            {porCategoria.map(({ tipo, categoria, monto }) => {
              const activo = filtroCategoria?.tipo === tipo && filtroCategoria?.categoria === categoria;
              return (
                <div
                  key={`${tipo}:${categoria}`}
                  onClick={esEscritorio ? () => toggleFiltroCategoria(tipo, categoria) : undefined}
                  title={esEscritorio ? 'Filtrar Movimientos por esta categoría' : undefined}
                  className={`flex items-center justify-between rounded-lg px-2.5 py-2 ${
                    esEscritorio ? 'cursor-pointer' : ''
                  } ${activo ? 'bg-accent-soft' : ''}`}
                >
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
              );
            })}
          </div>
        );

        const seccionDesglosePagos = desglosePagos.length > 0 && (
          <div key="desglose-pagos" className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Por método de pago</p>
            <div className="space-y-1.5 rounded-xl bg-surface p-2 shadow-card">
              {desglosePagos.map((d) => (
                <div key={d.metodo} className="flex items-center justify-between rounded-lg px-2.5 py-2">
                  <span className="text-sm text-ink">{METODOS_PAGO_LABEL[d.metodo] || d.metodo}</span>
                  <span className="font-mono text-sm text-accent">Gs. {d.monto.toLocaleString('es-PY')}</span>
                </div>
              ))}
            </div>
          </div>
        );

        const seccionTopVendidos = (topProductos.length > 0 || topServicios.length > 0) && (
          <div key="top-vendidos" className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Lo más vendido</p>
            <div className="space-y-1.5 rounded-xl bg-surface p-2 shadow-card">
              {topProductos.map((p, i) => (
                <div key={`prod-${p.nombre}`} className="flex items-center justify-between rounded-lg px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    {i === 0 && <Trophy size={14} className="shrink-0 text-amber" />}
                    <span className="text-sm text-ink">{p.nombre}</span>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-muted">{p.cantidad} vendidos</span>
                </div>
              ))}
              {topServicios.map((s, i) => (
                <div key={`serv-${s.nombre}`} className="flex items-center justify-between rounded-lg px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    {i === 0 && topProductos.length === 0 && <Trophy size={14} className="shrink-0 text-amber" />}
                    <span className="text-sm text-ink">{s.nombre}</span>
                  </div>
                  <span className="shrink-0 font-mono text-xs text-muted">{s.cantidad} turnos</span>
                </div>
              ))}
            </div>
          </div>
        );

        const seccionMovimientos = movimientos.length > 0 && (
          <div key="movimientos" className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Movimientos</p>
                {esEscritorio && filtroCategoria && (
                  <button
                    onClick={() => setFiltroCategoria(null)}
                    className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent"
                  >
                    {etiquetaCategoria(filtroCategoria.categoria)} <X size={10} />
                  </button>
                )}
              </div>
              <button onClick={exportarCSV} className="flex items-center gap-1 text-xs font-medium text-accent">
                <Download size={12} /> Exportar CSV
              </button>
              {esEscritorio && (
                <button onClick={exportarPDF} className="flex items-center gap-1 text-xs font-medium text-accent">
                  <Download size={12} /> Exportar PDF
                </button>
              )}
            </div>

            {esEscritorio && movimientosFiltrados.length === 0 && (
              <p className="pt-2 text-center text-xs text-muted">Ningún movimiento con ese filtro.</p>
            )}

            {!esEscritorio && (
              <div className="max-h-96 space-y-1.5 overflow-y-auto rounded-xl bg-surface p-2 shadow-card">
                {movimientosFiltrados.map((m) => (
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
                        {new Intl.DateTimeFormat('es-PY', {
                          timeZone: 'America/Asuncion',
                          day: '2-digit',
                          month: '2-digit',
                        }).format(new Date(m.fecha))}
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
            )}

            {esEscritorio && movimientosFiltrados.length > 0 && (
              <div className="overflow-hidden rounded-2xl bg-surface shadow-card">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs font-medium uppercase tracking-wide text-muted">
                      <th className="px-4 py-3">Fecha</th>
                      <th className="px-4 py-3">Categoría</th>
                      <th className="px-4 py-3">Notas</th>
                      <th className="px-4 py-3 text-right">Monto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {movimientosFiltrados.map((m) => (
                      <tr
                        key={m.id}
                        onClick={() => {
                          setMovimientoAbierto(m);
                          setComprobanteUrlDetalle(null);
                        }}
                        className="cursor-pointer hover:bg-surface2"
                      >
                      <td className="px-4 py-3 text-muted">
                        {new Intl.DateTimeFormat('es-PY', {
                          timeZone: 'America/Asuncion',
                          day: '2-digit',
                          month: '2-digit',
                        }).format(new Date(m.fecha))}
                      </td>
                      <td className="px-4 py-3 text-ink">
                        <div className="flex items-center gap-1.5">
                          {etiquetaCategoria(m.categoria)}
                          {m.comprobante_url && <Paperclip size={12} className="shrink-0 text-muted" />}
                        </div>
                      </td>
                      <td className="max-w-xs truncate px-4 py-3 text-muted">{m.notas || '—'}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        <span className={m.tipo === 'ingreso' ? 'text-accent' : 'text-danger'}>
                          {m.tipo === 'ingreso' ? '+' : '−'} Gs. {Number(m.monto).toLocaleString('es-PY')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );

      return (
        <>
          {!esEscritorio && (
            <div className="space-y-4">
              {seccionProyectado}
              {seccionBotonCargar}
              {seccionGastosFijosComponente}
              {seccionGastosFijosDelMes}
              {seccionCargandoOVacio}
              {seccionCategorias}
              {seccionTopVendidos}
              {seccionMovimientos}
            </div>
          )}

          {esEscritorio && (
            <div className="grid items-start gap-6" style={{ gridTemplateColumns: '1fr 340px' }}>
              <div className="space-y-4">
                {seccionCargandoOVacio}
                {seccionCategorias}
                {seccionDesglosePagos}
                {seccionMovimientos}
              </div>
              {/* Columna fija: no baja con el resto mientras la tabla de
                  Movimientos es más alta que la pantalla. */}
              <div className="space-y-4" style={{ position: 'sticky', top: '1rem' }}>
                {seccionProyectado}
                {seccionBotonCargar}
                {seccionGastosFijosComponente}
                {seccionGastosFijosDelMes}
                {seccionTopVendidos}
              </div>
            </div>
          )}
        </>
      );
      })()}

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
                onWheel={(e) => e.currentTarget.blur()}
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
