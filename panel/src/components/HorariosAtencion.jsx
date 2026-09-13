import { useEffect, useState } from 'react';
import { Clock, Plus, X, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

// Mismos días que usa el motor de disponibilidad del bot (backend/lib/agenda.js).
const DIAS = [
  { id: 'lun', label: 'Lunes' },
  { id: 'mar', label: 'Martes' },
  { id: 'mie', label: 'Miércoles' },
  { id: 'jue', label: 'Jueves' },
  { id: 'vie', label: 'Viernes' },
  { id: 'sab', label: 'Sábado' },
  { id: 'dom', label: 'Domingo' },
];

function partesBloque(bloque) {
  const [desde, hasta] = bloque.split('-');
  return { desde: desde || '08:00', hasta: hasta || '12:00' };
}

// Edita negocios.config.horarios — el mismo formato que ya lee
// backend/lib/agenda.js para calcular franjas disponibles:
// { "lun": ["08:00-12:00", "15:00-19:00"], ... }. Antes solo se podía
// tocar entrando directo a Supabase.
export default function HorariosAtencion({ negocioId, configActual, onGuardado }) {
  const [abierto, setAbierto] = useState(false);
  const [horarios, setHorarios] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (abierto) setHorarios(configActual?.horarios || {});
  }, [abierto]);

  function agregarBloque(dia) {
    setHorarios((prev) => ({ ...prev, [dia]: [...(prev[dia] || []), '08:00-12:00'] }));
  }

  function quitarBloque(dia, i) {
    setHorarios((prev) => ({ ...prev, [dia]: prev[dia].filter((_, idx) => idx !== i) }));
  }

  function cambiarBloque(dia, i, parte, valor) {
    setHorarios((prev) => {
      const bloques = [...prev[dia]];
      const actuales = partesBloque(bloques[i]);
      const nuevo = { ...actuales, [parte]: valor };
      bloques[i] = `${nuevo.desde}-${nuevo.hasta}`;
      return { ...prev, [dia]: bloques };
    });
  }

  async function guardar() {
    setError(null);
    setGuardando(true);

    // Se relee 'config' justo antes de guardar (no lo que quedó cacheado
    // en el navegador) para no pisar otras claves (telefono_dueno,
    // reserva_horas, etc.) si cambiaron por otro lado mientras tanto.
    const { data: fresco, error: errFetch } = await supabase
      .from('negocios')
      .select('config')
      .eq('id', negocioId)
      .single();

    if (errFetch) {
      setGuardando(false);
      setError('No se pudo guardar. Probá de nuevo.');
      return;
    }

    const { error: errUpdate } = await supabase
      .from('negocios')
      .update({ config: { ...(fresco.config || {}), horarios } })
      .eq('id', negocioId);

    setGuardando(false);
    if (errUpdate) {
      setError('No se pudo guardar. Probá de nuevo.');
      return;
    }

    setAbierto(false);
    onGuardado?.();
  }

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-line py-2.5 text-xs font-medium text-muted"
      >
        <Clock size={14} /> Horarios de atención
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={() => setAbierto(false)}>
          <div
            className="mx-auto flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-surface p-5 pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="font-display text-lg text-ink">Horarios de atención</p>
              <button onClick={() => setAbierto(false)} className="text-muted">
                <X size={20} />
              </button>
            </div>
            <p className="mt-1 text-xs text-muted">
              Un día sin franjas queda cerrado. Podés cargar más de una franja por día (ej. mañana y tarde).
            </p>

            <div className="mt-3 flex-1 space-y-3 overflow-y-auto">
              {DIAS.map((d) => {
                const bloques = horarios[d.id] || [];
                return (
                  <div key={d.id} className="rounded-xl bg-base p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-ink">{d.label}</p>
                      <button
                        type="button"
                        onClick={() => agregarBloque(d.id)}
                        className="flex items-center gap-1 rounded-full bg-accent-soft px-2 py-1 text-[11px] font-medium text-accent"
                      >
                        <Plus size={12} /> Franja
                      </button>
                    </div>

                    {bloques.length === 0 && <p className="mt-1.5 text-xs text-muted">Cerrado</p>}

                    {bloques.length > 0 && (
                      <div className="mt-1.5 space-y-1.5">
                        {bloques.map((bloque, i) => {
                          const { desde, hasta } = partesBloque(bloque);
                          return (
                            <div key={i} className="flex items-center gap-1.5">
                              <input
                                type="time"
                                value={desde}
                                onChange={(e) => cambiarBloque(d.id, i, 'desde', e.target.value)}
                                className="flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:ring-2 focus:ring-accent"
                              />
                              <span className="text-xs text-muted">a</span>
                              <input
                                type="time"
                                value={hasta}
                                onChange={(e) => cambiarBloque(d.id, i, 'hasta', e.target.value)}
                                className="flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink outline-none focus:ring-2 focus:ring-accent"
                              />
                              <button
                                type="button"
                                onClick={() => quitarBloque(d.id, i)}
                                className="shrink-0 rounded-full p-1.5 text-muted active:text-danger"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {error && <p className="mt-2 text-xs text-danger">{error}</p>}

            <button
              onClick={guardar}
              disabled={guardando}
              className="mt-3 w-full rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink disabled:opacity-60"
            >
              {guardando ? 'Guardando…' : 'Guardar horarios'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
