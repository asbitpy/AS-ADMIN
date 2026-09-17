// Resumen semanal proactivo al dueño ("esta semana facturaste X"). Se
// manda los lunes, una sola vez por semana por negocio — mismo patrón
// que recordatorios/alertasStock: un job liviano que revisa
// periódicamente y solo actúa cuando corresponde, sin necesitar un
// cron externo por ahora.

const supabase = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { credencialesDeNegocio } = require('./credenciales');

const avisadosSinPlantilla = new Set();

function formatoGsCompacto(monto) {
  const n = Number(monto);
  const signo = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${signo}Gs. ${(abs / 1_000_000).toFixed(1)} M`;
  return `${signo}Gs. ${abs.toLocaleString('es-PY')}`;
}

async function procesarResumenSemanal() {
  const ahora = new Date();

  // Solo los lunes, y solo en horario comercial — para que la primera
  // vez que este job corre (ej. recién desplegado) no mande el resumen
  // a las 3 de la mañana.
  const diaSemana = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Asuncion', weekday: 'short' }).format(ahora);
  const hora = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Asuncion', hour: '2-digit', hour12: false }).format(ahora)
  );
  if (diaSemana !== 'Mon' || hora < 8 || hora >= 20) return;

  const haceUnaSemana = new Date(ahora.getTime() - 6 * 24 * 3600000).toISOString();

  const { data: negocios } = await supabase
    .from('negocios')
    .select('*')
    .eq('activo', true)
    .or(`resumen_semanal_enviado_en.is.null,resumen_semanal_enviado_en.lt.${haceUnaSemana}`);

  for (const negocio of negocios || []) {
    const telefonoDueno = negocio.config?.telefono_dueno;
    if (!telefonoDueno) continue;

    const wa = await credencialesDeNegocio(negocio);
    const nombrePlantilla = wa.templates.resumenSemanal;

    if (!nombrePlantilla) {
      if (!avisadosSinPlantilla.has(negocio.id)) {
        avisadosSinPlantilla.add(negocio.id);
        console.warn(
          `Resumen semanal: el negocio ${negocio.id} no tiene plantilla "resumenSemanal" configurada — no se envía.`
        );
      }
      continue;
    }

    const desde = new Date(ahora.getTime() - 7 * 24 * 3600000).toISOString().slice(0, 10);
    const { data: movimientos } = await supabase
      .from('movimientos_financieros')
      .select('tipo, monto')
      .eq('negocio_id', negocio.id)
      .gte('fecha', desde);

    const ingresos = (movimientos || []).filter((m) => m.tipo === 'ingreso').reduce((a, m) => a + Number(m.monto), 0);
    const egresos = (movimientos || []).filter((m) => m.tipo === 'egreso').reduce((a, m) => a + Number(m.monto), 0);

    // Try/catch por negocio: uno que falle no frena el resto, y solo
    // marcamos enviado si el envío no tiró error.
    try {
      await sendTemplate(wa, telefonoDueno, nombrePlantilla, [
        formatoGsCompacto(ingresos),
        formatoGsCompacto(egresos),
        formatoGsCompacto(ingresos - egresos),
      ]);
      await supabase.from('negocios').update({ resumen_semanal_enviado_en: ahora.toISOString() }).eq('id', negocio.id);
    } catch (err) {
      console.error(`Error mandando resumen semanal al negocio ${negocio.id}:`, err);
    }
  }
}

module.exports = { procesarResumenSemanal };
