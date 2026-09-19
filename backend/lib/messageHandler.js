const supabase = require('./supabase');
const { parseIncomingMessage, sendTemplate, sendText } = require('./whatsapp');
const { clasificarIntencion } = require('./claude');
const { credencialesDeNegocio } = require('./credenciales');
const { responderTexto, responderBotones, responderLista } = require('./responder');
const respuestas = require('./respuestas');
const flujoAgendar = require('./flujoAgendar');
const flujoPedido = require('./flujoPedido');
const flujoListaEspera = require('./flujoListaEspera');
const { esMensajeDelDueno, manejarMensajeDueno } = require('./dueno');
const { formatearFranjaLarga } = require('./agenda');

const MOTIVO_DERIVACION = {
  contenido_medico: 'Mencionó un tema médico',
  reclamo: 'Parece un reclamo',
  hablar_con_humano: 'Pidió hablar con alguien',
};

// Para no repetir el mismo warning cada vez que se deriva una conversación.
const avisadosSinPlantilla = new Set();

// Entradas que se resuelven SIN llamar a Claude (eficiencia: los botones
// ya traen la intención codificada en su id).
const MAPA_DETERMINISTICO = {
  menu_agendar: 'agendar_turno',
  menu_precios: 'ver_precios',
  menu_catalogo: 'ver_catalogo',
  menu_ubicacion: 'ver_ubicacion',
  menu_humano: 'hablar_con_humano',
  rec_confirmo: 'confirmar_turno',
  rec_reprogramar: 'reprogramar_turno',
  rec_cancelar: 'cancelar_turno',
};

async function handleIncomingMessage(rawBody) {
  const msg = parseIncomingMessage(rawBody);
  if (!msg) return; // evento de estado (entregado/leído), no un mensaje

  let negocio;
  try {
    negocio = await obtenerNegocioPorNumero(msg.phoneNumberId);
  } catch (err) {
    // No podemos avisarle nada al cliente acá: todavía no sabemos con
    // qué negocio/credenciales responderle. Al menos lo dejamos bien
    // identificado en el log en vez de que se pierda en el catch
    // genérico de server.js.
    console.error(`Error resolviendo negocio para phone_number_id=${msg.phoneNumberId}:`, err);
    return;
  }
  if (!negocio) {
    console.warn(`Mensaje para un phone_number_id no configurado: ${msg.phoneNumberId}`);
    return;
  }

  // El dueño le puede escribir al mismo número para avisar que repuso
  // stock — no es un cliente, así que no crea cliente/conversación ni
  // pasa por el clasificador de intenciones de clientes. Mismo criterio
  // de respaldo que abajo, por si Claude o Supabase fallan acá también.
  if (esMensajeDelDueno(msg, negocio)) {
    try {
      await manejarMensajeDueno(msg, negocio);
    } catch (err) {
      console.error(`Error procesando mensaje del dueño (negocio ${negocio.id}):`, err);
      try {
        await sendText(negocio.wa, msg.from, 'Uy, tuve un problema procesando eso 🙏 Probá de nuevo en un momento.');
      } catch (errFallback) {
        console.error('Además falló el mensaje de respaldo:', errFallback);
      }
    }
    return;
  }

  // Red de seguridad: si Claude, Supabase, o cualquier otra cosa falla
  // en el medio, el cliente no se queda sin ninguna respuesta (antes,
  // un error acá se tragaba en silencio en el catch del webhook y el
  // cliente nunca se enteraba de nada).
  try {
    await procesarMensajeCliente(msg, negocio);
  } catch (err) {
    console.error(`Error procesando mensaje de ${msg.from} (negocio ${negocio.id}):`, err);
    try {
      await sendText(
        negocio.wa,
        msg.from,
        'Uy, tuve un problema para responderte 🙏 Dame un momento y probá de nuevo, o escribime "hablar con alguien" si es urgente.'
      );
    } catch (errFallback) {
      console.error('Además falló el mensaje de respaldo:', errFallback);
    }
  }
}

