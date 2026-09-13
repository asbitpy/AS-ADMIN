import { useState } from 'react';
import { MessageCircle, ChevronRight } from 'lucide-react';
import HistorialConversacion from './HistorialConversacion';

export default function ConversacionAlerta({ conversacion }) {
  const [abierto, setAbierto] = useState(false);
  const alta = conversacion.prioridad === 'alta';

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left ${alta ? 'bg-danger-soft' : 'bg-amber-soft'}`}
      >
        <MessageCircle size={15} className={`shrink-0 ${alta ? 'text-danger' : 'text-amber'}`} />
        <span className={`flex-1 truncate text-xs font-medium ${alta ? 'text-danger' : 'text-amber'}`}>
          {conversacion.cliente?.nombre || 'Un cliente'} está esperando respuesta
          {alta ? ' — prioridad alta' : ''}
        </span>
        <ChevronRight size={14} className={`shrink-0 ${alta ? 'text-danger' : 'text-amber'}`} />
      </button>

      {abierto && <HistorialConversacion conversacion={conversacion} onCerrar={() => setAbierto(false)} />}
    </>
  );
}
