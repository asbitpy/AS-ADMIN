// Máquina de estados del flujo "agendar turno" (rama 3A del árbol de
// conversación). El estado vive en conversaciones.contexto (jsonb), así el
// bot retoma exactamente donde quedó aunque el cliente responda horas después.
//
// Pasos: elegir_servicio -> para_quien -> (pedir_nombre) -> elegir_franja -> confirmado
// También maneja: lista de espera cuando no hay lugar, y reprogramación.

const supabase = require('./supabase');
const { responderTexto, responderBotones, responderLista } = require('./responder');
const agenda = require('./agenda');
const respuestas = require('./respuestas');

// exclusion_violation: la restricción turnos_sin_solape (migración 007)
// rechazó el turno porque otro cliente se quedó con esa franja primero.
const CODIGO_SOLAPE = '23P01';

async function guardarContexto(conversacionId, contexto) {
  await supabase.from('conversaciones').update({ contexto }).eq('id', conversacionId);
}

async function cargarServicios(negocioId) {
  const { data } = await supabase
    .from('servicios')
    .select('*')
    .eq('negocio_id', negocioId)
    .eq('activo', true);
  return data || [];
}

/** Busca un servicio puntual sin filtrar por activo — para reprogramar un
 *  turno cuyo servicio original pudo haberse desactivado después. */
async function cargarServicioPorId(servicioId) {
  const { data } = await supabase.from('servicios').select('*').eq('id', servicioId).maybeSingle();
  return data || null;
}

async function cargarProfesionalesActivos(negocioId) {
  const { data } = await supabase
    .from('profesionales')
    .select('*')
    .eq('negocio_id', negocioId)
    .eq('activo', true)
    .order('nombre');
  return data || [];
}

/** Arranca el flujo de agendado (o de reprogramación de un turno existente) */
async function iniciar({ negocio, conversacion, to, turnoAReprogramar = null }) {
  const servicios = await cargarServicios(negocio.id);

  if (!servicios.length) {
    await responderTexto(negocio.wa, conversacion.id, to, 'Por ahora no tengo la agenda habilitada, ya le aviso al equipo 🙌');
    return;
  }

  if (turnoAReprogramar) {
    // El servicio pudo desactivarse después de creado el turno — lo
    // buscamos puntual (sin filtro de activo) en vez de caer en
    // servicios[0], que sería un servicio arbitrario sin relación.
    const servicio =
      servicios.find((s) => s.id === turnoAReprogramar.servicio_id) ||
      (await cargarServicioPorId(turnoAReprogramar.servicio_id));

    if (!servicio) {
      // El servicio original ya no existe (borrado, no solo desactivado):
      // no hay con qué reprogramar. Mandamos al inicio del flujo para que
      // elija uno de los servicios vigentes.
      await responderTexto(negocio.wa, conversacion.id, to, 'Ese servicio ya no está disponible — decime qué querés agendar y te muestro las opciones actuales 🙌');
      return iniciar({ negocio, conversacion, to });
    }

    const ctx = {
      flujo: 'agendar',
      paso: 'elegir_franja',
      servicio_id: servicio.id,
      turno_a_reprogramar: turnoAReprogramar.id,
      // Reprogramar mantiene el mismo profesional de siempre, no se
      // vuelve a preguntar.
      profesional_id: turnoAReprogramar.profesional_id || null,
    };
    await guardarContexto(conversacion.id, ctx);
    // Ojo: se pasa 'contexto: ctx' explícito (no 'conversacion' tal
    // cual) — si no, ofrecerFranjas reconstruye el contexto a partir
    // del que había ANTES de este guardarContexto y se pierde
    // turno_a_reprogramar/profesional_id apenas vuelva a guardar.
    return ofrecerFranjas({ negocio, conversacion: { ...conversacion, contexto: ctx }, to, servicio });
  }

  await guardarContexto(conversacion.id, { flujo: 'agendar', paso: 'elegir_servicio' });
  await responderLista(
    negocio.wa,
    conversacion.id,
    to,
    respuestas.preguntaTipoTurno(),
    'Ver opciones',
    servicios.map((s) => ({
      id: `serv_${s.id}`,
      title: s.nombre,
      description: `Gs. ${Number(s.precio).toLocaleString('es-PY')}`,
    }))
  );
}