// Cuánto esperamos, sin mensajes nuevos del mismo cliente, antes de
// procesar un texto libre. Si en el medio llega otro mensaje, se suma al
// mismo lote y el reloj arranca de nuevo — así "Hola" seguido de "quiero
// consultar" se entienden como un solo pedido en vez de dos respuestas
// separadas y descoordinadas.
const DEBOUNCE_TEXTO_LIBRE_MS = 15000;
// Tope: aunque el cliente siga escribiendo, se responde como máximo a los
// 60s del primer mensaje y se juntan a lo sumo 10 mensajes (si no, uno que
// escribe cada 14s nunca recibía respuesta y el prompt crecía sin límite).
const DEBOUNCE_MAX_ESPERA_MS = 60000;
const DEBOUNCE_MAX_MENSAJES = 10;
// conversacion.id -> { entradas, negocio, cliente, esNueva, to, timer }
const buffersPendientes = new Map();

function bufferizarYProgramar({ negocio, cliente, conversacion, esNueva, entrada, to }) {
  const existente = buffersPendientes.get(conversacion.id);
  if (existente) {
    if (existente.entradas.length < DEBOUNCE_MAX_MENSAJES) existente.entradas.push(entrada);
    clearTimeout(existente.timer);
    const yaEsperado = Date.now() - existente.inicio;
    const espera =
      existente.entradas.length >= DEBOUNCE_MAX_MENSAJES
        ? 0
        : Math.max(0, Math.min(DEBOUNCE_TEXTO_LIBRE_MS, DEBOUNCE_MAX_ESPERA_MS - yaEsperado));
    existente.timer = setTimeout(() => dispararBuffer(conversacion.id), espera);
    return;
  }

  buffersPendientes.set(conversacion.id, {
    entradas: [entrada],
    inicio: Date.now(),
    negocio,
    cliente,
    esNueva,
    to,
    timer: setTimeout(() => dispararBuffer(conversacion.id), DEBOUNCE_TEXTO_LIBRE_MS),
  });
}

async function dispararBuffer(conversacionId) {
  const pendiente = buffersPendientes.get(conversacionId);
  if (!pendiente) return;
  buffersPendientes.delete(conversacionId);

  const { negocio, cliente, esNueva, to } = pendiente;
  const entradaCombinada = pendiente.entradas.join('\n');

  try {
    // Volvemos a traer la conversación: pudieron pasar hasta 15s, y algo
    // (una derivación a humano, por ejemplo) pudo haber cambiado su estado.
    const { data: conversacion } = await supabase.from('conversaciones').select('*').eq('id', conversacionId).maybeSingle();
    if (!conversacion || conversacion.estado === 'derivado_humano') return;
    await enrutarEntrada({ entrada: entradaCombinada, negocio, cliente, conversacion, esNueva, to });
  } catch (err) {
    console.error(`Error procesando mensajes acumulados de ${to} (negocio ${negocio.id}):`, err);
    try {
      await sendText(
        negocio.wa,
        to,
        'Uy, tuve un problema para responderte 🙏 Dame un momento y probá de nuevo, o escribime "hablar con alguien" si es urgente.'
      );
    } catch (errFallback) {
      console.error('Además falló el mensaje de respaldo:', errFallback);
    }
  }
}

async function procesarMensajeCliente(msg, negocio) {
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
    await derivarAHumano({ negocio, cliente, conversacionId: conversacion.id, prioridad: 'normal', motivo: 'Envió un archivo que el bot no puede leer' });
    return;
  }

  // Solo acumulamos texto ESCRITO sin un flujo guiado en curso: un click
  // de botón/lista es una acción puntual que hay que responder al toque,
  // y un paso de flujo (ej. "3" para cantidad) espera una entrada puntual
  // que no tiene sentido mezclar con otro mensaje. El texto libre "suelto"
  // (saludo, pregunta, pedido) es justo el caso donde mensajes seguidos
  // del cliente se leen mejor juntos que por separado — y de paso, al
  // procesarlos en un solo lote, dos mensajes rápidos ya no compiten en
  // paralelo por escribir conversaciones.contexto.
  const esTextoLibre = !msg.interactiveReplyId && !msg.templateButtonPayload;
  const flujoEnCurso = !!conversacion.contexto?.flujo;
  if (esTextoLibre && !flujoEnCurso) {
    bufferizarYProgramar({ negocio, cliente, conversacion, esNueva, entrada, to: msg.from });
    return;
  }

  const esBoton = !!(msg.interactiveReplyId || msg.templateButtonPayload);
  await enrutarEntrada({ entrada, negocio, cliente, conversacion, esNueva, to: msg.from, esBoton });
}

