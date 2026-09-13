import { useEffect, useState } from 'react';
import { X, MessageCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

function horaTexto(fecha) {
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(fecha));
}

// Historial de mensajes de una conversación derivada — se ve dentro del
// panel en vez de tener que abrir WhatsApp directo para saber de qué se
// trata. Responder sigue siendo por WhatsApp (el botón de abajo).
export default function HistorialConversacion({ conversacion, onCerrar }) {
  const [mensajes, setMensajes] = useState([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    cargar();
  }, [conversacion.id]);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from('mensajes')
      .select('*')
      .eq('conversacion_id', conversacion.id)
      .order('creado_en', { ascending: true })
      .limit(200);
    setMensajes(data || []);
    setCargando(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onCerrar}>
      <div
        className="mx-auto flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-surface p-5 pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="truncate font-display text-lg text-ink">{conversacion.cliente?.nombre || 'Un cliente'}</p>
            <p className="text-xs text-muted">{conversacion.cliente?.telefono}</p>
          </div>
          <button onClick={onCerrar} className="shrink-0 text-muted">
            <X size={20} />
          </button>
        </div>

        {cargando && <p className="pt-6 text-center text-sm text-muted">Cargando…</p>}

        {!cargando && mensajes.length === 0 && (
          <p className="pt-6 text-center text-sm text-muted">Sin mensajes registrados todavía.</p>
        )}

        {!cargando && mensajes.length > 0 && (
          <div className="mt-3 flex-1 space-y-2 overflow-y-auto">
            {mensajes.map((m) => {
              const esCliente = m.remitente === 'cliente';
              return (
                <div key={m.id} className={`flex ${esCliente ? 'justify-start' : 'justify-end'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      esCliente ? 'bg-base text-ink' : 'bg-accent-soft text-ink'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.contenido || `[${m.tipo}]`}</p>
                    <p className="mt-1 text-[10px] text-muted">{horaTexto(m.creado_en)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <a
          href={`https://wa.me/${conversacion.cliente?.telefono}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-accent py-3 text-sm font-medium text-accent-ink"
        >
          <MessageCircle size={16} /> Abrir en WhatsApp
        </a>
      </div>
    </div>
  );
}
