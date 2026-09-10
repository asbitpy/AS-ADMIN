import { MessageCircle, ChevronRight } from 'lucide-react';

export default function ConversacionAlerta({ conversacion }) {
  const alta = conversacion.prioridad === 'alta';

  return (
    <a
      href={`https://wa.me/${conversacion.cliente?.telefono}`}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center gap-2 rounded-xl px-3 py-2.5 ${alta ? 'bg-danger-soft' : 'bg-amber-soft'}`}
    >
      <MessageCircle size={15} className={`shrink-0 ${alta ? 'text-danger' : 'text-amber'}`} />
      <span className={`flex-1 truncate text-xs font-medium ${alta ? 'text-danger' : 'text-amber'}`}>
        {conversacion.cliente?.nombre || 'Un cliente'} está esperando respuesta
        {alta ? ' — prioridad alta' : ''}
      </span>
      <ChevronRight size={14} className={`shrink-0 ${alta ? 'text-danger' : 'text-amber'}`} />
    </a>
  );
}
