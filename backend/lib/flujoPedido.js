// Máquina de estados del flujo "hacer pedido" (Etapa 2 del bot retail,
// ver docs/AS_ADMIN_bot_whatsapp_v3_retail_inventario.md). Mismo patrón
// que flujoAgendar.js: el estado vive en conversaciones.contexto (jsonb).
//
// Pasos: elegir_producto -> (elegir_variante) -> (confirmar_apartar, si
// viene de una consulta de stock) -> cantidad -> confirmar -> reservado
//
// El pedido se retira y paga en el local: el bot nunca cobra. Al
// confirmar se llama fn_crear_reserva(), que aparta el stock (mismo
// mecanismo atómico que el POS) con vencimiento — si nadie lo retira,
// fn_liberar_reservas_vencidas() lo libera solo.

const supabase = require('./supabase');
const { responderTexto, responderBotones, responderLista } = require('./responder');
const respuestas = require('./respuestas');

async function guardarContexto(conversacionId, contexto) {
  await supabase.from('conversaciones').update({ contexto }).eq('id', conversacionId);
}

async function cargarProductos(negocioId) {
  const { data } = await supabase
    .from('productos')
    .select('*')
    .eq('negocio_id', negocioId)
    .eq('activo', true);
  return data || [];
}

function descripcionVariante(variante) {
  const partes = [variante.atributo1_valor, variante.atributo2_valor].filter(Boolean);
  return partes.join(' / ') || 'única opción';
}

/** Arranca el flujo. Si ya sabemos el producto (lo extrajo el clasificador,
 *  o viene de un "Sí, apartámelo" tras consultar stock), salta directo. */
async function iniciar({ negocio, conversacion, to, productoNombre = null, varianteTexto = null }) {
  if (!productoNombre) {
    return ofrecerProductos({ negocio, conversacion, to });
  }

  const productos = await cargarProductos(negocio.id);
  const producto = productos.find((p) => p.nombre.toLowerCase() === productoNombre.toLowerCase());

  if (!producto) {
    return ofrecerProductos({ negocio, conversacion, to });
  }

  return avanzarConProducto({ negocio, conversacion, to, producto, varianteTexto });
}

async function ofrecerProductos({ negocio, conversacion, to }) {
  const productos = await cargarProductos(negocio.id);

  if (!productos.length) {
    return responderTexto(negocio.wa, conversacion.id, to, 'Por ahora no tengo productos cargados, ya le aviso al equipo 🙌');
  }

  await guardarContexto(conversacion.id, { flujo: 'pedido', paso: 'elegir_producto' });
  return responderLista(
    negocio.wa,
    conversacion.id,
    to,
    '¿Qué producto querés apartar?',
    'Ver productos',
    // WhatsApp permite máximo 10 filas por lista.
    productos.slice(0, 10).map((p) => ({
      id: `prod_${p.id}`,
      title: p.nombre,
      description: `Gs. ${Number(p.precio).toLocaleString('es-PY')}`,
    }))
  );
}

async function avanzarConProducto({ negocio, conversacion, to, producto, varianteTexto }) {
  if (!producto.tiene_variantes) {
    await guardarContexto(conversacion.id, {
      flujo: 'pedido',
      paso: 'cantidad',
      producto_id: producto.id,
      variante_id: null,
    });
    return responderTexto(negocio.wa, conversacion.id, to, `¿Cuántas unidades de ${producto.nombre} querés?`);
  }

  const { data: variantes } = await supabase
    .from('variantes_producto')
    .select('*')
    .eq('producto_id', producto.id)
    .eq('activo', true);

  const disponibles = (variantes || []).filter((v) => v.stock > 0);
  const texto = (varianteTexto || '').toLowerCase().trim();
  const match = texto
    ? disponibles.find((v) => v.atributo1_valor?.toLowerCase() === texto || v.atributo2_valor?.toLowerCase() === texto)
    : null;

  if (match) {
    await guardarContexto(conversacion.id, {
      flujo: 'pedido',
      paso: 'cantidad',
      producto_id: producto.id,
      variante_id: match.id,
    });
    return responderTexto(
      negocio.wa,
      conversacion.id,
      to,
      `¿Cuántas unidades de ${producto.nombre} (${descripcionVariante(match)}) querés?`
    );
  }

  return ofrecerVariantes({ negocio, conversacion, to, producto, variantes: disponibles });
}

