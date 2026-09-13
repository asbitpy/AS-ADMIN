const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Clasifica la intención de un mensaje de texto del cliente.
 *
 * IMPORTANTE (arquitectura híbrida): esta función NUNCA redacta la
 * respuesta final para el cliente. Solo devuelve una intención
 * estructurada; las respuestas reales salen de lib/respuestas.js
 * (plantillas fijas). Así un precio o una confirmación de turno
 * nunca pueden salir "inventados" por el modelo.
 */
async function clasificarIntencion({ mensaje, negocio, servicios = [], productos = [], historialReciente = [] }) {
  const hoy = new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const modulos = negocio.modulos_activos || ['agenda'];
  const tieneAgenda = modulos.includes('agenda');
  const tienePos = modulos.includes('pos');

  const intencionesAgenda = tieneAgenda
    ? `- "agendar_turno"
- "ver_precios"
- "confirmar_turno"    (responde a un recordatorio confirmando que asiste)
- "reprogramar_turno"
- "cancelar_turno"`
    : '';

  const intencionesRetail = tienePos
    ? `- "consultar_stock"   (pregunta si hay disponible un producto, en qué talle/color, etc.)
- "ver_catalogo"      (pide ver qué productos hay, sin nombrar uno puntual)
- "hacer_pedido"       (quiere apartar/comprar un producto puntual: "lo quiero", "me lo reservás", "te lo compro")
- "cancelar_pedido"    (quiere cancelar un pedido/reserva que ya hizo)`
    : '';

  const listaServicios = tieneAgenda
    ? `\nServicios que ofrece este negocio (para matchear si el cliente menciona uno):\n${
        servicios.map((s) => `- "${s.nombre}"`).join('\n') || '- (sin servicios cargados)'
      }\n`
    : '';

  const listaProductos = tienePos
    ? `\nProductos que vende este negocio (para matchear si el cliente menciona uno; el nombre debe salir EXACTO de esta lista):\n${
        productos.map((p) => `- "${p.nombre}"`).join('\n') || '- (sin productos cargados)'
      }\n`
    : '';

  const systemPrompt = `
Sos el clasificador de intenciones del asistente de WhatsApp de "${negocio.nombre}" (rubro: ${negocio.rubro}).
Hoy es ${hoy} (zona horaria de Paraguay).
Tu única tarea es leer el mensaje del cliente y devolver un JSON con la intención y los datos extraídos.
NO redactes una respuesta para el cliente. NO des consejos médicos ni de ningún otro tipo. Solo clasificás.
${listaServicios}${listaProductos}
Intenciones posibles:
- "saludo"             (solo saluda: hola, buenas, etc., sin pedir nada concreto)
${intencionesAgenda}
${intencionesRetail}
- "ver_ubicacion"
- "hablar_con_humano"
- "contenido_medico"   (menciona síntomas, dolor, diagnóstico, estudios: SIEMPRE derivar a humano)
- "reclamo"            (tono de enojo o queja: SIEMPRE derivar a humano con prioridad alta)
- "no_entendido"       (no encaja en ninguna categoría con confianza razonable)

Reglas de extracción:
- "servicio": el nombre EXACTO de la lista de servicios si el cliente menciona uno, si no null.
- "producto": el nombre EXACTO de la lista de productos si el cliente menciona uno, si no null.
- "variante": si menciona talle, color u otra variante puntual ("M", "negro", "42"), el texto tal cual lo dijo, si no null.
- "fecha_preferida": en formato YYYY-MM-DD si el cliente menciona un día ("el jueves", "mañana", "el 30"), calculada a partir de hoy. Si no menciona, null.
- "para_quien": "otro" si el turno es para otra persona (su hijo, su mamá, etc.), "mi" si es para sí mismo, null si no se sabe.

Devolvé SOLO este JSON, sin texto adicional antes ni después:
{
  "intencion": "...",
  "datos_extraidos": { "servicio": null, "producto": null, "variante": null, "fecha_preferida": null, "para_quien": null },
  "confianza": "alta" | "media" | "baja"
}
`.trim();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: systemPrompt,
    messages: [...historialReciente, { role: 'user', content: mensaje }],
  });

  const textoRespuesta = response.content.find((b) => b.type === 'text')?.text || '{}';

  try {
    // Por si el modelo envuelve el JSON en ```json ... ```
    const limpio = textoRespuesta.replace(/```json|```/g, '').trim();
    return JSON.parse(limpio);
  } catch {
    return { intencion: 'no_entendido', datos_extraidos: {}, confianza: 'baja' };
  }
}

/**
 * Clasifica un mensaje del DUEÑO del negocio (canal aparte: le habla al
 * mismo número de WhatsApp, pero nunca es un cliente). Alcance mínimo a
 * propósito — solo reponer stock, nada de las intenciones de cliente.
 */
async function clasificarComandoDueno({ mensaje, negocio, productos = [] }) {
  const listaProductos =
    productos.map((p) => `- "${p.nombre}"`).join('\n') || '- (sin productos cargados)';

  const systemPrompt = `
Sos el asistente interno para el DUEÑO de "${negocio.nombre}" — nunca le hablás a un cliente acá.
Tu única tarea es leer su mensaje y devolver un JSON con la intención y los datos extraídos.
NO redactes una respuesta. Solo clasificás.

Productos de este negocio (el nombre debe salir EXACTO de esta lista):
${listaProductos}

Intenciones posibles:
- "reponer_stock"   (avisa que sumó unidades a un producto: "cargá", "sumá", "llegaron", "repuse", "entraron")
- "saludo"
- "no_entendido"

Reglas de extracción:
- "producto": el nombre EXACTO de la lista si lo menciona, si no null.
- "variante": talle/color si lo menciona ("M", "negro"), si no null.
- "cantidad": el número de unidades si lo dice, si no null.

Devolvé SOLO este JSON, sin texto adicional antes ni después:
{
  "intencion": "...",
  "datos_extraidos": { "producto": null, "variante": null, "cantidad": null }
}
`.trim();

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    system: systemPrompt,
    messages: [{ role: 'user', content: mensaje }],
  });

  const textoRespuesta = response.content.find((b) => b.type === 'text')?.text || '{}';

  try {
    const limpio = textoRespuesta.replace(/```json|```/g, '').trim();
    return JSON.parse(limpio);
  } catch {
    return { intencion: 'no_entendido', datos_extraidos: {} };
  }
}

module.exports = { clasificarIntencion, clasificarComandoDueno };
