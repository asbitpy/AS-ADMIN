// Motor de disponibilidad: genera franjas libres a partir de los horarios
// del negocio, los turnos ya tomados, los feriados y la duración del servicio.

const supabase = require('./supabase');

// Paraguay usa UTC-3 fijo (sin horario de verano desde su eliminación).
const OFFSET_MS = -3 * 3600 * 1000;
const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

/** Convierte un timestamp real a sus "componentes locales" de Paraguay */
function partesLocales(ts) {
  const d = new Date(ts + OFFSET_MS);
  return {
    anio: d.getUTCFullYear(),
    mes: d.getUTCMonth(),
    dia: d.getUTCDate(),
    diaSemana: DIAS[d.getUTCDay()],
    fechaISO: d.toISOString().slice(0, 10), // YYYY-MM-DD local
  };
}

/** Construye el timestamp real a partir de componentes locales de Paraguay */
function tsLocal(anio, mes, dia, hh, mm) {
  return Date.UTC(anio, mes, dia, hh, mm) - OFFSET_MS;
}

function formatearFranja(ts) {
  const fecha = new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(ts));
  const hora = new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ts));
  return `${fecha} - ${hora}hs`;
}

function formatearFranjaLarga(ts) {
  const fecha = new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(ts));
  const hora = new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ts));
  return `${fecha} a las ${hora}hs`;
}

async function cargarOcupadosYFeriados(negocioId, desdeISO, hastaISO, profesionalId) {
  let queryTurnos = supabase
    // La duración sale de la propia fila del turno (no del servicio):
    // es la misma que usa la restricción turnos_sin_solape en la base,
    // así lo que el bot considera ocupado y lo que la base rechaza son
    // exactamente lo mismo.
    .from('turnos')
    .select('fecha_hora, duracion_minutos')
    .eq('negocio_id', negocioId)
    .in('estado', ['pendiente', 'confirmado', 'reprogramado'])
    .gte('fecha_hora', desdeISO)
    .lte('fecha_hora', hastaISO);

  // Sin profesionalId (negocio de un solo profesional, o "cualquiera"
  // resuelto por el que llama): se sigue considerando ocupado TODO turno
  // del negocio, exactamente el comportamiento de siempre. Con
  // profesionalId, solo cuentan como ocupados los turnos de esa persona
  // — dos profesionales pueden tener turnos a la misma hora sin pisarse.
  if (profesionalId) {
    queryTurnos = queryTurnos.eq('profesional_id', profesionalId);
  }

  const [turnosRes, feriadosRes] = await Promise.all([
    queryTurnos,
    supabase.from('feriados_excepciones').select('fecha').eq('negocio_id', negocioId),
  ]);

  const ocupados = (turnosRes.data || []).map((t) => {
    const inicio = new Date(t.fecha_hora).getTime();
    const dur = (t.duracion_minutos || 30) * 60000;
    return { inicio, fin: inicio + dur };
  });

  const feriados = new Set((feriadosRes.data || []).map((f) => f.fecha));
  return { ocupados, feriados };
}

function seSolapa(slotInicio, slotFin, ocupados) {
  return ocupados.some((o) => slotInicio < o.fin && o.inicio < slotFin);
}

function esAdyacente(slotInicio, slotFin, ocupados) {
  return ocupados.some((o) => slotFin === o.inicio || slotInicio === o.fin);
}

/**
 * Devuelve hasta `max` franjas disponibles para un servicio.
 * - Respeta horarios del negocio (negocio.config.horarios), feriados y turnos tomados.
 * - "Compacta" la agenda: dentro de un mismo día, prioriza las franjas
 *   pegadas a turnos existentes, para minimizar huecos muertos.
 * - filtroFecha (YYYY-MM-DD, opcional): limita a un día puntual, para cuando
 *   el cliente pide "el jueves".
 *
 * Formato esperado de horarios en negocios.config:
 * { "horarios": { "lun": ["08:00-12:00", "15:00-19:00"], "mar": [...], ... } }
 */
async function obtenerFranjasDisponibles({ negocio, servicio, diasVista = 7, max = 4, filtroFecha = null, profesionalId = null }) {
  const horarios = negocio.config?.horarios || {};
  const durMin = servicio.duracion_minutos || 30;
  const durMs = durMin * 60000;

  const ahora = Date.now();
  const margenMinimo = ahora + 60 * 60000; // no ofrecer franjas a menos de 1 hora
  const hasta = ahora + diasVista * 86400000;

  const { ocupados, feriados } = await cargarOcupadosYFeriados(
    negocio.id,
    new Date(ahora).toISOString(),
    new Date(hasta).toISOString(),
    profesionalId
  );

  const candidatas = [];

  for (let d = 0; d <= diasVista; d++) {
    const baseTs = ahora + d * 86400000;
    const { anio, mes, dia, diaSemana, fechaISO } = partesLocales(baseTs);

    if (feriados.has(fechaISO)) continue;
    if (filtroFecha && fechaISO !== filtroFecha) continue;

    const bloques = horarios[diaSemana] || [];
    for (const bloque of bloques) {
      const [desde, hastaBloque] = bloque.split('-');
      const [h1, m1] = desde.split(':').map(Number);
      const [h2, m2] = hastaBloque.split(':').map(Number);

      let slot = tsLocal(anio, mes, dia, h1, m1);
      const finBloque = tsLocal(anio, mes, dia, h2, m2);

      while (slot + durMs <= finBloque) {
        if (slot >= margenMinimo && !seSolapa(slot, slot + durMs, ocupados)) {
          candidatas.push({
            ts: slot,
            fechaISO,
            adyacente: esAdyacente(slot, slot + durMs, ocupados),
          });
        }
        slot += durMs;
      }
    }
  }

  // Orden: cronológico por día; dentro del mismo día, primero las adyacentes
  // (compactar agenda), después por hora.
  candidatas.sort((a, b) => {
    if (a.fechaISO !== b.fechaISO) return a.ts - b.ts;
    if (a.adyacente !== b.adyacente) return a.adyacente ? -1 : 1;
    return a.ts - b.ts;
  });

  return candidatas.slice(0, max).map((c) => c.ts);
}

/** Revalida que una franja puntual siga libre antes de confirmar el turno */
async function franjaSigueDisponible({ negocio, servicio, ts, profesionalId = null }) {
  const durMs = (servicio.duracion_minutos || 30) * 60000;
  const { ocupados, feriados } = await cargarOcupadosYFeriados(
    negocio.id,
    new Date(ts - 12 * 3600000).toISOString(),
    new Date(ts + 12 * 3600000).toISOString(),
    profesionalId
  );
  const { fechaISO } = partesLocales(ts);
  if (feriados.has(fechaISO)) return false;
  return !seSolapa(ts, ts + durMs, ocupados);
}

module.exports = {
  obtenerFranjasDisponibles,
  franjaSigueDisponible,
  formatearFranja,
  formatearFranjaLarga,
};
