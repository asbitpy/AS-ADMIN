import { MessageCircle } from 'lucide-react';

export default function ConversacionAlerta({ conversacion }) {
  const alta = conversacion.prioridad === 'alta';

  return (
    <a
      href={`https://wa.me/${conversacion.cliente?.telefono}`}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center gap-3 rounded-2xl p-3 shadow-card ${
        alta ? 'bg-danger-soft' : 'bg-surface'
      }`}
    >
      <span className={`rounded-full p-2 ${alta ? 'bg-danger/15' : 'bg-accent-soft'}`}>
        <MessageCircle size={18} className={alta ? 'text-danger' : 'text-accent'} />
      </span>
      <div className="flex-1">
        <p className="text-sm font-medium text-ink">{conversacion.cliente?.nombre || 'Cliente'}</p>
        <p className="text-xs text-muted">{alta ? 'Necesita atención — prioridad alta' : 'Esperando respuesta'}</p>
      </div>
    </a>
  );
}
