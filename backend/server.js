require('dotenv').config();
const express = require('express');
const { handleIncomingMessage } = require('./lib/messageHandler');
const { procesarRecordatorios } = require('./lib/recordatorios');
const { liberarReservasVencidas } = require('./lib/reservas');
const { procesarAlertasStock } = require('./lib/alertasStock');
const { procesarResumenSemanal } = require('./lib/resumenSemanal');
const { verificarFirmaMeta } = require('./lib/seguridadWebhook');

const app = express();
// 'verify' guarda el cuerpo crudo antes de parsearlo — hace falta tal
// cual para calcular la firma HMAC, un JSON re-serializado no da el
// mismo hash byte a byte.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

// Meta llama a este GET una sola vez, al configurar el webhook en su panel,
// para confirmar que el servidor es tuyo.
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado ✅');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Acá llegan los mensajes reales de los clientes por WhatsApp.
app.post('/webhook', verificarFirmaMeta, async (req, res) => {
  // Respondemos 200 de inmediato: si Meta no recibe respuesta rápida,
  // reintenta el envío. La deduplicación por wa_message_id nos protege
  // igual si un reintento llega a colarse.
  res.sendStatus(200);

  try {
    await handleIncomingMessage(req.body);
  } catch (err) {
    console.error('Error procesando mensaje entrante:', err);
  }
});

app.get('/', (_req, res) => res.send('AS ADMIN backend funcionando ✅'));

// Procesador de recordatorios: revisa cada 5 minutos si hay turnos que
// necesitan el recordatorio de 24hs o el del mismo día.
// NOTA: para producción con varios servidores, mover esto a un cron job
// externo (ej. Supabase Scheduled Functions o un cron de Railway) para
// que no corra duplicado en cada instancia.
if (process.env.RECORDATORIOS_ACTIVOS !== 'false') {
  setInterval(() => {
    procesarRecordatorios().catch((err) =>
      console.error('Error en procesador de recordatorios:', err)
    );
  }, 5 * 60 * 1000);
}

// Libera el stock de las reservas de pedido por WhatsApp que vencieron
// sin retiro. Mismo NOTA que arriba: para varios servidores, mover a un
// cron externo para que no corra duplicado en cada instancia.
if (process.env.RESERVAS_ACTIVAS !== 'false') {
  setInterval(() => {
    liberarReservasVencidas().catch((err) =>
      console.error('Error liberando reservas vencidas:', err)
    );
  }, 5 * 60 * 1000);
}

// Avisa al dueño por WhatsApp cuando un producto cruza su stock mínimo.
// Mismo NOTA que arriba: para varios servidores, mover a un cron externo.
if (process.env.ALERTAS_STOCK_ACTIVAS !== 'false') {
  setInterval(() => {
    procesarAlertasStock().catch((err) =>
      console.error('Error procesando alertas de stock:', err)
    );
  }, 5 * 60 * 1000);
}

// Resumen semanal al dueño, los lunes. Mismo NOTA que arriba.
if (process.env.RESUMEN_SEMANAL_ACTIVO !== 'false') {
  setInterval(() => {
    procesarResumenSemanal().catch((err) =>
      console.error('Error procesando resumen semanal:', err)
    );
  }, 5 * 60 * 1000);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AS ADMIN backend escuchando en puerto ${PORT}`));