// esBoton: la entrada viene del id de un botón/lista. Un texto ESCRITO que
// casualmente diga "var_<id>" o "menu_agendar" no se toma como botón: si
// no, un cliente podía disparar pasos de flujo con ids inventados.
async function enrutarEntrada({ entrada, negocio, cliente, conversacion, esNueva, to, esBoton = false }) {
  // Conversación nueva y el mensaje es un simple saludo: bienvenida directa,
  // sin gastar una llamada al clasificador.
  if (esNueva && esSaludoSimple(entrada)) {
    return enviarMenuBienvenida(negocio, conversacion, to);
  }

  // 1) ¿La entrada es un botón con intención codificada? (sin Claude)
  let intencion = esBoton ? MAPA_DETERMINISTICO[entrada] || null : null;
  let clasificacion = null;
  // Si el paso 3 ya trajo el catálogo para clasificar, lo reusamos más
  // abajo (ver_catalogo/consultar_stock) en vez de repetir la consulta.
  let productosYaCargados = null;

  // 2) ¿Es una respuesta de un paso de un flujo guiado en curso? (sin Claude)
  if (esBoton && !intencion && /^(serv_|franja_|pq_|le_|prof_)/.test(entrada)) {
    const manejado = await flujoAgendar.continuar({
      entrada,
      clasificacion: null,
      negocio,
      cliente,
      conversacion,
      to,
    });
    if (manejado) return;
  }
  if (esBoton && !intencion && /^(prod_|var_|pedido_)/.test(entrada)) {
    const manejado = await flujoPedido.continuar({
      entrada,
      clasificacion: null,
      negocio,
      cliente,
      conversacion,
      to,
    });
    if (manejado) return;
  }
  if (esBoton && !intencion && /^oferta_/.test(entrada)) {
    const manejado = await flujoListaEspera.continuar({ entrada, negocio, conversacion, to });
    if (manejado) return;
  }

  // 3) Texto libre: clasificamos con Claude (una sola llamada por mensaje,
  //    aunque 'entrada' venga de varios mensajes acumulados).
  if (!intencion) {
    const modulos = negocio.modulos_activos || ['agenda'];
    // Las tres consultas son independientes entre sí — en paralelo en vez
    // de una tras otra, para no sumarle latencia extra antes de llegar a
    // la llamada (ya de por sí lenta) al clasificador.
    const [servicios, productos, historial] = await Promise.all([
      modulos.includes('agenda') ? obtenerServicios(negocio.id) : [],
      modulos.includes('pos') ? obtenerProductos(negocio.id) : [],
      obtenerUltimosMensajes(conversacion.id, 6),
    ]);
    // Solo la guardamos si realmente se consultó (módulo 'pos' activo) —
    // si no, productos quedó en [] por el gate de arriba, y no queremos
    // que un ver_catalogo/consultar_stock posterior confunda ese [] con
    // "ya lo cargué, no hay nada" en vez de ir a buscarlo de verdad.
    if (modulos.includes('pos')) productosYaCargados = productos;
    clasificacion = await clasificarIntencion({
      mensaje: entrada,
      negocio,
      servicios,
      productos,
      historialReciente: historial,
    });
    intencion = clasificacion.intencion;
  }

  // 4) Escapes que cortan cualquier flujo en curso.
  if (['contenido_medico', 'reclamo', 'hablar_con_humano'].includes(intencion)) {
    await flujoAgendar.limpiar(conversacion.id); // limpia el contexto, sea cual sea el flujo activo
    await derivarAHumano({
      negocio,
      cliente,
      conversacionId: conversacion.id,
      prioridad: intencion === 'reclamo' ? 'alta' : 'normal',
      motivo: MOTIVO_DERIVACION[intencion],
    });
    return responderTexto(negocio.wa, conversacion.id, to, respuestas.mensajeDerivadoHumano(), intencion);
  }

  // 5) Si hay un flujo en curso, dejamos que lo continúe con el texto libre
  //    (ej. el cliente escribe su nombre, "¿tenés el jueves?", o un número
  //    de unidades en el flujo de pedido).
  if (conversacion.contexto?.flujo === 'agendar') {
    const manejado = await flujoAgendar.continuar({
      entrada,
      clasificacion,
      negocio,
      cliente,
      conversacion,
      to,
    });
    if (manejado) return;
  } else if (conversacion.contexto?.flujo === 'pedido') {
    const manejado = await flujoPedido.continuar({
      entrada,
      clasificacion,
      negocio,
      cliente,
      conversacion,
      to,
    });
    if (manejado) return;
  }

  // 6) Acciones de nivel de menú.
  switch (intencion) {
    case 'saludo':
      return enviarMenuBienvenida(negocio, conversacion, to);

    case 'agendar_turno':
      return flujoAgendar.iniciar({ negocio, conversacion, to });

    case 'ver_precios': {
      const servicios = await obtenerServicios(negocio.id);
      return responderTexto(negocio.wa, conversacion.id, to, respuestas.mensajePrecios(servicios), intencion);
    }

    case 'ver_ubicacion':
      return responderTexto(negocio.wa, conversacion.id, to, respuestas.mensajeUbicacion(negocio), intencion);

    case 'confirmar_turno':
    case 'cancelar_turno':
    case 'reprogramar_turno':
      return gestionarTurnoExistente({ intencion, negocio, cliente, conversacion, to });

    case 'ver_catalogo': {
      const productos = productosYaCargados || (await obtenerProductos(negocio.id));
      return responderTexto(negocio.wa, conversacion.id, to, respuestas.mensajeCatalogo(productos), intencion);
    }

    case 'consultar_stock':
      return responderConsultaStock({
        negocio,
        conversacion,
        to,
        datos: clasificacion?.datos_extraidos || {},
        productos: productosYaCargados,
      });

    case 'hacer_pedido': {
      const datos = clasificacion?.datos_extraidos || {};
      return flujoPedido.iniciar({
        negocio,
        conversacion,
        to,
        productoNombre: datos.producto || null,
        varianteTexto: datos.variante || null,
      });
    }

    case 'cancelar_pedido':
      return cancelarPedidoExistente({ negocio, cliente, conversacion, to });

    default:
      return responderTexto(negocio.wa, conversacion.id, to, respuestas.mensajeNoEntendido(), 'no_entendido');
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
    // Si ofrecer el lugar liberado falla, la cancelación ya está hecha:
    // no puede terminar en "tuve un problema" ni pedir cancelar de nuevo.
    try {
      await flujoListaEspera.ofrecerFranjaLiberada({
        negocio,
        servicioId: turno.servicio_id,
        ts: new Date(turno.fecha_hora).getTime(),
      });
    } catch (err) {
      console.error('No se pudo ofrecer el turno liberado a la lista de espera:', err);
    }
    return responderTexto(negocio.wa, conversacion.id, to, respuestas.turnoCancelado(), intencion);
  }

  // reprogramar_turno
  return flujoAgendar.iniciar({ negocio, conversacion, to, turnoAReprogramar: turno });
}