async function ofrecerFranjas({ negocio, conversacion, to, servicio, filtroFecha = null }) {
  const profesionalId = conversacion.contexto?.profesional_id || null;
  const franjas = await agenda.obtenerFranjasDisponibles({ negocio, servicio, filtroFecha, profesionalId });

  if (!franjas.length) {
    const ctx = { ...conversacion.contexto, flujo: 'agendar', paso: 'lista_espera', servicio_id: servicio.id };
    await guardarContexto(conversacion.id, ctx);
    return responderBotones(negocio.wa, conversacion.id, to, respuestas.sinFranjas(), [
      { id: 'le_si', title: 'Sí, anotame' },
      { id: 'le_no', title: 'No, gracias' },
    ]);
  }

  const ctx = { ...conversacion.contexto, flujo: 'agendar', paso: 'elegir_franja', servicio_id: servicio.id };
  await guardarContexto(conversacion.id, ctx);

  return responderLista(
    negocio.wa,
    conversacion.id,
    to,
    respuestas.preguntaFranjas(),
    'Ver horarios',
    franjas.map((ts) => ({ id: `franja_${ts}`, title: agenda.formatearFranja(ts) }))
  );
}

/**
 * Continúa el flujo según el paso guardado en contexto.
 * Devuelve true si manejó el mensaje; false si el mensaje no corresponde
 * a este flujo (y el handler general decide qué hacer).
 */
