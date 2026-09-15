import { useEffect, useState } from 'react';
import { Lock, Unlock, Plus, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useRealtimeTick } from '../lib/realtime';

function horaTexto(fecha) {
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(fecha));
}

const CATEGORIAS_GASTO = [
  { id: 'gasto', label: 'Gasto' },
  { id: 'retiro', label: 'Retiro' },
];

/**
 * Muestra el estado de la caja y maneja apertura/cierre/gastos.
 * No bloquea la venta si la caja está cerrada — solo lo recomienda —
 * para no meterle fricción a un negocio chico que todavía no quiere
 * llevar arqueo formal.
 */
export default function CajaBar({ negocioId, onSesionActualizada }) {
  const [sesion, setSesion] = useState(null);
  const [totales, setTotales] = useState({ ingresos: 0, egresos: 0 });
  const [cargando, setCargando] = useState(true);
  const [vista, setVista] = useState('barra'); // 'barra' | 'apertura' | 'cierre' | 'gasto'

  const [montoInicial, setMontoInicial] = useState('');
  const [montoReal, setMontoReal] = useState('');
  const [notasCierre, setNotasCierre] = useState('');

  const [gastoMonto, setGastoMonto] = useState('');
  const [gastoCategoria, setGastoCategoria] = useState('gasto');
  const [gastoNota, setGastoNota] = useState('');

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  // Si otro cajero abre o cierra la caja desde su propio celular, esta
  // barra se entera sola — importante para no pisarse entre dos personas
  // del mismo mostrador.
  const tickCaja = useRealtimeTick('caja_sesiones', negocioId);

  useEffect(() => {
    if (!negocioId) return;
    cargarSesion();
  }, [negocioId, tickCaja]);

  async function cargarSesion() {
    setCargando(true);
    const { data } = await supabase
      .from('caja_sesiones')
      .select('*')
      .eq('negocio_id', negocioId)
      .eq('estado', 'abierta')
      .order('abierta_en', { ascending: false })
      .limit(1)
      .maybeSingle();

    setSesion(data);
    onSesionActualizada?.(data);
    if (data) await cargarTotales(data.id);
    setCargando(false);
  }

  async function cargarTotales(sesionId) {
    const { data } = await supabase
      .from('movimientos_financieros')
      .select('tipo, monto')
      .eq('caja_sesion_id', sesionId);

    const ingresos = (data || []).filter((m) => m.tipo === 'ingreso').reduce((a, m) => a + Number(m.monto), 0);
    const egresos = (data || []).filter((m) => m.tipo === 'egreso').reduce((a, m) => a + Number(m.monto), 0);
    setTotales({ ingresos, egresos });
    return { ingresos, egresos };
  }

  async function abrirCaja(e) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const { data, error: err } = await supabase
        .from('caja_sesiones')
        .insert({
          negocio_id: negocioId,
          usuario_id: userData?.user?.id || null,
          monto_inicial: Number(montoInicial) || 0,
          estado: 'abierta',
        })
        .select()
        .single();
      if (err) throw err;
      setSesion(data);
      onSesionActualizada?.(data);
      setTotales({ ingresos: 0, egresos: 0 });
      setMontoInicial('');
      setVista('barra');
    } catch (err) {
      console.error(err);
      setError('No se pudo abrir la caja. Probá de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  async function registrarGasto(e) {
    e.preventDefault();
    if (!gastoMonto) return;
    setError(null);
    setGuardando(true);
    try {
      const { error: err } = await supabase.from('movimientos_financieros').insert({
        negocio_id: negocioId,
        tipo: 'egreso',
        monto: Number(gastoMonto),
        categoria: gastoCategoria,
        origen: 'manual',
        caja_sesion_id: sesion.id,
        notas: gastoNota || null,
      });
      if (err) throw err;
      await cargarTotales(sesion.id);
      setGastoMonto('');
      setGastoNota('');
      setVista('barra');
    } catch (err) {
      console.error(err);
      setError('No se pudo registrar. Probá de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  const montoEsperado = sesion ? sesion.monto_inicial + totales.ingresos - totales.egresos : 0;
  const diferencia = montoReal !== '' ? Number(montoReal) - montoEsperado : null;

  async function cerrarCaja(e) {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      const { error: err } = await supabase
        .from('caja_sesiones')
        .update({
          cerrada_en: new Date().toISOString(),
          monto_esperado: montoEsperado,
          monto_real: Number(montoReal) || 0,
          diferencia: (Number(montoReal) || 0) - montoEsperado,
          estado: 'cerrada',
          notas: notasCierre || null,
        })
        .eq('id', sesion.id);
      if (err) throw err;
      setSesion(null);
      onSesionActualizada?.(null);
      setMontoReal('');
      setNotasCierre('');
      setVista('barra');
    } catch (err) {
      console.error(err);
      setError('No se pudo cerrar la caja. Probá de nuevo.');
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) return null;

  // --- Barra compacta (siempre visible) ---
  const barra = (
    <div className="flex items-center justify-between rounded-xl bg-surface px-4 py-2.5 shadow-card">
      <div className="flex items-center gap-2">
        {sesion ? <Unlock size={15} className="text-success" /> : <Lock size={15} className="text-muted" />}
        <div>
          <p className="text-xs font-medium text-ink">{sesion ? 'Caja abierta' : 'Caja cerrada'}</p>
          {sesion && <p className="text-[11px] text-muted">Desde las {horaTexto(sesion.abierta_en)}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {sesion && (
          <button
            onClick={() => setVista('gasto')}
            className="flex items-center gap-1 rounded-full bg-amber-soft px-2.5 py-1 text-[11px] font-medium text-amber"
          >
            <Plus size={12} /> Gasto
          </button>
        )}
        <button
          onClick={() => setVista(sesion ? 'cierre' : 'apertura')}
          className="rounded-full bg-accent px-3 py-1.5 text-[11px] font-medium text-accent-ink"
        >
          {sesion ? 'Cerrar caja' : 'Abrir caja'}
        </button>
      </div>
    </div>
  );

  if (vista === 'barra') return barra;

  return (
    <>
      {barra}
      <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={() => setVista('barra')}>
        <div
          className="mx-auto w-full max-w-md rounded-t-2xl bg-surface p-5 pb-8"
          onClick={(e) => e.stopPropagation()}
        >
          {vista === 'apertura' && (
            <form onSubmit={abrirCaja} className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-display text-lg text-ink">Abrir caja</p>
                <button type="button" onClick={() => setVista('barra')} className="text-muted">
                  <X size={20} />
                </button>
              </div>
              <label className="text-xs text-muted">¿Con cuánto efectivo arrancás?</label>
              <input
                type="number"
                autoFocus
                placeholder="Monto inicial (Gs.)"
                value={montoInicial}
                onChange={(e) => setMontoInicial(e.target.value)}
                onWheel={(e) => e.currentTarget.blur()}
                className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
              />
              {error && <p className="text-sm text-danger">{error}</p>}
              <button
                type="submit"
                disabled={guardando}
                className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink disabled:opacity-60"
              >
                {guardando ? 'Abriendo…' : 'Abrir caja'}
              </button>
            </form>
          )}

          {vista === 'gasto' && (
            <form onSubmit={registrarGasto} className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-display text-lg text-ink">Registrar gasto o retiro</p>
                <button type="button" onClick={() => setVista('barra')} className="text-muted">
                  <X size={20} />
                </button>
              </div>
              <div className="flex gap-2">
                {CATEGORIAS_GASTO.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => setGastoCategoria(c.id)}
                    className={`flex-1 rounded-xl py-2 text-xs font-medium ${
                      gastoCategoria === c.id ? 'bg-accent text-accent-ink' : 'bg-base text-muted'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <input
                type="number"
                autoFocus
                placeholder="Monto (Gs.)"
                value={gastoMonto}
                onChange={(e) => setGastoMonto(e.target.value)}
                onWheel={(e) => e.currentTarget.blur()}
                className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
              />
              <input
                placeholder="Motivo (opcional)"
                value={gastoNota}
                onChange={(e) => setGastoNota(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
              />
              {error && <p className="text-sm text-danger">{error}</p>}
              <button
                type="submit"
                disabled={guardando}
                className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink disabled:opacity-60"
              >
                {guardando ? 'Guardando…' : 'Registrar'}
              </button>
            </form>
          )}

          {vista === 'cierre' && (
            <form onSubmit={cerrarCaja} className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-display text-lg text-ink">Cerrar caja — arqueo</p>
                <button type="button" onClick={() => setVista('barra')} className="text-muted">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-1 rounded-xl bg-base p-3 text-sm">
                <div className="flex justify-between text-muted">
                  <span>Caja inicial</span>
                  <span className="font-mono text-ink">Gs. {sesion.monto_inicial.toLocaleString('es-PY')}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>+ Ventas / ingresos</span>
                  <span className="font-mono text-accent">Gs. {totales.ingresos.toLocaleString('es-PY')}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>− Gastos / retiros</span>
                  <span className="font-mono text-danger">Gs. {totales.egresos.toLocaleString('es-PY')}</span>
                </div>
                <div className="mt-1 flex justify-between border-t border-line pt-1 font-medium">
                  <span className="text-ink">Caja esperada</span>
                  <span className="font-mono text-ink">Gs. {montoEsperado.toLocaleString('es-PY')}</span>
                </div>
              </div>

              <label className="text-xs text-muted">¿Cuánto contaste en la caja?</label>
              <input
                type="number"
                autoFocus
                placeholder="Monto real contado (Gs.)"
                value={montoReal}
                onChange={(e) => setMontoReal(e.target.value)}
                onWheel={(e) => e.currentTarget.blur()}
                className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
              />

              {montoReal !== '' && (
                <p className={`text-sm font-medium ${diferencia === 0 ? 'text-accent' : 'text-danger'}`}>
                  {diferencia === 0
                    ? 'Cuadra perfecto ✅'
                    : diferencia > 0
                      ? `Sobran Gs. ${diferencia.toLocaleString('es-PY')}`
                      : `Faltan Gs. ${Math.abs(diferencia).toLocaleString('es-PY')}`}
                </p>
              )}

              <input
                placeholder="Notas (opcional)"
                value={notasCierre}
                onChange={(e) => setNotasCierre(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
              />

              {error && <p className="text-sm text-danger">{error}</p>}
              <button
                type="submit"
                disabled={guardando}
                className="w-full rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink disabled:opacity-60"
              >
                {guardando ? 'Cerrando…' : 'Cerrar caja'}
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
