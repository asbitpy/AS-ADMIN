// Canal del dueño: cuando el dueño le escribe al MISMO número de
// WhatsApp del negocio (identificado por negocios.config.telefono_dueno),
// el bot lo trata distinto a un cliente — acá solo entiende comandos de
// reposición de stock (Etapa 4 del bot retail). No crea cliente ni
// conversación: esto no es atención al cliente, es un canal interno de
// administración, así que nunca pasa por el clasificador de intenciones
// de clientes ni por flujoAgendar/flujoPedido.

const supabase = require('./supabase');
const { sendText } = require('./whatsapp');
const { clasificarComandoDueno } = require('./claude');
const flujoReposicion = require('./flujoReposicion');

// Dedup liviano en memoria: alcanza para este canal (un solo remitente
// por negocio, bajo volumen) y evita procesar dos veces un reintento de
// Meta sin necesitar una tabla propia — a diferencia del canal de
// clientes, que sí guarda todo en 'mensajes'.
const vistos = new Set();
function yaVisto(waMessageId) {
  if (!waMessageId) return false;
  if (vistos.has(waMessageId)) return true;
  vistos.add(waMessageId);
  if (vistos.size > 1000) {
    vistos.delete(vistos.values().next().value);
  }
  return false;
}

function esSaludoSimple(texto) {
  return /^(hola|buenas|buen día|buen dia|buenas tardes|buenas noches|hey|holi)[\s!.]*$/i.test(
    (texto || '').trim()
  );
}

/** true si quien escribe es el número personal cargado como dueño de este negocio. */
function esMensajeDelDueno(msg, negocio) {
  const telefonoDueno = negocio.config?.telefono_dueno;
  if (!telefonoDueno) return false;
  const soloDigitos = (s) => (s || '').replace(/\D/g, '');
  return soloDigitos(msg.from) === soloDigitos(telefonoDueno);
}

async function manejarMensajeDueno(msg, negocio) {
  if (yaVisto(msg.waMessageId)) return;

  const entrada = msg.interactiveReplyId || msg.templateButtonPayload || msg.text;
  if (!entrada) {
    return sendText(negocio.wa, msg.from, 'Por ahora solo entiendo texto acá para cargar stock 🙏');
  }

  // ¿Es un botón/paso de la reposición en curso? (sin gastar una llamada a Claude)
  if (/^(rprod_|rvar_|repo_)/.test(entrada)) {
    const manejado = await flujoReposicion.continuar({ entrada, negocio, to: msg.from });
    if (manejado) return;
  }

  if (negocio.contexto_admin?.paso) {
    const manejado = await flujoReposicion.continuar({ entrada, negocio, to: msg.from });
    if (manejado) return;
  }

  if (esSaludoSimple(entrada)) {
    return sendText(
      negocio.wa,
      msg.from,
      'Hola 👋 Decime qué producto repusiste y cuánto (ej. "cargá 20 de buzo negro L") y te lo sumo al stock.'
    );
  }

  const { data: productos } = await supabase
    .from('productos')
    .select('id, nombre')
    .eq('negocio_id', negocio.id)
    .eq('activo', true);

  const clasificacion = await clasificarComandoDueno({ mensaje: entrada, negocio, productos: productos || [] });

  if (clasificacion.intencion === 'reponer_stock') {
    const datos = clasificacion.datos_extraidos || {};
    return flujoReposicion.iniciar({
      negocio,
      to: msg.from,
      productoNombre: datos.producto || null,
      varianteTexto: datos.variante || null,
      cantidad: datos.cantidad ? Number(datos.cantidad) : null,
    });
  }

  return sendText(
    negocio.wa,
    msg.from,
    'No te entendí — decime qué producto repusiste y cuántas unidades entraron.'
  );
}

module.exports = { esMensajeDelDueno, manejarMensajeDueno };
