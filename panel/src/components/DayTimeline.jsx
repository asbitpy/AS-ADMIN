import { useEffect, useMemo, useState } from 'react';
import EstadoBadge from './EstadoBadge';

const ALTURA_HORA = 64; // px por hora
const GAP_MINIMO = 52; // separación mínima entre tarjetas apiladas

/** Hora decimal (ej. 14.5 = 14:30) en huso horario de Paraguay, sin
 * importar en qué huso esté el navegador del dueño. */
function horaDecimalPy(fecha) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Asuncion',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(fecha);
  const h = Number(partes.find((p) => p.type === 'hour').value);
  const m = Number(partes.find((p) => p.type === 'minute').value);
  return h + m / 60;
}

function horaTexto(fecha) {
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(fecha);
}

export default function DayTimeline({ turnos, rangoInicio = 7, rangoFin = 20 }) {
  const [ahora, setAhora] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const alturaTotal = (rangoFin - rangoInicio) * ALTURA_HORA;
  const horas = useMemo(
    () => Array.from({ length: rangoFin - rangoInicio + 1 }, (_, i) => rangoInicio + i),
    [rangoInicio, rangoFin]
  );

  const items = useMemo(() => {
    const ordenados = [...turnos]
      .map((t) => ({ ...t, _hd: horaDecimalPy(new Date(t.fecha_hora)) }))
      .sort((a, b) => a._hd - b._hd);

    let ultimoTop = -Infinity;
    return ordenados.map((t) => {
      let top = (t._hd - rangoInicio) * ALTURA_HORA;
      if (top < ultimoTop + GAP_MINIMO) top = ultimoTop + GAP_MINIMO;
      ultimoTop = top;
      return { ...t, top };
    });
  }, [turnos, rangoInicio]);

  const horaDecimalAhora = horaDecimalPy(ahora);
  const mostrarAhora = horaDecimalAhora >= rangoInicio && horaDecimalAhora <= rangoFin;
  const topAhora = (horaDecimalAhora - rangoInicio) * ALTURA_HORA;

  return (
    <div className="relative rounded-2xl bg-surface p-4 shadow-card">
      <div className="relative pl-14" style={{ height: alturaTotal + 24 }}>
        {/* Espina vertical */}
        <div className="absolute left-11 top-0 h-full w-px bg-line" />

        {/* Marcas de hora */}
        {horas.map((h) => (
          <div
            key={h}
            className="absolute left-0 -translate-y-1/2 font-mono text-[11px] text-muted"
            style={{ top: (h - rangoInicio) * ALTURA_HORA }}
          >
            {String(h).padStart(2, '0')}:00
          </div>
        ))}

        {/* Indicador "estás acá" */}
        {mostrarAhora && (
          <div className="absolute left-11 right-0 flex items-center gap-2" style={{ top: topAhora }}>
            <span className="h-2.5 w-2.5 -translate-x-1/2 animate-pulse rounded-full bg-danger" />
            <span className="border-t border-dashed border-danger/50 flex-1" />
            <span className="rounded-full bg-danger px-2 py-0.5 font-mono text-[10px] text-white">
              {horaTexto(ahora)}
            </span>
          </div>
        )}

        {/* Turnos */}
        {items.length === 0 && (
          <p className="pt-2 text-sm text-muted">Sin turnos agendados para hoy todavía.</p>
        )}
        {items.map((t) => (
          <div
            key={t.id}
            className="absolute left-6 right-0 flex items-center gap-3"
            style={{ top: t.top }}
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
            <div className="flex flex-1 items-center justify-between rounded-xl border border-line bg-base/60 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-ink">{t.cliente?.nombre || 'Cliente'}</p>
                <p className="text-xs text-muted">{t.servicio?.nombre}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted">{horaTexto(new Date(t.fecha_hora))}</span>
                <EstadoBadge estado={t.estado} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