/** Lista interactiva de variantes con stock, para elegir una y pasar a cantidad. */
async function ofrecerVariantes({ negocio, conversacion, to, producto, variantes }) {
  if (!variantes.length) {
    await guardarContexto(conversacion.id, {});
    return responderTexto(negocio.wa, conversacion.id, to, `${producto.nombre} está sin stock por ahora en ninguna opción 😔`);
  }

  await guardarContexto(conversacion.id, { flujo: 'pedido', paso: 'elegir_variante', producto_id: producto.id });
  return responderLista(
    negocio.wa,
    conversacion.id,
    to,
    `¿Cuál opción de ${producto.nombre} querés?`,
    'Ver opciones',
    variantes.slice(0, 10).map((v) => ({ id: `var_${v.id}`, title: descripcionVariante(v), description: `${v.stock} disponibles` }))
  );
}

/** Botón rápido de "¿Querés que te lo aparte?" tras una consulta de stock. */
async function ofrecerApartar({ negocio, conversacion, to, productoId, varianteId }) {
  await guardarContexto(conversacion.id, {
    flujo: 'pedido',
    paso: 'confirmar_apartar',
    producto_id: productoId,
    variante_id: varianteId || null,
  });
  return responderBotones(negocio.wa, conversacion.id, to, '¿Querés que te lo aparte?', [
    { id: 'pedido_si', title: 'Sí, apartámelo' },
    { id: 'pedido_no', title: 'No, gracias' },
  ]);
}

/**
 * Continúa el flujo según el paso guardado en contexto.
 * Devuelve true si manejó el mensaje; false si no corresponde a este flujo.
 */
async function continuar({ entrada, clasificacion, negocio, cliente, conversacion, to }) {
  const ctx = conversacion.contexto || {};
  if (ctx.flujo !== 'pedido') return false;

  switch (ctx.paso) {
    case 'elegir_producto': {
      if (!entrada?.startsWith('prod_')) return false;
      const productos = await cargarProductos(negocio.id);
      const producto = productos.find((p) => p.id === entrada.replace('prod_', ''));
      if (!producto) return false;
      await avanzarConProducto({ negocio, conversacion, to, producto, varianteTexto: null });
      return true;
    }

    case 'elegir_variante': {
      if (!entrada?.startsWith('var_')) return false;
      const varianteId = entrada.replace('var_', '');
      const { data: variante } = await supabase.from('variantes_producto').select('*').eq('id', varianteId).maybeSingle();
      if (!variante) return false;
      const productos = await cargarProductos(negocio.id);
      const producto = productos.find((p) => p.id === variante.producto_id);

      await guardarContexto(conversacion.id, {
        flujo: 'pedido',
        paso: 'cantidad',
        producto_id: variante.producto_id,
        variante_id: variante.id,
      });
      await responderTexto(
        negocio.wa,
        conversacion.id,
        to,
        `¿Cuántas unidades de ${producto?.nombre || 'esto'} (${descripcionVariante(variante)}) querés?`
      );
      return true;
    }

    case 'confirmar_apartar': {
      if (entrada === 'pedido_si') {
        await guardarContexto(conversacion.id, { ...ctx, paso: 'cantidad' });
        await responderTexto(negocio.wa, conversacion.id, to, '¿Cuántas unidades querés?');
        return true;
      }
      if (entrada === 'pedido_no') {
        await guardarContexto(conversacion.id, {});
        await responderTexto(negocio.wa, conversacion.id, to, 'Dale, cualquier cosa avisame 🙌');
        return true;
      }
      return false;
    }

    case 'cantidad': {
      const cantidad = parseInt(entrada, 10);
      if (!cantidad || cantidad <= 0) {
        await responderTexto(negocio.wa, conversacion.id, to, '¿Cuántas unidades querés? Decime solo el número 🙂');
        return true;
      }
      return armarConfirmacion({ negocio, conversacion, to, ctx, cantidad });
    }

    case 'confirmar': {
      if (entrada === 'pedido_confirmar') {
        return confirmarReserva({ negocio, cliente, conversacion, to, ctx });
      }
      if (entrada === 'pedido_cancelar') {
        await guardarContexto(conversacion.id, {});
        await responderTexto(negocio.wa, conversacion.id, to, 'Dale, quedó sin apartar. Cualquier cosa, escribime 🙌');
        return true;
      }
      return false;
    }

    default:
      return false;
  }
}

