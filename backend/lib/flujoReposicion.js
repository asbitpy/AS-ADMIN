// Máquina de estados de la reposición de stock (Etapa 4 del bot retail,
// ver docs/AS_ADMIN_bot_whatsapp_v3_retail_inventario.md). Mismo patrón
// que flujoPedido.js/flujoAgendar.js, pero el estado vive en
// negocios.contexto_admin — hay un solo dueño hablando por este canal,
// no una conversación por cliente — y nunca corre para un cliente real
// (lo filtra dueno.js antes de llegar acá).
//
// Pasos: elegir_producto -> (elegir_variante) -> cantidad -> confirmar -> hecho

const supabase = require('./supabase');
const { sendText, sendButtons, sendList } = require('./whatsapp');

async function guardarContexto(negocioId, contexto) {
  await supabase.from('negocios').update({ contexto_admin: contexto }).eq('id', negocioId);
}

async function cargarProductos(negocioId) {
  const { data } = await supabase.from('productos').select('*').eq('negocio_id', negocioId).eq('activo', true);
  return data || [];
}

function descripcionVariante(variante) {
  const partes = [variante.atributo1_valor, variante.atributo2_valor].filter(Boolean);
  return partes.join(' / ') || 'única opción';
}

/** Arranca el flujo. Si ya sabemos producto/cantidad (los extrajo el
 *  clasificador), salta directo a confirmar. */
async function iniciar({ negocio, to, productoNombre = null, varianteTexto = null, cantidad = null }) {
  if (!productoNombre) {
    return ofrecerProductos({ negocio, to });
  }

  const productos = await cargarProductos(negocio.id);
  const producto = productos.find((p) => p.nombre.toLowerCase() === productoNombre.toLowerCase());

  if (!producto) {
    return ofrecerProductos({ negocio, to });
  }

  return avanzarConProducto({ negocio, to, producto, varianteTexto, cantidad });
}

async function ofrecerProductos({ negocio, to }) {
  const productos = await cargarProductos(negocio.id);

  if (!productos.length) {
    return sendText(negocio.wa, to, 'Todavía no tenés productos cargados en el sistema.');
  }

  await guardarContexto(negocio.id, { paso: 'elegir_producto' });
  return sendList(
    negocio.wa,
    to,
    '¿A qué producto le sumamos stock?',
    'Ver productos',
    productos.slice(0, 10).map((p) => ({ id: `rprod_${p.id}`, title: p.nombre }))
  );
}

async function avanzarConProducto({ negocio, to, producto, varianteTexto, cantidad }) {
  if (!producto.tiene_variantes) {
    if (cantidad) {
      return armarConfirmacion({ negocio, to, ctx: { producto_id: producto.id, variante_id: null }, cantidad });
    }
    await guardarContexto(negocio.id, { paso: 'cantidad', producto_id: producto.id, variante_id: null });
    return sendText(negocio.wa, to, `¿Cuántas unidades de ${producto.nombre} entraron?`);
  }

  const { data: variantes } = await supabase
    .from('variantes_producto')
    .select('*')
    .eq('producto_id', producto.id)
    .eq('activo', true);

  const disponibles = variantes || [];
  const texto = (varianteTexto || '').toLowerCase().trim();
  const match = texto
    ? disponibles.find((v) => v.atributo1_valor?.toLowerCase() === texto || v.atributo2_valor?.toLowerCase() === texto)
    : null;

  if (match) {
    if (cantidad) {
      return armarConfirmacion({ negocio, to, ctx: { producto_id: producto.id, variante_id: match.id }, cantidad });
    }
    await guardarContexto(negocio.id, { paso: 'cantidad', producto_id: producto.id, variante_id: match.id });
    return sendText(
      negocio.wa,
      to,
      `¿Cuántas unidades de ${producto.nombre} (${descripcionVariante(match)}) entraron?`
    );
  }

  if (!disponibles.length) {
    await guardarContexto(negocio.id, {});
    return sendText(negocio.wa, to, `${producto.nombre} no tiene variantes cargadas todavía.`);
  }

  await guardarContexto(negocio.id, { paso: 'elegir_variante', producto_id: producto.id });
  return sendList(
    negocio.wa,
    to,
    `¿Cuál opción de ${producto.nombre}?`,
    'Ver opciones',
    disponibles.slice(0, 10).map((v) => ({
      id: `rvar_${v.id}`,
      title: descripcionVariante(v),
      description: `${v.stock} en stock`,
    }))
  );
}

