// Alerta automática de stock bajo al dueño (Etapa 3 del bot retail, ver
// docs/AS_ADMIN_bot_whatsapp_v3_retail_inventario.md, sección 6a).
//
// Solo lectura + notificación: este job NUNCA decide ni ejecuta una
// reposición, solo le avisa al dueño por WhatsApp para que decida él.
// El mismo aviso no se repite en cada corrida mientras el producto
// siga bajo (productos.alerta_stock_baja_enviada); se resetea solo
// cuando el stock vuelve a subir por encima del mínimo.

const supabase = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { credencialesDeNegocio } = require('./credenciales');

// Para no repetir el mismo warning cada 5 minutos por cada negocio.
const avisados = new Set();

function avisarUnaVez(clave, mensaje) {
  if (avisados.has(clave)) return;
  avisados.add(clave);
  console.warn(mensaje);
}

// Mismo criterio de "stock total" que usa el panel en Productos.jsx:
// si tiene variantes, se suma el stock de todas; si no, es el stock
// del producto directo.
function calcularStockPorProducto(productos, variantes) {
  const mapa = new Map();
  for (const p of productos) {
    if (p.tiene_variantes) {
      const total = variantes
        .filter((v) => v.producto_id === p.id)
        .reduce((acc, v) => acc + v.stock, 0);
      mapa.set(p.id, total);
    } else {
      mapa.set(p.id, p.stock);
    }
  }
  return mapa;
}

async function procesarAlertasStock() {
  const { data: productos } = await supabase.from('productos').select('*').eq('activo', true);
  if (!productos?.length) return;

  const { data: variantes } = await supabase
    .from('variantes_producto')
    .select('producto_id, stock')
    .eq('activo', true);

  const stockPorProducto = calcularStockPorProducto(productos, variantes || []);
  const negociosCache = new Map();
  const credencialesCache = new Map();

  for (const producto of productos) {
    const stockTotal = stockPorProducto.get(producto.id);
    const bajo = stockTotal <= producto.stock_minimo;

    if (!bajo) {
      if (producto.alerta_stock_baja_enviada) {
        await supabase.from('productos').update({ alerta_stock_baja_enviada: false }).eq('id', producto.id);
      }
      continue;
    }

    if (producto.alerta_stock_baja_enviada) continue; // ya se avisó, se espera a que se recupere

    if (!negociosCache.has(producto.negocio_id)) {
      const { data: negocio } = await supabase
        .from('negocios')
        .select('*')
        .eq('id', producto.negocio_id)
        .maybeSingle();
      negociosCache.set(producto.negocio_id, negocio);
    }
    const negocio = negociosCache.get(producto.negocio_id);
    if (!negocio) continue;

    const telefonoDueno = negocio.config?.telefono_dueno;
    if (!telefonoDueno) {
      avisarUnaVez(
        `sinfono:${negocio.id}`,
        `Alertas de stock: el negocio ${negocio.id} no tiene "telefono_dueno" configurado en config — no se envía.`
      );
      continue;
    }

    if (!credencialesCache.has(negocio.id)) {
      credencialesCache.set(negocio.id, await credencialesDeNegocio(negocio));
    }
    const wa = credencialesCache.get(negocio.id);
    const nombrePlantilla = wa.templates.alertaStock;

    if (!nombrePlantilla) {
      avisarUnaVez(
        `sinplantilla:${negocio.id}`,
        `Alertas de stock: el negocio ${negocio.id} no tiene plantilla "alertaStock" configurada — no se envía.`
      );
      continue;
    }

    // Try/catch por producto: uno que falle (token vencido, etc.) no
    // frena el resto, y solo marcamos enviada si el envío no tiró error.
    try {
      await sendTemplate(wa, telefonoDueno, nombrePlantilla, [producto.nombre, String(stockTotal)]);
      await supabase.from('productos').update({ alerta_stock_baja_enviada: true }).eq('id', producto.id);
    } catch (err) {
      console.error(`Error mandando alerta de stock del producto ${producto.id}:`, err);
    }
  }
}

module.exports = { procesarAlertasStock };
