import EstadoBadge from './EstadoBadge';

function fechaHoraTexto(fecha) {
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(fecha));
}

export default function TurnoCard({ turno, onCambiarEstado }) {
  const puedeGestionar = ['pendiente', 'confirmado'].includes(turno.estado);

  return (
    <div className="rounded-2xl bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium text-ink">{turno.cliente?.nombre || 'Cliente'}</p>
          <p className="text-sm text-muted">
            {turno.servicio?.nombre}
            {turno.profesional?.nombre ? ` · ${turno.profesional.nombre}` : ''}
          </p>
          <p className="mt-1 font-mono text-xs text-muted">{fechaHoraTexto(turno.fecha_hora)}</p>
        </div>
        <EstadoBadge estado={turno.estado} />
      </div>

      {puedeGestionar && (
        <div className="mt-3 flex gap-2 border-t border-line pt-3">
          <button
            onClick={() => onCambiarEstado(turno.id, 'completado')}
            className="flex-1 rounded-lg bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent active:scale-[0.98]"
          >
            Marcar atendido
          </button>
          <button
            onClick={() => onCambiarEstado(turno.id, 'no_show')}
            className="flex-1 rounded-lg bg-amber-soft px-3 py-1.5 text-xs font-medium text-amber active:scale-[0.98]"
          >
            No vino
          </button>
          <button
            onClick={() => onCambiarEstado(turno.id, 'cancelado')}
            className="flex-1 rounded-lg bg-danger-soft px-3 py-1.5 text-xs font-medium text-danger active:scale-[0.98]"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
