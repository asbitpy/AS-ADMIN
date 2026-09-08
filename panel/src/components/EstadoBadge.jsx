const ESTILOS = {
  pendiente: 'bg-amber-soft text-amber',
  confirmado: 'bg-accent-soft text-accent',
  reprogramado: 'bg-amber-soft text-amber',
  cancelado: 'bg-danger-soft text-danger',
  completado: 'bg-accent-soft text-accent',
  no_show: 'bg-danger-soft text-danger',
};

const ETIQUETAS = {
  pendiente: 'Sin responder',
  confirmado: 'Confirmado',
  reprogramado: 'Reprogramado',
  cancelado: 'Cancelado',
  completado: 'Completado',
  no_show: 'No vino',
};

export default function EstadoBadge({ estado }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        ESTILOS[estado] || 'bg-line text-muted'
      }`}
    >
      {ETIQUETAS[estado] || estado}
    </span>
  );
}
