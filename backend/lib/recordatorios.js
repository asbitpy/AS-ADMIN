// Recordatorios automáticos (los dos toques anti-ausencias):
// 1) 24hs antes del turno
// 2) 2-3hs antes, SOLO si el cliente no respondió el primero
//
// IMPORTANTE: como estos mensajes salen fuera de la ventana de 24hs de
// Meta, DEBEN usar plantillas aprobadas en Meta Business Manager.
// Cada negocio manda desde su propio número y con sus propias plantillas
// (tabla negocios_credenciales); si un negocio no tiene nada cargado, se
// usa lo del .env. Si no hay ni una cosa ni la otra, ese negocio no
// recibe recordatorios pero el resto del bot funciona normal.

const supabase = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { credencialesDeNegocio } = require('./credenciales');
const { formatearFranjaLarga } = require('./agenda');

// Para no repetir el mismo warning cada 5 minutos por cada negocio.
const avisados = new Set();

function avisarSinPlantilla(negocioId, etiqueta) {
  const clave = `${negocioId}:${etiqueta}`;
  if (avisados.has(clave)) return;
  avisados.add(clave);
  console.warn(`Recordatorios: el negocio ${negocioId} no tiene plantilla "${etiqueta}" configurada — no se envía.`);
}

const CAMPOS_TURNO =
  'id, fecha_hora, cliente:clientes(nombre, telefono), negocio:negocios(id, whatsapp_phone_number_id)';

async function credencialesCacheadas(cache, negocio) {
  if (!cache.has(negocio.id)) {
    cache.set(negocio.id, await credencialesDeNegocio(negocio));
  }
  return cache.get(negocio.id);
}

async function enviarTanda(turnos, cache, { plantilla, campoEnviado, etiqueta }) {
  for (const turno of turnos || []) {
    if (!turno.negocio || !turno.cliente) continue;

    const wa = await credencialesCacheadas(cache, turno.negocio);
    const nombrePlantilla = wa.templates[plantilla];

    if (!nombrePlantilla) {
      avisarSinPlantilla(turno.negocio.id, etiqueta);
      continue;
    }

    // Try/catch por turno: si uno falla (token vencido, número inválido,
    // error de red), no tiene que frenar el resto de la tanda — y solo
    // marcamos enviado si sendTemplate no tiró error, así uno fallido
    // queda con el campo en false y se reintenta en la próxima corrida
    // en vez de darse por enviado sin haber salido.
    try {
      await sendTemplate(wa, turno.cliente.telefono, nombrePlantilla, [
        turno.cliente.nombre,
        formatearFranjaLarga(new Date(turno.fecha_hora).getTime()),
      ]);
      await supabase.from('turnos').update({ [campoEnviado]: true }).eq('id', turno.id);
    } catch (err) {
      console.error(`Error mandando recordatorio "${etiqueta}" al turno ${turno.id}:`, err);
    }
  }
}

async function procesarRecordatorios() {
  const ahora = Date.now();
  const cache = new Map(); // una lectura de credenciales por negocio por corrida

  // ---- Recordatorio de 24hs: turnos entre 23 y 25 horas de distancia ----
  // La plantilla debería tener un cuerpo tipo:
  // "Hola {{1}} 👋 Te recordamos tu turno: {{2}}. ¿Seguís confirmado?"
  // con botones de respuesta rápida: Confirmo / Reprogramar / Cancelar
  const { data: turnos24 } = await supabase
    .from('turnos')
    .select(CAMPOS_TURNO)
    .eq('estado', 'pendiente')
    .eq('recordatorio_24h_enviado', false)
    .gte('fecha_hora', new Date(ahora + 23 * 3600000).toISOString())
    .lte('fecha_hora', new Date(ahora + 25 * 3600000).toISOString());

  await enviarTanda(turnos24, cache, {
    plantilla: 'recordatorio24h',
    campoEnviado: 'recordatorio_24h_enviado',
    etiqueta: 'recordatorio 24hs',
  });

  // ---- Recordatorio del mismo día: entre 2 y 3 horas antes,
  //      solo si sigue 'pendiente' (es decir, NO confirmó el primero) ----
  const { data: turnosHoy } = await supabase
    .from('turnos')
    .select(CAMPOS_TURNO)
    .eq('estado', 'pendiente')
    .eq('recordatorio_24h_enviado', true)
    .eq('recordatorio_mismo_dia_enviado', false)
    .gte('fecha_hora', new Date(ahora + 2 * 3600000).toISOString())
    .lte('fecha_hora', new Date(ahora + 3 * 3600000).toISOString());

  await enviarTanda(turnosHoy, cache, {
    plantilla: 'recordatorioHoy',
    campoEnviado: 'recordatorio_mismo_dia_enviado',
    etiqueta: 'recordatorio mismo día',
  });
}

module.exports = { procesarRecordatorios };
