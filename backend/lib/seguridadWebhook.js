// Verifica que un POST a /webhook venga de verdad de Meta.
//
// Sin esto, cualquiera que encuentre la URL del webhook puede mandar un
// POST fingiendo ser un mensaje de WhatsApp — crear reservas falsas,
// gastar la cuota de la API de Claude, o inundar el bot de "reclamos"
// para saturar la derivación a humano. Meta firma cada request con HMAC
// SHA-256 del cuerpo crudo, usando el App Secret de la app de Meta for
// Developers (Configuración básica → App Secret) — nunca el token de
// WhatsApp ni el verify token, que son cosas distintas.
//
// Documentación oficial: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads

const crypto = require('crypto');

function verificarFirmaMeta(req, res, next) {
  const secret = process.env.WHATSAPP_APP_SECRET;

  if (!secret) {
    // Fallar cerrado, no abierto: sin secreto configurado no hay forma
    // de confirmar el origen, así que se rechaza en vez de confiar.
    console.error('WHATSAPP_APP_SECRET no configurado — se rechaza el webhook por seguridad.');
    return res.sendStatus(500);
  }

  const firmaRecibida = req.headers['x-hub-signature-256'];
  if (!firmaRecibida || !req.rawBody) {
    return res.sendStatus(401);
  }

  const firmaEsperada = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');

  const bufRecibido = Buffer.from(firmaRecibida);
  const bufEsperado = Buffer.from(firmaEsperada);

  // Largos distintos primero: timingSafeEqual explota si no coinciden.
  const coincide =
    bufRecibido.length === bufEsperado.length && crypto.timingSafeEqual(bufRecibido, bufEsperado);

  if (!coincide) {
    console.warn('Webhook rechazado: firma inválida (posible request falsificado).');
    return res.sendStatus(401);
  }

  next();
}

module.exports = { verificarFirmaMeta };
