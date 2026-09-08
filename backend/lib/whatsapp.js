// Helpers para recibir y mandar mensajes con la WhatsApp Cloud API de Meta.
//
// Todas las funciones de envío reciben las credenciales del negocio que
// está hablando (`wa`), en vez de leer un número fijo del .env: cada
// negocio responde desde SU propio número de WhatsApp. Las credenciales
// se arman en lib/credenciales.js.

const GRAPH_VERSION = 'v20.0';

function urlDe(wa) {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${wa.phoneNumberId}/messages`;
}

async function llamarApi(wa, payload) {
  if (!wa?.phoneNumberId || !wa?.token) {
    console.error('WhatsApp: negocio sin credenciales configuradas — no se envía nada.');
    return null;
  }

  const res = await fetch(urlDe(wa), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${wa.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    console.error(`WhatsApp API respondió ${res.status}: ${detalle}`);
  }
  return res;
}

/**
 * Extrae los datos útiles del payload crudo que manda Meta.
 * Devuelve null si el webhook trae un evento de estado (entregado/leído)
 * en vez de un mensaje real de un cliente.
 */
function parseIncomingMessage(body) {
  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0]?.value;
  const message = change?.messages?.[0];

  if (!message) return null;

  return {
    from: message.from, // número del cliente
    phoneNumberId: change?.metadata?.phone_number_id, // qué negocio recibió el mensaje
    type: message.type, // 'text' | 'image' | 'audio' | 'video' | 'interactive' | 'button' | ...
    text: message.text?.body || null,
    // Respuesta a botones interactivos o listas que mandó el bot:
    interactiveReplyId:
      message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || null,
    // Respuesta a los botones de una PLANTILLA (ej. el recordatorio):
    templateButtonPayload: message.button?.payload || message.button?.text || null,
    mediaId: message.image?.id || message.video?.id || message.audio?.id || null,
    waMessageId: message.id,
  };
}

/** Manda un mensaje de texto simple. */
function sendText(wa, to, text) {
  return llamarApi(wa, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  });
}

/**
 * Botones de respuesta rápida (máximo 3 — límite de la API de Meta).
 * buttons: [{ id: 'pq_mi', title: 'Para mí' }, ...]
 */
function sendButtons(wa, to, bodyText, buttons) {
  return llamarApi(wa, {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
  });
}

/**
 * Mensaje de lista (hasta 10 opciones — para menú, servicios y franjas).
 * rows: [{ id: 'serv_xxx', title: 'Primera consulta', description?: '' }]
 */
function sendList(wa, to, bodyText, buttonTitle, rows) {
  return llamarApi(wa, {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      action: {
        button: buttonTitle.slice(0, 20),
        sections: [
          {
            title: 'Opciones',
            rows: rows.slice(0, 10).map((r) => ({
              id: r.id,
              title: r.title.slice(0, 24),
              description: r.description ? r.description.slice(0, 72) : undefined,
            })),
          },
        ],
      },
    },
  });
}

/**
 * Plantilla aprobada por Meta — necesaria para mensajes fuera de la
 * ventana de 24hs (recordatorios, reactivación, pedido de reseña).
 * bodyParams: valores para los {{1}}, {{2}}... del cuerpo de la plantilla.
 */
function sendTemplate(wa, to, templateName, bodyParams = []) {
  const components = bodyParams.length
    ? [
        {
          type: 'body',
          parameters: bodyParams.map((t) => ({ type: 'text', text: String(t) })),
        },
      ]
    : undefined;

  return llamarApi(wa, {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: { name: templateName, language: { code: 'es' }, components },
  });
}

module.exports = { parseIncomingMessage, sendText, sendButtons, sendList, sendTemplate };
