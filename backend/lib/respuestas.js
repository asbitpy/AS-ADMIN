// Plantillas fijas — nunca generadas libremente por la IA.
// Esto garantiza que un precio, una ubicación o una confirmación de turno
// nunca salgan "inventados" por el modelo.

function mensajeBienvenida(negocio) {
  return `¡Hola! 👋 Soy el asistente de ${negocio.nombre}.\n¿En qué te puedo ayudar?`;
}

function mensajePrecios(servicios) {
  if (!servicios.length) return 'Todavía no tengo la lista de precios cargada, ya le aviso al equipo que te la pase 🙌';
  const lineas = servicios.map(
    (s) => `🔹 ${s.nombre} - Gs. ${Number(s.precio).toLocaleString('es-PY')}`
  );
  return `Estos son nuestros servicios:\n\n${lineas.join('\n')}\n\n¿Querés agendar alguno?`;
}

function mensajeUbicacion(negocio) {
  const horarios = negocio.config?.horarios_texto || 'consultanos el horario';
  return `📍 Estamos en ${negocio.direccion}\n🕐 ${horarios}\n\n${negocio.mapa_url || ''}`.trim();
}

function mensajeDerivadoHumano() {
  return 'Dale, le aviso a alguien del equipo que te escriba directo 🙋';
}

function mensajeNoEntendido() {
  return 'Perdón, no te entendí bien 😅 ¿Querés que te comunique directo con alguien del equipo?';
}

function preguntaTipoTurno() {
  return 'Perfecto 🙌 ¿Qué tipo de turno necesitás?';
}

function preguntaParaQuien() {
  return '¿El turno es para vos o para otra persona?';
}

function pedirNombre(paraOtro) {
  return paraOtro
    ? '¿Me pasás el nombre completo de quien va a asistir?'
    : '¿Me pasás tu nombre completo para reservarlo?';
}

function preguntaFranjas() {
  return 'Estas son las próximas franjas libres. Elegí la que te quede mejor, o decime otro día si preferís:';
}

function sinFranjas() {
  return 'Por ahora no tengo lugar disponible en esos días 😔\n¿Querés que te anote en lista de espera y te avise si se libera un lugar?';
}

function listaEsperaAnotado() {
  return '¡Listo! Quedaste en lista de espera. Apenas se libere un lugar te aviso por acá 🙌';
}

function franjaOcupada() {
  return 'Uy, justo se ocupó ese horario 😔 Te paso otras opciones:';
}

function mensajeConfirmacionTurno({ servicio, fechaHoraTexto, direccion }) {
  return `Listo ✅ Tu turno quedó agendado:\n\n🗓️ ${fechaHoraTexto}\n🔹 ${servicio}\n📍 ${direccion}\n\nTe voy a escribir un recordatorio el día antes.`;
}

function turnoConfirmadoOk(fechaHoraTexto) {
  return `¡Buenísimo! Tu turno del ${fechaHoraTexto} queda confirmado ✅ Te esperamos.`;
}

function turnoCancelado() {
  return 'Listo, quedó cancelado. ¡Gracias por avisar! 🙌 Cuando quieras agendar de nuevo, escribime.';
}

function sinTurnoProximo() {
  return 'No encontré un turno próximo a tu nombre 🤔 ¿Querés agendar uno?';
}

module.exports = {
  mensajeBienvenida,
  mensajePrecios,
  mensajeUbicacion,
  mensajeDerivadoHumano,
  mensajeNoEntendido,
  preguntaTipoTurno,
  preguntaParaQuien,
  pedirNombre,
  preguntaFranjas,
  sinFranjas,
  listaEsperaAnotado,
  franjaOcupada,
  mensajeConfirmacionTurno,
  turnoConfirmadoOk,
  turnoCancelado,
  sinTurnoProximo,
};