// --------------------------------------------------------------------
// Retail: consulta de stock
// --------------------------------------------------------------------

async function responderConsultaStock({ negocio, conversacion, to, datos, productos: productosPreCargados = null }) {
  const productos = productosPreCargados || (await obtenerProductos(negocio.id));
  const producto = productos.find((p) => p.nombre.toLowerCase() === (datos.producto || '').toLowerCase());

  if (!producto) {
    return responderTexto(negocio.wa, conversacion.id, to, respuestas.productoNoEncontrado(), 'consultar_stock');
  }

  if (!producto.tiene_variantes) {
    await responderTexto(negocio.wa, conversacion.id, to, respuestas.mensajeStockSinVariantes(producto), 'consultar_stock');
    if (producto.stock > 0) {
      await flujoPedido.ofrecerApartar({ negocio, conversacion, to, productoId: producto.id, varianteId: null });
    }
    return;
  }

  const { data: variantes } = await supabase
    .from('variantes_producto')
    .select('*')
    .eq('producto_id', producto.id)
    .eq('activo', true);

  const variantesDisponibles = variantes || [];
  const variantePedida = (datos.variante || '').toLowerCase().trim();

  const match = variantePedida
    ? variantesDisponibles.find(
        (v) =>
          v.atributo1_valor?.toLowerCase() === variantePedida || v.atributo2_valor?.toLowerCase() === variantePedida
      )
    : null;

  if (match) {
    await responderTexto(negocio.wa, conversacion.id, to, respuestas.mensajeStockVariante(producto, match), 'consultar_stock');
    if (match.stock > 0) {
      await flujoPedido.ofrecerApartar({ negocio, conversacion, to, productoId: producto.id, varianteId: match.id });
    }
    return;
  }

  // No especificó variante, o la que pidió no existe: le mostramos las
  // opciones como lista interactiva — un clic ya deja armado el pedido.
  return flujoPedido.ofrecerVariantes({ negocio, conversacion, to, producto, variantes: variantesDisponibles });
}

