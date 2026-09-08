const supabase = require('./supabase');
const { parseIncomingMessage } = require('./whatsapp');
const { clasificarIntencion } = require('./claude');
const { credencialesDeNegocio } = require('./credenciales');
const { responderTexto, responderBotones, responderLista } = require('./responder');
const respuestas = require('./respuestas');
const flujoAgendar = require('./flujoAgendar');
const { formatearFranjaLarga } = require('./agenda');

// Entradas que se resuelven SIN llamar a Claude (eficiencia: los botones
// ya traen la intención codificada en su id).
const MAPA_DETERMINISTICO = {
  menu_agendar: 'agendar_turno',
  menu_precios: 'ver_precios',
  menu_ubicacion: 'ver_ubicacion',
  menu_humano: 'hablar_con_humano',
  rec_confirmo: 'confirmar_turno',
  rec_reprogramar: 'reprogramar_turno',
  rec_cancelar: 'cancelar_turno',
};

async function handleIncomingMessage(rawBody) {
  const msg = parseIncomingMessage(rawBody);
  if (!msg) return; // evento de estado (entregado/leído), no un mensaje

  const negocio = await obtenerNegocioPorNumero(msg.phoneNumberId);
  if (!negocio) {
    console.warn(`Mensaje para un phone_number_id no configurado: ${msg.phoneNumberId}`);
    return;
  }

  const cliente = await obtenerOCrearCliente(negocio.id, msg.from);
  const { conversacion, esNueva } = await obtenerOCrearConversacion(negocio.id, cliente.id);

  const entrada = msg.interactiveReplyId || msg.templateButtonPayload || msg.text;

  // Guardamos el mensaje entrante. Si el wa_message_id ya existe, es un
  // reintento de Meta: cortamos acá y no procesamos dos veces.
  const { error: errInsert } = await supabase.from('mensajes').insert({
    conversacion_id: conversacion.id,
    remitente: 'cliente',
    tipo: msg.type === 'text' ? 'texto' : msg.type,
    contenido: entrada || `[${msg.type}]`,
    wa_message_id: msg.waMessageId,
  });
  if (errInsert?.code === '23505') return; // duplicado: ya lo procesamos

  await supabase
    .from('conversaciones')
    .update({ ultima_actividad: new Date().toISOString() })
    .eq('id', conversacion.id);

  // Si la conversación ya está con un humano, el bot no interviene.
  if (conversacion.estado === 'derivado_humano') return;

  // Imágenes/audio/video: flujo aparte (Módulo A del addendum v3).
  if (!entrada) {
    // TODO Fase 4: clasificarImagen() con visión de Claude / transcribir audio
    await responderTexto(negocio.wa, conversacion.id, msg.from, 'Recibí tu archivo 🙌 Se lo paso al equipo.');
    await derivarAHumano(conversacion.id, 'normal');
    return;
  }

  // Conversación nueva y el mensaje es un simple saludo: bienvenida directa,
  // sin gastar una llamada al clasificador.
  if (esNueva && esSaludoSimple(entrada)) {
    return enviarMenuBienvenida(negocio, conversacion, msg.from);
  }

  // 1) ¿La entrada es un botón con intención codificada? (sin Claude)
  let intencion = MAPA_DETERMINISTICO[entrada] || null;
  let clasificacion = null;

  // 2) ¿Es una respuesta de un paso del flujo de agendado? (sin Claude)
  if (!intencion && /^(serv_|franja_|pq_|le_)/.test(entrada)) {
    const manejado = await flujoAgendar.continuar({
      entrada,
      clasificacion: null,
      negocio,
      cliente,
      conversacion,
      to: msg.from,
    });
    if (manejado) return;
  }

  // 3) Texto libre: clasificamos con Claude (una sola llamada por mensaje).
  if (!intencion) {
    const servicios = await obtenerServicios(negocio.id);
    const historial = await obtenerUltimosMensajes(conversacion.id, 6);
    clasificacion = await clasificarIntencion({
      mensaje: entrada,
      negocio,
      servicios,
      historialReciente: historial,
    });
    intencion = clasificacion.intencion;
  }

  // 4) Escapes que cortan cualquier flujo en curso.
  if (['contenido_medico', 'reclamo', 'hablar_con_humano'].includes(intencion)) {
    await flujoAgendar.limpiar(conversacion.id);
    await derivarAHumano(conversacion.id, intencion === 'reclamo' ? 'alta' : 'normal');
    return responderTexto(negocio.wa, conversacion.id, msg.from, respuestas.mensajeDerivadoHumano(), intencion);
  }

  // 5) Si hay un flujo en curso, dejamos que lo continúe con el texto libre
  //    (ej. el cliente escribe su nombre, o "¿tenés el jueves?").
  if (conversacion.contexto?.flujo) {
    const manejado = await flujoAgendar.continuar({
      entrada,
      clasificacion,
      negocio,
      cliente,
      conversacion,
      to: msg.from,
    });
    if (manejado) return;
  }

  // 6) Acciones de nivel de menú.
  switch (intencion) {
    case 'saludo':
      return enviarMenuBienvenida(negocio, conversacion, msg.from);

    case 'agendar_turno':
      return flujoAgendar.iniciar({ negocio, conversacion, to: msg.from });

    case 'ver_precios': {
      const servicios = await obtenerServicios(negocio.id);
      return responderTexto(negocio.wa, conversacion.id, msg.from, respuestas.mensajePrecios(servicios), intencion);
    }

    case 'ver_ubicacion':
      return responderTexto(negocio.wa, conversacion.id, msg.from, respuestas.mensajeUbicacion(negocio), intencion);

    case 'confirmar_turno':
    case 'cancelar_turno':
    case 'reprogramar_turno':
      return gestionarTurnoExistente({ intencion, negocio, cliente, conversacion, to: msg.from });

    default:
      return responderTexto(negocio.wa, conversacion.id, msg.from, respuestas.mensajeNoEntendido(), 'no_entendido');
  }
}

