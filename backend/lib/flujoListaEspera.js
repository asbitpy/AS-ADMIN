// Cuando un turno se cancela, ofrece el lugar liberado al primero de la
// lista de espera para ese servicio (orden de llegada). Es un flujo
// propio, chico y separado de flujoAgendar.js: reserva su propio button
// id (oferta_si/oferta_no) y su propio nombre de flujo en
// conversaciones.contexto, así no toca nada de la lógica de agendado
// normal. Si declina, o si la franja se ocupó justo antes de
// confirmar, cae en cascada al siguiente de la lista.

const supabase = require('./supabase');
const { responderTexto, responderBotones } = require('./responder');
const respuestas = require('./respuestas');
const agenda = require('./agenda');

// exclusion_violation: la restricción turnos_sin_solape (migración 007)
// rechazó el turno porque se ocupó justo al confirmar. Mismo código que
// usa flujoAgendar.js.
const CODIGO_SOLAPE = '23P01';

async function guardarContexto(conversacionId, contexto) {
  await supabase.from('conversaciones').update({ contexto }).eq('id', conversacionId);
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

  const vencida = existente && Date.now() - new Date(existente.ultima_actividad).getTime() > 24 * 3600000;
  if (existente && !vencida) return existente;

  const { data: nueva } = await supabase
    .from('conversaciones')
    .insert({ negocio_id: negocioId, cliente_id: clienteId })
    .select()
    .single();
  return nueva;
}

/** Se llama al cancelar un turno. Busca al primero en espera para ese
 *  servicio y, si la franja liberada sigue libre, se la ofrece. */
async function ofrecerFranjaLiberada({ negocio, servicioId, ts }) {
  const { data: primero } = await supabase
    .from('lista_espera')
    .select('id, cliente_id, cliente:clientes(nombre, telefono)')
    .eq('negocio_id', negocio.id)
    .eq('servicio_id', servicioId)
    .eq('estado', 'esperando')
    .order('creado_en', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!primero || !primero.cliente?.telefono) return;

  const { data: servicio } = await supabase.from('servicios').select('*').eq('id', servicioId).maybeSingle();
  if (!servicio) return;

  // La franja pudo ocuparse mientras tanto (alguien agendó directo).
  const libre = await agenda.franjaSigueDisponible({ negocio, servicio, ts });
  if (!libre) return;

  const conversacion = await obtenerOCrearConversacion(negocio.id, primero.cliente_id);
  if (!conversacion) return;

  await guardarContexto(conversacion.id, { flujo: 'oferta_turno', lista_espera_id: primero.id, servicio_id: servicioId, ts });
  await supabase.from('lista_espera').update({ estado: 'ofrecido' }).eq('id', primero.id);

  await responderBotones(
    negocio.wa,
    conversacion.id,
    primero.cliente.telefono,
    `¡Buenas noticias! Se liberó un lugar para ${servicio.nombre}: ${agenda.formatearFranjaLarga(ts)} 🙌 ¿Lo tomás?`,
    [
      { id: 'oferta_si', title: 'Sí, lo tomo' },
      { id: 'oferta_no', title: 'No, gracias' },
    ],
    'oferta_lista_espera'
  );
}

/** Devuelve true si manejó el mensaje; false si no hay oferta en curso. */
async function continuar({ entrada, negocio, conversacion, to }) {
  const ctx = conversacion.contexto || {};
  if (ctx.flujo !== 'oferta_turno') return false;

  if (entrada === 'oferta_si') return confirmar({ negocio, conversacion, to, ctx });
  if (entrada === 'oferta_no') return declinar({ negocio, conversacion, to, ctx });
  return false;
}

async function confirmar({ negocio, conversacion, to, ctx }) {
  const { data: servicio } = await supabase.from('servicios').select('*').eq('id', ctx.servicio_id).maybeSingle();
  const { data: listaEsperaRow } = await supabase
    .from('lista_espera')
    .select('cliente_id')
    .eq('id', ctx.lista_espera_id)
    .maybeSingle();

  if (!servicio || !listaEsperaRow) {
    await guardarContexto(conversacion.id, {});
    await responderTexto(negocio.wa, conversacion.id, to, 'Uy, tuve un problema con eso. Escribime si querés agendar de nuevo.');
    return true;
  }

  const libre = await agenda.franjaSigueDisponible({ negocio, servicio, ts: ctx.ts });
  if (!libre) return perdioElLugar({ negocio, conversacion, to, ctx });

  const { error } = await supabase.from('turnos').insert({
    negocio_id: negocio.id,
    cliente_id: listaEsperaRow.cliente_id,
    servicio_id: servicio.id,
    fecha_hora: new Date(ctx.ts).toISOString(),
    duracion_minutos: servicio.duracion_minutos,
    estado: 'pendiente',
    origen: 'bot',
    monto: servicio.precio,
  });

  if (error) {
    // Solo un choque de horario (alguien agendó esa franja justo antes)
    // significa "se perdió el lugar". Cualquier otro error (conexión,
    // columna, RLS) es un problema real: lo logueamos en vez de tratarlo
    // como si el cliente hubiese llegado tarde.
    if (error.code !== CODIGO_SOLAPE) {
      console.error(`Error insertando turno desde lista de espera (lista_espera_id=${ctx.lista_espera_id}):`, error);
      await guardarContexto(conversacion.id, {});
      await responderTexto(negocio.wa, conversacion.id, to, 'Uy, tuve un problema confirmando eso. Ya le aviso al equipo, dale un toque y seguimos 🙌');
      return true;
    }
    return perdioElLugar({ negocio, conversacion, to, ctx });
  }

  await supabase.from('lista_espera').update({ estado: 'tomado' }).eq('id', ctx.lista_espera_id);
  await guardarContexto(conversacion.id, {});
  await responderTexto(
    negocio.wa,
    conversacion.id,
    to,
    respuestas.mensajeConfirmacionTurno({
      servicio: servicio.nombre,
      fechaHoraTexto: agenda.formatearFranjaLarga(ctx.ts),
      direccion: negocio.direccion || '',
    }),
    'turno_agendado'
  );
  return true;
}

async function perdioElLugar({ negocio, conversacion, to, ctx }) {
  await supabase.from('lista_espera').update({ estado: 'vencido' }).eq('id', ctx.lista_espera_id);
  await guardarContexto(conversacion.id, {});
  await responderTexto(negocio.wa, conversacion.id, to, 'Uy, justo se ocupó ese lugar 😔 Avisame si querés anotarte para otra franja.');
  return true;
}

async function declinar({ negocio, conversacion, to, ctx }) {
  await supabase.from('lista_espera').update({ estado: 'vencido' }).eq('id', ctx.lista_espera_id);
  await guardarContexto(conversacion.id, {});
  await responderTexto(negocio.wa, conversacion.id, to, 'Dale, sin problema. Avisame si querés anotarte para otra franja 🙌');
  // Cascada: se lo ofrece al siguiente de la lista para el mismo servicio.
  await ofrecerFranjaLiberada({ negocio, servicioId: ctx.servicio_id, ts: ctx.ts });
  return true;
}

module.exports = { ofrecerFranjaLiberada, continuar };
