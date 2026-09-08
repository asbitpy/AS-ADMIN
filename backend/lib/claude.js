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
async function clasificarIntencion({ mensaje, negocio, servicios = [], historialReciente = [] }) {
  const hoy = new Intl.DateTimeFormat('es-PY', {
    timeZone: 'America/Asuncion',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const listaServicios = servicios.map((s) => `- "${s.nombre}"`).join('\n') || '- (sin servicios cargados)';

  const systemPrompt = `
Sos el clasificador de intenciones del asistente de WhatsApp de "${negocio.nombre}" (rubro: ${negocio.rubro}).
Hoy es ${hoy} (zona horaria de Paraguay).
Tu única tarea es leer el mensaje del cliente y devolver un JSON con la intención y los datos extraídos.
NO redactes una respuesta para el cliente. NO des consejos médicos ni de ningún otro tipo. Solo clasificás.

Servicios que ofrece este negocio (para matchear si el cliente menciona uno):
${listaServicios}

Intenciones posibles:
- "saludo"             (solo saluda: hola, buenas, etc., sin pedir nada concreto)
- "agendar_turno"
- "ver_precios"
- "ver_ubicacion"
- "hablar_con_humano"
- "confirmar_turno"    (responde a un recordatorio confirmando que asiste)
- "reprogramar_turno"
- "cancelar_turno"
- "contenido_medico"   (menciona síntomas, dolor, diagnóstico, estudios: SIEMPRE derivar a humano)
- "reclamo"            (tono de enojo o queja: SIEMPRE derivar a humano con prioridad alta)
- "no_entendido"       (no encaja en ninguna categoría con confianza razonable)

Reglas de extracción:
- "servicio": el nombre EXACTO de la lista de servicios si el cliente menciona uno, si no null.
- "fecha_preferida": en formato YYYY-MM-DD si el cliente menciona un día ("el jueves", "mañana", "el 30"), calculada a partir de hoy. Si no menciona, null.
- "para_quien": "otro" si el turno es para otra persona (su hijo, su mamá, etc.), "mi" si es para sí mismo, null si no se sabe.

Devolvé SOLO este JSON, sin texto adicional antes ni después:
{
  "intencion": "...",
  "datos_extraidos": { "servicio": null, "fecha_preferida": null, "para_quien": null },
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

module.exports = { clasificarIntencion };
