// Saber si el negocio está abierto AHORA, y qué saludo corresponde según
// la hora — para que el primer contacto del bot no salude siempre igual
// sin importar si son las 9am o las 11pm.

// Paraguay usa UTC-3 fijo (sin horario de verano desde su eliminación).
// Mismo criterio que lib/agenda.js.
const OFFSET_MS = -3 * 3600 * 1000;
const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

function horaLocalParaguay(ahora = Date.now()) {
  const local = new Date(ahora + OFFSET_MS);
  return {
    dia: DIAS[local.getUTCDay()],
    horaMin: local.getUTCHours() * 60 + local.getUTCMinutes(),
    hora24: local.getUTCHours(),
  };
}

function saludoSegunHora(ahora = Date.now()) {
  const { hora24 } = horaLocalParaguay(ahora);
  if (hora24 < 6) return 'Buenas noches';
  if (hora24 < 12) return 'Buenos días';
  if (hora24 < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function bloqueCubreHora(bloque, horaMin) {
  const [desde, hasta] = bloque.split('-');
  const [h1, m1] = desde.split(':').map(Number);
  const [h2, m2] = hasta.split(':').map(Number);
  const desdeMin = h1 * 60 + m1;
  const hastaMin = h2 * 60 + m2;
  // Bloque que cruza medianoche (ej. "20:00-01:00"): la parte de "hoy" es
  // desde `desdeMin` hasta fin del día, y sigue mañana desde 00:00.
  if (hastaMin <= desdeMin) return horaMin >= desdeMin || horaMin < hastaMin;
  return horaMin >= desdeMin && horaMin < hastaMin;
}

// { horarios: { lun: ["08:00-12:00", "15:00-19:00"], ... } } — mismo
// formato que usa el motor de disponibilidad de agenda.js.
function estaAbierto(negocio, ahora = Date.now()) {
  const horarios = negocio.config?.horarios;
  if (!horarios) return true; // sin horario cargado: no bloqueamos nada

  const { dia, horaMin } = horaLocalParaguay(ahora);
  const bloquesHoy = horarios[dia] || [];
  if (bloquesHoy.some((bloque) => bloqueCubreHora(bloque, horaMin))) return true;

  // Si es la madrugada, puede seguir abierto por un bloque de AYER que
  // cruzó medianoche (ej. "vie: 20:00-01:00" sigue abierto sábado 00:30).
  const diaAnterior = DIAS[(DIAS.indexOf(dia) + 6) % 7];
  const bloquesAyer = horarios[diaAnterior] || [];
  return bloquesAyer.some((bloque) => {
    const [desde, hasta] = bloque.split('-');
    const [h1, m1] = desde.split(':').map(Number);
    const [h2, m2] = hasta.split(':').map(Number);
    const cruzaMedianoche = h2 * 60 + m2 <= h1 * 60 + m1;
    return cruzaMedianoche && horaMin < h2 * 60 + m2;
  });
}

module.exports = { estaAbierto, saludoSegunHora };