/** Devuelve true si manejó el mensaje; false si no hay flujo en curso. */
async function continuar({ entrada, negocio, to }) {
  const ctx = negocio.contexto_admin || {};
  if (!ctx.paso) return false;

  switch (ctx.paso) {
    case 'elegir_producto': {
      if (!entrada?.startsWith('rprod_')) return false;
      const productos = await cargarProductos(negocio.id);
      const producto = productos.find((p) => p.id === entrada.replace('rprod_', ''));
      if (!producto) return false;
      await avanzarConProducto({ negocio, to, producto, varianteTexto: null, cantidad: null });
      return true;
    }

    case 'elegir_variante': {
      if (!entrada?.startsWith('rvar_')) return false;
      const varianteId = entrada.replace('rvar_', '');
      const { data: variante } = await supabase.from('variantes_producto').select('*').eq('id', varianteId).maybeSingle();
      if (!variante) return false;
      const productos = await cargarProductos(negocio.id);
      const producto = productos.find((p) => p.id === variante.producto_id);

      await guardarContexto(negocio.id, {
        paso: 'cantidad',
        producto_id: variante.producto_id,
        variante_id: variante.id,
      });
      await sendText(
        negocio.wa,
        to,
        `¿Cuántas unidades de ${producto?.nombre || 'esto'} (${descripcionVariante(variante)}) entraron?`
      );
      return true;
    }

    case 'cantidad': {
      const cantidad = parseInt(entrada, 10);
      if (!cantidad || cantidad <= 0) {
        await sendText(negocio.wa, to, '¿Cuántas unidades entraron? Decime solo el número 🙂');
        return true;
      }
      return armarConfirmacion({ negocio, to, ctx, cantidad });
    }

    case 'confirmar': {
      if (entrada === 'repo_si') {
        return ejecutarReposicion({ negocio, to, ctx });
      }
      if (entrada === 'repo_no') {
        await guardarContexto(negocio.id, {});
        await sendText(negocio.wa, to, 'Dale, no cargué nada. Avisame cuando quieras.');
        return true;
      }
      return false;
    }

    default:
      return false;
  }
}

async function armarConfirmacion({ negocio, to, ctx, cantidad }) {
  const productos = await cargarProductos(negocio.id);
  const producto = productos.find((p) => p.id === ctx.producto_id);

  if (!producto) {
    await guardarContexto(negocio.id, {});
    await sendText(negocio.wa, to, 'No encontré ese producto.');
    return true;
  }

  let detalle = producto.nombre;
  if (ctx.variante_id) {
    const { data: variante } = await supabase.from('variantes_producto').select('*').eq('id', ctx.variante_id).maybeSingle();
    if (variante) detalle = `${producto.nombre} (${descripcionVariante(variante)})`;
  }

  await guardarContexto(negocio.id, { ...ctx, paso: 'confirmar', cantidad });
  await sendButtons(negocio.wa, to, `¿Confirmás sumar ${cantidad} unidades a ${detalle}?`, [
    { id: 'repo_si', title: 'Sí, confirmar' },
    { id: 'repo_no', title: 'No, cancelar' },
  ]);
  return true;
}

async function ejecutarReposicion({ negocio, to, ctx }) {
  const { data: nuevoStock, error } = await supabase.rpc('fn_reponer_stock', {
    p_negocio_id: negocio.id,
    p_producto_id: ctx.producto_id,
    p_variante_id: ctx.variante_id,
    p_cantidad: ctx.cantidad,
    p_motivo: 'Reposición por WhatsApp (dueño)',
  });

  await guardarContexto(negocio.id, {});

  if (error) {
    console.error('Error reponiendo stock desde WhatsApp:', error);
    await sendText(negocio.wa, to, 'Uy, tuve un problema cargando eso. Probá de nuevo o hacelo desde el panel.');
    return true;
  }

  await sendText(negocio.wa, to, `Listo ✅ Ahora quedan ${nuevoStock} unidades.`);
  return true;
}

module.exports = { iniciar, continuar };
