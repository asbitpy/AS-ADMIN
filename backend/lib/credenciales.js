// Credenciales de WhatsApp de cada negocio.
//
// Viven en 'negocios_credenciales', una tabla con RLS habilitado y sin
// políticas: solo el backend (que usa la service key) puede leerla. El
// panel, que usa la anon key, no la ve ni por accidente.
//
// Si un negocio todavía no tiene su fila cargada, se usa lo que haya en
// el .env. Así el negocio piloto sigue andando sin cambiar nada, y los
// clientes nuevos se configuran uno por uno sin tocar el servidor.

const supabase = require('./supabase');

async function credencialesDeNegocio(negocio) {
  const { data } = await supabase
    .from('negocios_credenciales')
    .select('*')
    .eq('negocio_id', negocio.id)
    .maybeSingle();

  return {
    phoneNumberId: negocio.whatsapp_phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    token: data?.whatsapp_token || process.env.WHATSAPP_TOKEN || null,
    templates: {
      recordatorio24h: data?.template_recordatorio_24h || process.env.TEMPLATE_RECORDATORIO_24H || null,
      recordatorioHoy: data?.template_recordatorio_hoy || process.env.TEMPLATE_RECORDATORIO_HOY || null,
      alertaStock: data?.template_alerta_stock || process.env.TEMPLATE_ALERTA_STOCK || null,
      derivacionHumano: data?.template_derivacion_humano || process.env.TEMPLATE_DERIVACION_HUMANO || null,
      resumenSemanal: data?.template_resumen_semanal || process.env.TEMPLATE_RESUMEN_SEMANAL || null,
    },
  };
}

module.exports = { credencialesDeNegocio };