// --------------------------------------------------------------------
// Acciones sobre turnos existentes (respuestas a recordatorios, etc.)
// --------------------------------------------------------------------

async function gestionarTurnoExistente({ intencion, negocio, cliente, conversacion, to }) {
  const { data: turno } = await supabase
    .from('turnos')
    .select('*')
    .eq('negocio_id', negocio.id)
    .eq('cliente_id', cliente.id)
    .in('estado', ['pendiente', 'confirmado'])
    .gte('fecha_hora', new Date().toISOString())
    .order('fecha_hora', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!turno) {
    return responderBotones(negocio.wa, conversacion.id, to, respuestas.sinTurnoProximo(), [
      { id: 'menu_agendar', title: '📅 Agendar turno' },
    ]);
  }

  const fechaTexto = formatearFranjaLarga(new Date(turno.fecha_hora).getTime());

  if (intencion === 'confirmar_turno') {
    await supabase.from('turnos').update({ estado: 'confirmado' }).eq('id', turno.id);
    return responderTexto(negocio.wa, conversacion.id, to, respuestas.turnoConfirmadoOk(fechaTexto), intencion);
  }

  if (intencion === 'cancelar_turno') {
    await supabase.from('turnos').update({ estado: 'cancelado' }).eq('id', turno.id);
    // TODO: ofrecer la franja liberada al primero de lista_espera
    return responderTexto(negocio.wa, conversacion.id, to, respuestas.turnoCancelado(), intencion);
  }

  // reprogramar_turno
  return flujoAgendar.iniciar({ negocio, conversacion, to, turnoAReprogramar: turno });
}

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

function esSaludoSimple(texto) {
  return /^(hola|buenas|buen día|buen dia|buenas tardes|buenas noches|hey|holi)[\s!.]*$/i.test(
    (texto || '').trim()
  );
}

async function enviarMenuBienvenida(negocio, conversacion, to) {
  return responderLista(
    negocio.wa,
    conversacion.id,
    to,
    respuestas.mensajeBienvenida(negocio),
    'Ver opciones',
    [
      { id: 'menu_agendar', title: '📅 Agendar turno' },
      { id: 'menu_precios', title: '💰 Precios y servicios' },
      { id: 'menu_ubicacion', title: '📍 Ubicación y horarios' },
      { id: 'menu_humano', title: '🙋 Hablar con alguien' },
    ],
    'bienvenida'
  );
}

async function derivarAHumano(conversacionId, prioridad) {
  await supabase
    .from('conversaciones')
    .update({ estado: 'derivado_humano', prioridad })
    .eq('id', conversacionId);
  // TODO: notificación push/email al dueño (se conecta con el panel)
}

async function obtenerNegocioPorNumero(phoneNumberId) {
  const { data: negocio } = await supabase
    .from('negocios')
    .select('*')
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .eq('activo', true)
    .maybeSingle();

  if (!negocio) return null;

  // Con qué número y token responde este negocio. Se resuelve una sola
  // vez por mensaje y viaja adentro del negocio hasta cada envío.
  negocio.wa = await credencialesDeNegocio(negocio);
  return negocio;
}

async function obtenerServicios(negocioId) {
  const { data } = await supabase
    .from('servicios')
    .select('*')
    .eq('negocio_id', negocioId)
    .eq('activo', true);
  return data || [];
}

async function obtenerOCrearCliente(negocioId, telefono) {
  const { data: existente } = await supabase
    .from('clientes')
    .select('*')
    .eq('negocio_id', negocioId)
    .eq('telefono', telefono)
    .maybeSingle();

  if (existente) return existente;

  const { data: nuevo } = await supabase
    .from('clientes')
    .insert({ negocio_id: negocioId, telefono, nombre: 'Sin nombre' })
    .select()
    .single();

  return nuevo;
}

async function obtenerOCrearConversacion(negocioId, clienteId) {
  const { data: existente } = await supabase
    .from('conversaciones')
    .select('*')
    .eq('negocio_id', negocioId)
    .eq('cliente_id', clienteId)
    .order('ultima_actividad', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Si la última conversación tiene más de 24hs sin actividad, abrimos una
  // nueva: así el saludo de bienvenida vuelve a salir naturalmente.
  const vencida =
    existente && Date.now() - new Date(existente.ultima_actividad).getTime() > 24 * 3600000;

  if (existente && !vencida) return { conversacion: existente, esNueva: false };

  const { data: nueva } = await supabase
    .from('conversaciones')
    .insert({ negocio_id: negocioId, cliente_id: clienteId })
    .select()
    .single();

  return { conversacion: nueva, esNueva: true };
}

async function obtenerUltimosMensajes(conversacionId, cantidad) {
  const { data } = await supabase
    .from('mensajes')
    .select('remitente, contenido')
    .eq('conversacion_id', conversacionId)
    .order('creado_en', { ascending: false })
    .limit(cantidad);

  return (data || [])
    .reverse()
    .map((m) => ({
      role: m.remitente === 'cliente' ? 'user' : 'assistant',
      content: m.contenido || '',
    }));
}

module.exports = { handleIncomingMessage };
