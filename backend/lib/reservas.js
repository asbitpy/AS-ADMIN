// Housekeeping de reservas de pedido por WhatsApp (Etapa 2 del bot
// retail): libera el stock de las reservas que vencieron sin que el
// cliente pasara a retirarlas. Toda la lógica (reversar stock, dejar
// constancia en movimientos_inventario) vive en fn_liberar_reservas_vencidas
// (migración 013) — acá solo se la llama y se loguea el resultado.

const supabase = require('./supabase');

async function liberarReservasVencidas() {
  const { data, error } = await supabase.rpc('fn_liberar_reservas_vencidas');
  if (error) throw error;
  if (data > 0) {
    console.log(`Reservas vencidas liberadas: ${data}`);
  }
  return data;
}

module.exports = { liberarReservasVencidas };
