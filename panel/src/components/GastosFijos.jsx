import { useEffect, useState } from 'react';
import { Repeat, Plus, X, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

const CATEGORIAS = [
  { id: 'alquiler', label: 'Alquiler' },
  { id: 'insumos', label: 'Insumos' },
  { id: 'sueldos', label: 'Sueldos' },
  { id: 'gasto', label: 'Otro gasto' },
];

// Administra las DEFINICIONES de gastos fijos (alquiler, luz, agua...).
// El recordatorio mensual y la confirmación de pago viven en
// Finanzas.jsx — acá solo se da de alta/baja qué gastos fijos existen.
export default function GastosFijos({ negocioId, onCambio }) {
  const [abierto, setAbierto] = useState(false);
  const [lista, setLista] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [nombre, setNombre] = useState('');
  const [categoria, setCategoria] = useState('alquiler');
  const [monto, setMonto] = useState('');
  // Se elige una fecha completa (más natural que tipear un número), pero
  // solo el DÍA se guarda — eso es lo que se repite mes a mes.
  const [fecha, setFecha] = useState(() =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date())
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (abierto) cargar();
  }, [abierto]);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from('gastos_fijos')
      .select('*')
      .eq('negocio_id', negocioId)
      .eq('activo', true)
      .order('dia_mes');
    setLista(data || []);
    setCargando(false);
  }

  async function agregar(e) {
    e.preventDefault();
    setError(null);
    const montoNum = Number(monto);
    // El input type="date" siempre da "YYYY-MM-DD" — se saca el día así,
    // sin pasar por new Date(), para no arriesgar un corrimiento de huso horario.
    const dia = Number(fecha.slice(8, 10));
    if (!nombre.trim()) return setError('Poné un nombre (ej. "Alquiler").');
    if (!montoNum || montoNum <= 0) return setError('Poné un monto válido.');
    if (!fecha || !dia) return setError('Elegí una fecha.');

    setGuardando(true);
    const { error: errInsert } = await supabase.from('gastos_fijos').insert({
      negocio_id: negocioId,
      nombre: nombre.trim(),
      categoria,
      monto_estimado: montoNum,
      dia_mes: dia,
    });
    setGuardando(false);
    if (errInsert) return setError('No se pudo guardar. Probá de nuevo.');

    setNombre('');
    setMonto('');
    cargar();
    onCambio?.();
  }

  async function quitar(id) {
    await supabase.from('gastos_fijos').update({ activo: false }).eq('id', id);
    setLista((prev) => prev.filter((g) => g.id !== id));
    onCambio?.();
  }

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-line py-2.5 text-xs font-medium text-muted"
      >
        <Repeat size={14} /> Gastos fijos mensuales
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={() => setAbierto(false)}>
          <div className="mx-auto w-full max-w-md rounded-t-2xl bg-surface p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-display text-lg text-ink">Gastos fijos mensuales</p>
              <button onClick={() => setAbierto(false)} className="text-muted">
                <X size={20} />
              </button>
            </div>
            <p className="mt-1 text-xs text-muted">
              Definilos una vez — cada mes, en el día que digas, Finanzas te va a recordar confirmarlos cuando los
              pagues (nunca se cargan solos).
            </p>

            {cargando && <p className="pt-4 text-center text-sm text-muted">Cargando…</p>}

            {!cargando && lista.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {lista.map((g) => (
                  <div key={g.id} className="flex items-center justify-between rounded-lg bg-base px-3 py-2">
                    <div>
                      <p className="text-sm text-ink">{g.nombre}</p>
                      <p className="text-xs text-muted">
                        Día {g.dia_mes} · Gs. {Number(g.monto_estimado).toLocaleString('es-PY')}
                      </p>
                    </div>
                    <button onClick={() => quitar(g.id)} className="rounded-full p-1.5 text-muted active:text-danger">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={agregar} className="mt-3 space-y-2 rounded-xl bg-base p-3">
              <input
                placeholder="Nombre (ej. Alquiler)"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
              />
              <div className="flex gap-2">
                <select
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}
                  className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent"
                >
                  {CATEGORIAS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="Gs."
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  onWheel={(e) => e.currentTarget.blur()}
                  className="w-28 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
                />
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  className="w-36 rounded-lg border border-line bg-surface px-2 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <p className="text-[11px] text-muted">
                Se repite todos los meses en ese mismo día — el mes que elijas no importa, solo el día.
              </p>
              {error && <p className="text-xs text-danger">{error}</p>}
              <button
                type="submit"
                disabled={guardando}
                className="flex w-full items-center justify-center gap-1 rounded-lg bg-accent py-2 text-xs font-medium text-accent-ink disabled:opacity-60"
              >
                <Plus size={14} /> {guardando ? 'Guardando…' : 'Agregar gasto fijo'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
