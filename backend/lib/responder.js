// Toda respuesta del bot pasa por acá: se envía por WhatsApp Y se guarda
// en la tabla mensajes, así el historial del panel siempre está completo.
//
// El primer parámetro (`wa`) son las credenciales del negocio que
// responde — cada negocio contesta desde su propio número.

const supabase = require('./supabase');
const { sendText, sendButtons, sendList } = require('./whatsapp');

async function registrar(conversacionId, contenido, intencion = null) {
  await supabase.from('mensajes').insert({
    conversacion_id: conversacionId,
    remitente: 'bot',
    tipo: 'texto',
    contenido,
    intencion_detectada: intencion,
  });
}

async function responderTexto(wa, conversacionId, to, texto, intencion = null) {
  await sendText(wa, to, texto);
  await registrar(conversacionId, texto, intencion);
}

async function responderBotones(wa, conversacionId, to, texto, botones, intencion = null) {
  await sendButtons(wa, to, texto, botones);
  await registrar(conversacionId, texto, intencion);
}

async function responderLista(wa, conversacionId, to, texto, botonTitulo, rows, intencion = null) {
  await sendList(wa, to, texto, botonTitulo, rows);
  await registrar(conversacionId, texto, intencion);
}

module.exports = { responderTexto, responderBotones, responderLista };
