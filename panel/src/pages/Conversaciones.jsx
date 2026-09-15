import { useEffect, useState } from 'react';
import { MessageCircle, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useRealtimeTick } from '../lib/realtime';

// Pantalla nueva, solo de escritorio (ver feedback-asadmin-movil-congelado):
// en celular las conversaciones que necesitan a una persona ya se ven como
// alerta en "Hoy" (ConversacionAlerta) — esto es la bandeja completa, con
// TODAS las conversaciones (no solo las derivadas) y el hilo al lado en
// vez de en un modal, porque hay ancho de sobra para las dos cosas juntas.
// Responder sigue siendo por WhatsApp de verdad (el bot y el envío de
// mensajes no viven en este panel) — el botón de abajo abre wa.me.

const ESTADO_LABEL = { bot: 'Bot', derivado_humano: 'Necesita respuesta' };
const ESTADO_TONO = { bot: 'bg-surface2 text-muted', derivado_humano: 'bg-amber-soft text-amber' };

function horaTexto(fecha) {
  return new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(fecha));
}

export default function Conversaciones() {
  const { negocio } = useAuth();
  const [conversaciones, setConversaciones] = useState([]);
  const [previews, setPreviews] = useState({});
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState('todas'); // 'todas' | 'derivado_humano'
  const [busqueda, setBusqueda] = useState('');
  const [seleccionada, setSeleccionada] = useState(null);
  const [mensajes, setMensajes] = useState([]);
  const [cargandoMensajes, setCargandoMensajes] = useState(false);

  const tick = useRealtimeTick('conversaciones', negocio?.id);

  useEffect(() => {
    if (!negocio) return;
    cargar();
  }, [negocio, tick]);

  useEffect(() => {
    if (seleccionada) cargarMensajes(seleccionada.id);
  }, [seleccionada?.id, tick]);

  async function cargar() {
    setCargando(true);
    const { data } = await supabase
      .from('conversaciones')
      .select('*, cliente:clientes(nombre, telefono)')
      .eq('negocio_id', negocio.id)
      .order('ultima_actividad', { ascending: false })
      .limit(150);
    const lista = data || [];
    setConversaciones(lista);
    setCargando(false);
    cargarPreviews(lista.map((c) => c.id));
  }

  // Último mensaje de cada conversación, para mostrar un adelanto en la
  // lista (como cualquier bandeja) — una sola consulta para todas en vez
  // de una por conversación.
  async function cargarPreviews(ids) {
    if (ids.length === 0) {
      setPreviews({});
      return;
    }
    const { data } = await supabase
      .from('mensajes')
      .select('conversacion_id, contenido, tipo, creado_en')
      .in('conversacion_id', ids)
      .order('creado_en', { ascending: false })
      .limit(500);
    const mapa = {};
    for (const m of data || []) {
      if (!mapa[m.conversacion_id]) mapa[m.conversacion_id] = m;
    }
    setPreviews(mapa);
  }

  async function cargarMensajes(id) {
    setCargandoMensajes(true);
    const { data } = await supabase
      .from('mensajes')
      .select('*')
      .eq('conversacion_id', id)
      .order('creado_en', { ascending: true })
      .limit(200);
    setMensajes(data || []);
    setCargandoMensajes(false);
  }

  async function marcarResuelta(c) {
    await supabase.from('conversaciones').update({ estado: 'bot' }).eq('id', c.id);
    setSeleccionada((prev) => (prev?.id === c.id ? { ...prev, estado: 'bot' } : prev));
  }

  const filtradas = conversaciones
    .filter((c) => (filtro === 'todas' ? true : c.estado === 'derivado_humano'))
    .filter((c) => !busqueda.trim() || (c.cliente?.nombre || '').toLowerCase().includes(busqueda.toLowerCase()));

  const necesitanRespuesta = conversaciones.filter((c) => c.estado === 'derivado_humano').length;

  return (
    <div className="space-y-4">
      <p className="font-display text-xl text-ink">Conversaciones</p>

      <div className="grid items-start gap-4" style={{ gridTemplateColumns: '380px 1fr' }}>
        <div className="space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => setFiltro('todas')}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                filtro === 'todas' ? 'bg-accent text-accent-ink' : 'bg-surface2 text-muted'
              }`}
            >
              Todas
            </button>
            <button
              onClick={() => setFiltro('derivado_humano')}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                filtro === 'derivado_humano' ? 'bg-accent text-accent-ink' : 'bg-surface2 text-muted'
              }`}
            >
              Necesitan respuesta{necesitanRespuesta > 0 ? ` (${necesitanRespuesta})` : ''}
            </button>
          </div>

          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              placeholder="Buscar cliente…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div className="max-h-[65vh] space-y-1.5 overflow-y-auto">
            {cargando && <p className="pt-6 text-center text-sm text-muted">Cargando…</p>}

            {!cargando && filtradas.length === 0 && (
              <p className="pt-6 text-center text-sm text-muted">
                {busqueda || filtro === 'derivado_humano'
                  ? 'No hay conversaciones que coincidan.'
                  : 'Todavía no hay conversaciones registradas.'}
              </p>
            )}

            {filtradas.map((c) => {
              const preview = previews[c.id];
              const alta = c.prioridad === 'alta';
              const activa = seleccionada?.id === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setSeleccionada(c)}
                  className={`w-full rounded-xl p-3 text-left shadow-card ${activa ? 'bg-accent-soft' : 'bg-surface'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-ink">{c.cliente?.nombre || 'Un cliente'}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${ESTADO_TONO[c.estado]}`}>
                      {ESTADO_LABEL[c.estado]}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {preview ? preview.contenido || `[${preview.tipo}]` : 'Sin mensajes'}
                  </p>
                  <p className="mt-1 text-[10px] text-muted">
                    {horaTexto(c.ultima_actividad)}
                    {alta && <span className="text-danger"> · Prioridad alta</span>}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          {seleccionada ? (
            <HiloConversacion
              conversacion={seleccionada}
              mensajes={mensajes}
              cargando={cargandoMensajes}
              onMarcarResuelta={() => marcarResuelta(seleccionada)}
            />
          ) : (
            <div className="flex h-[65vh] flex-col items-center justify-center rounded-2xl bg-surface text-center shadow-card">
              <MessageCircle size={22} className="text-muted" />
              <p className="mt-2 text-sm text-muted">Elegí una conversación de la lista para ver el historial.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HiloConversacion({ conversacion, mensajes, cargando, onMarcarResuelta }) {
  return (
    <div className="flex h-[65vh] flex-col rounded-2xl bg-surface shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-line p-4">
        <div className="min-w-0">
          <p className="truncate font-display text-lg text-ink">{conversacion.cliente?.nombre || 'Un cliente'}</p>
          <p className="text-xs text-muted">
            {conversacion.cliente?.telefono} · {conversacion.canal === 'whatsapp' ? 'WhatsApp' : 'Voz'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${ESTADO_TONO[conversacion.estado]}`}>
            {ESTADO_LABEL[conversacion.estado]}
          </span>
          {conversacion.estado === 'derivado_humano' && (
            <button
              onClick={onMarcarResuelta}
              className="rounded-lg bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent"
            >
              Marcar como respondida
            </button>
          )}
        </div>
      </div>

      {cargando && <p className="flex-1 pt-10 text-center text-sm text-muted">Cargando…</p>}

      {!cargando && mensajes.length === 0 && (
        <p className="flex-1 pt-10 text-center text-sm text-muted">Sin mensajes registrados todavía.</p>
      )}

      {!cargando && mensajes.length > 0 && (
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {mensajes.map((m) => {
            const esCliente = m.remitente === 'cliente';
            return (
              <div key={m.id} className={`flex ${esCliente ? 'justify-start' : 'justify-end'}`}>
                <div
                  className={`max-w-[70%] rounded-2xl px-3 py-2 text-sm ${
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

      <div className="border-t border-line p-3">
        <a
          href={`https://wa.me/${conversacion.cliente?.telefono}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-xl bg-accent py-2.5 text-sm font-medium text-accent-ink"
        >
          <MessageCircle size={16} /> Abrir en WhatsApp
        </a>
      </div>
    </div>
  );
}