async function continuar({ entrada, clasificacion, negocio, cliente, conversacion, to }) {
  const ctx = conversacion.contexto || {};
  if (ctx.flujo !== 'agendar') return false;

  const servicios = await cargarServicios(negocio.id);

  switch (ctx.paso) {
    case 'elegir_servicio': {
      let servicio = null;

      if (entrada?.startsWith('serv_')) {
        servicio = servicios.find((s) => s.id === entrada.replace('serv_', ''));
      } else if (clasificacion?.datos_extraidos?.servicio) {
        const nombre = clasificacion.datos_extraidos.servicio.toLowerCase();
        servicio = servicios.find((s) => s.nombre.toLowerCase().includes(nombre) || nombre.includes(s.nombre.toLowerCase()));
      }

      if (!servicio) {
        // No entendimos qué servicio quiere: re-mandamos la lista.
        return iniciar({ negocio, conversacion, to }).then(() => true);
      }

      const profesionales = await cargarProfesionalesActivos(negocio.id);

      if (profesionales.length > 1) {
        await guardarContexto(conversacion.id, { ...ctx, paso: 'elegir_profesional', servicio_id: servicio.id });
        await responderLista(
          negocio.wa,
          conversacion.id,
          to,
          '¿Con quién preferís?',
          'Ver opciones',
          [
            { id: 'prof_cualquiera', title: 'El primero disponible' },
            ...profesionales.map((p) => ({ id: `prof_${p.id}`, title: p.nombre })),
          ]
        );
        return true;
      }

      await guardarContexto(conversacion.id, {
        ...ctx,
        paso: 'para_quien',
        servicio_id: servicio.id,
        profesional_id: profesionales[0]?.id || null,
      });
      await responderBotones(negocio.wa, conversacion.id, to, respuestas.preguntaParaQuien(), [
        { id: 'pq_mi', title: 'Para mí' },
        { id: 'pq_otro', title: 'Para otra persona' },
      ]);
      return true;
    }

    case 'elegir_profesional': {
      if (!entrada?.startsWith('prof_')) return false;
      const valor = entrada.replace('prof_', '');

      let profesionalId;
      if (valor === 'cualquiera') {
        const profesionales = await cargarProfesionalesActivos(negocio.id);
        profesionalId = profesionales[0]?.id || null;
      } else {
        profesionalId = valor;
      }

      await guardarContexto(conversacion.id, { ...ctx, paso: 'para_quien', profesional_id: profesionalId });
      await responderBotones(negocio.wa, conversacion.id, to, respuestas.preguntaParaQuien(), [
        { id: 'pq_mi', title: 'Para mí' },
        { id: 'pq_otro', title: 'Para otra persona' },
      ]);
      return true;
    }

    case 'para_quien': {
      const paraOtro = entrada === 'pq_otro' || clasificacion?.datos_extraidos?.para_quien === 'otro';
      const paraMi = entrada === 'pq_mi' || clasificacion?.datos_extraidos?.para_quien === 'mi';

      if (!paraOtro && !paraMi) return false; // no era una respuesta a esta pregunta

      if (paraOtro || cliente.nombre === 'Sin nombre') {
        await guardarContexto(conversacion.id, { ...ctx, paso: 'pedir_nombre', para: paraOtro ? 'otro' : 'mi' });
        await responderTexto(negocio.wa, conversacion.id, to, respuestas.pedirNombre(paraOtro));
        return true;
      }

      // Es para él/ella y ya tenemos su nombre: directo a las franjas.
      const servicio = servicios.find((s) => s.id === ctx.servicio_id);
      await ofrecerFranjas({ negocio, conversacion: { ...conversacion, contexto: ctx }, to, servicio });
      return true;
    }

    case 'pedir_nombre': {
      const nombre = (entrada || '').trim();
      if (!nombre || nombre.length < 2) {
        await responderTexto(negocio.wa, conversacion.id, to, respuestas.pedirNombre(ctx.para === 'otro'));
        return true;
      }

      let nuevoCtx = { ...ctx };
      if (ctx.para === 'otro') {
        nuevoCtx.nombre_asistente = nombre;
      } else {
        await supabase.from('clientes').update({ nombre }).eq('id', cliente.id);
      }

      await guardarContexto(conversacion.id, nuevoCtx);
      const servicio = servicios.find((s) => s.id === ctx.servicio_id);
      await ofrecerFranjas({ negocio, conversacion: { ...conversacion, contexto: nuevoCtx }, to, servicio });
      return true;
    }

    case 'elegir_franja': {
      const servicio = servicios.find((s) => s.id === ctx.servicio_id);

      // ¿El cliente pidió otro día con texto libre? ("¿tenés el jueves?")
      if (!entrada?.startsWith('franja_') && clasificacion?.datos_extraidos?.fecha_preferida) {
        await ofrecerFranjas({
          negocio,
          conversacion: { ...conversacion, contexto: ctx },
          to,
          servicio,
          filtroFecha: clasificacion.datos_extraidos.fecha_preferida,
        });
        return true;
      }

      if (!entrada?.startsWith('franja_')) return false;

      const ts = Number(entrada.replace('franja_', ''));
      const profesionalId = ctx.profesional_id || null;

      // Revalidamos: pudo ocuparse mientras el cliente decidía.
      const libre = await agenda.franjaSigueDisponible({ negocio, servicio, ts, profesionalId });
      if (!libre) {
        return franjaTomada({ negocio, conversacion, to, servicio, ctx });
      }

      let error;
      if (ctx.turno_a_reprogramar) {
        ({ error } = await supabase
          .from('turnos')
          .update({
            fecha_hora: new Date(ts).toISOString(),
            duracion_minutos: servicio.duracion_minutos,
            estado: 'pendiente',
            profesional_id: profesionalId,
            recordatorio_24h_enviado: false,
            recordatorio_mismo_dia_enviado: false,
            actualizado_en: new Date().toISOString(),
          })
          .eq('id', ctx.turno_a_reprogramar));
      } else {
        ({ error } = await supabase.from('turnos').insert({
          negocio_id: negocio.id,
          cliente_id: cliente.id,
          servicio_id: servicio.id,
          profesional_id: profesionalId,
          fecha_hora: new Date(ts).toISOString(),
          duracion_minutos: servicio.duracion_minutos,
          estado: 'pendiente',
          origen: 'bot',
          monto: servicio.precio,
          notas: ctx.nombre_asistente ? `Asiste: ${ctx.nombre_asistente}` : null,
        }));
      }

      if (error) {
        // La revalidación de arriba y este insert son dos pasos: entre
        // uno y otro, otro cliente pudo quedarse con la franja. Ahí la
        // base rechaza el turno y nosotros ofrecemos otros horarios.
        if (error.code !== CODIGO_SOLAPE) throw error;
        return franjaTomada({ negocio, conversacion, to, servicio, ctx });
      }

      await guardarContexto(conversacion.id, {}); // flujo terminado
      await responderTexto(
        negocio.wa,
        conversacion.id,
        to,
        respuestas.mensajeConfirmacionTurno({
          servicio: servicio.nombre,
          fechaHoraTexto: agenda.formatearFranjaLarga(ts),
          direccion: negocio.direccion || '',
        }),
        'turno_agendado'
      );
      return true;
    }

    case 'lista_espera': {
      if (entrada === 'le_si') {
        await supabase.from('lista_espera').insert({
          negocio_id: negocio.id,
          cliente_id: cliente.id,
          servicio_id: ctx.servicio_id,
        });
        await guardarContexto(conversacion.id, {});
        await responderTexto(negocio.wa, conversacion.id, to, respuestas.listaEsperaAnotado());
        return true;
      }
      if (entrada === 'le_no') {
        await guardarContexto(conversacion.id, {});
        await responderTexto(negocio.wa, conversacion.id, to, 'Dale, cualquier cosa escribime cuando quieras 🙌');
        return true;
      }
      return false;
    }

    default:
      return false;
  }
}

/** La franja elegida ya no está: se lo decimos y le mostramos otras. */
async function franjaTomada({ negocio, conversacion, to, servicio, ctx }) {
  await responderTexto(negocio.wa, conversacion.id, to, respuestas.franjaOcupada());
  await ofrecerFranjas({ negocio, conversacion: { ...conversacion, contexto: ctx }, to, servicio });
  return true;
}

/** Limpia el flujo (cuando el cliente cambia de tema o se deriva a humano) */
async function limpiar(conversacionId) {
  await guardarContexto(conversacionId, {});
}

module.exports = { iniciar, continuar, limpiar, ofrecerFranjas };