// --------------------------------------------------------------------
// Retail: cancelar un pedido reservado
// --------------------------------------------------------------------

async function cancelarPedidoExistente({ negocio, cliente, conversacion, to }) {
  const { data: venta } = await supabase
    .from('ventas')
    .select('id')
    .eq('negocio_id', negocio.id)
    .eq('cliente_id', cliente.id)
    .eq('estado', 'reservada')
    .order('creado_en', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!venta) {
    return responderTexto(negocio.wa, conversacion.id, to, 'No encontré ningún pedido tuyo pendiente de retiro 🤔', 'cancelar_pedido');
  }

  const { error } = await supabase.rpc('fn_cancelar_reserva', {
    p_venta_id: venta.id,
    p_motivo: 'Cliente canceló por WhatsApp',
  });

  if (error) {
    console.error('Error cancelando reserva:', error);
    return responderTexto(negocio.wa, conversacion.id, to, 'Uy, tuve un problema cancelándolo. Ya le aviso al equipo 🙏', 'cancelar_pedido');
  }

  return responderTexto(negocio.wa, conversacion.id, to, 'Listo, cancelé tu pedido. ¡Gracias por avisar! 🙌', 'cancelar_pedido');
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
  const modulos = negocio.modulos_activos || ['agenda'];
  const opciones = [];

  if (modulos.includes('agenda')) {
    opciones.push({ id: 'menu_agendar', title: '📅 Agendar turno' });
  }
  if (modulos.includes('pos')) {
    opciones.push({ id: 'menu_catalogo', title: '🛍️ Ver productos' });
  }
  if (modulos.includes('agenda')) {
    opciones.push({ id: 'menu_precios', title: '💰 Precios y servicios' });
  }
  opciones.push({ id: 'menu_ubicacion', title: '📍 Ubicación y horarios' });
  opciones.push({ id: 'menu_humano', title: '🙋 Hablar con alguien' });

  return responderLista(
    negocio.wa,
    conversacion.id,
    to,
    respuestas.mensajeBienvenida(negocio),
    'Ver opciones',
    opciones,
    'bienvenida'
  );
}

async function derivarAHumano({ negocio, cliente, conversacionId, prioridad, motivo }) {
  await supabase
    .from('conversaciones')
    .update({ estado: 'derivado_humano', prioridad })
    .eq('id', conversacionId);

  const telefonoDueno = negocio.config?.telefono_dueno;
  if (!telefonoDueno) return; // sin número cargado, no hay a quién avisarle

  const nombrePlantilla = negocio.wa?.templates?.derivacionHumano;
  if (!nombrePlantilla) {
    if (!avisadosSinPlantilla.has(negocio.id)) {
      avisadosSinPlantilla.add(negocio.id);
      console.warn(`Derivación a humano: el negocio ${negocio.id} no tiene plantilla "derivacionHumano" configurada — no se avisa.`);
    }
    return;
  }

  const nombreCliente = cliente?.nombre && cliente.nombre !== 'Sin nombre' ? cliente.nombre : 'Un cliente';
  try {
    await sendTemplate(negocio.wa, telefonoDueno, nombrePlantilla, [nombreCliente, motivo || 'Necesita ayuda']);
  } catch (err) {
    // Si falla avisarle al dueño, igual queremos que el cliente reciba su
    // mensaje de "te conectamos con alguien" (lo manda quien llama a
    // esta función, después) en vez de perderse en el catch genérico.
    console.error(`Error avisando al dueño de la derivación (negocio ${negocio.id}):`, err);
  }
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

async function obtenerProductos(negocioId) {
  const { data } = await supabase
    .from('productos')
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