async function armarConfirmacion({ negocio, conversacion, to, ctx, cantidad }) {
  const productos = await cargarProductos(negocio.id);
  const producto = productos.find((p) => p.id === ctx.producto_id);

  if (!producto) {
    await guardarContexto(conversacion.id, {});
    await responderTexto(negocio.wa, conversacion.id, to, respuestas.productoNoEncontrado());
    return true;
  }

  let precioUnitario = Number(producto.precio);
  let stockDisponible = producto.stock;
  let detalle = producto.nombre;

  if (ctx.variante_id) {
    const { data: variante } = await supabase.from('variantes_producto').select('*').eq('id', ctx.variante_id).maybeSingle();
    if (!variante) {
      await guardarContexto(conversacion.id, {});
      await responderTexto(negocio.wa, conversacion.id, to, respuestas.productoNoEncontrado());
      return true;
    }
    precioUnitario = Number(variante.precio_override ?? producto.precio);
    stockDisponible = variante.stock;
    detalle = `${producto.nombre} (${descripcionVariante(variante)})`;
  }

  if (cantidad > stockDisponible) {
    await responderTexto(negocio.wa, conversacion.id, to, `Uy, solo tengo ${stockDisponible} disponibles 😔 ¿Cuántas querés?`);
    return true; // se queda en el paso 'cantidad', el contexto no cambió
  }

  const total = precioUnitario * cantidad;
  await guardarContexto(conversacion.id, { ...ctx, paso: 'confirmar', cantidad, total });
  await responderBotones(
    negocio.wa,
    conversacion.id,
    to,
    `${detalle} x${cantidad} - Gs. ${total.toLocaleString('es-PY')}\nLo retirás y pagás en el local.\n¿Confirmás?`,
    [
      { id: 'pedido_confirmar', title: '✅ Confirmar' },
      { id: 'pedido_cancelar', title: 'Cancelar' },
    ]
  );
  return true;
}

async function confirmarReserva({ negocio, cliente, conversacion, to, ctx }) {
  const horas = Number(negocio.config?.reserva_horas) || 4;

  const { error } = await supabase.rpc('fn_crear_reserva', {
    p_negocio_id: negocio.id,
    p_cliente_id: cliente.id,
    p_items: [{ producto_id: ctx.producto_id, variante_id: ctx.variante_id, cantidad: ctx.cantidad }],
    p_horas_para_retirar: horas,
  });

  await guardarContexto(conversacion.id, {});

  if (error) {
    if (error.message?.includes('Stock insuficiente')) {
      await responderTexto(
        negocio.wa,
        conversacion.id,
        to,
        'Uy, justo se agotó mientras decidías 😔 Escribime el nombre del producto si querés ver otra opción.',
        'hacer_pedido'
      );
      return true;
    }
    console.error('Error creando reserva de pedido:', error);
    await responderTexto(
      negocio.wa,
      conversacion.id,
      to,
      'Uy, tuve un problema apartándolo. Ya le aviso al equipo para que te ayude 🙏',
      'hacer_pedido'
    );
    return true;
  }

  const vence = new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(Date.now() + horas * 3600000));

  await responderTexto(
    negocio.wa,
    conversacion.id,
    to,
    `¡Listo! ✅ Te lo dejamos apartado hasta las ${vence}. Lo retirás y pagás en el local. Cualquier cosa, avisanos.`,
    'hacer_pedido'
  );
  return true;
}

/** Limpia el flujo (cuando el cliente cambia de tema o se deriva a humano) */
async function limpiar(conversacionId) {
  await guardarContexto(conversacionId, {});
}

module.exports = { iniciar, continuar, limpiar, ofrecerApartar, ofrecerVariantes };
