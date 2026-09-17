require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { handleIncomingMessage } = require('./lib/messageHandler');
const { procesarRecordatorios } = require('./lib/recordatorios');
const { liberarReservasVencidas } = require('./lib/reservas');
const { procesarAlertasStock } = require('./lib/alertasStock');
const { procesarResumenSemanal } = require('./lib/resumenSemanal');
const { verificarFirmaMeta } = require('./lib/seguridadWebhook');
const { usuarioDesdeToken, crearCuentaAuth, resetearPassword } = require('./lib/adminUsuarios');

// Limitador simple en memoria para /api/crear-cuenta y /api/resetear-password:
// sin esto, un token válido filtrado (o un empleado con malas intenciones)
// podía crear cuentas o probar resets sin ningún freno. No sirve para varios
// servidores (mismo caso que los NOTA de los setInterval de abajo), pero acá
// alcanza. 10 intentos cada 15 minutos por IP.
function limitarPorIp(maxIntentos = 10, ventanaMs = 15 * 60 * 1000) {
  const intentos = new Map(); // ip -> [timestamps]
  return (req, res, next) => {
    const ip = req.ip;
    const ahora = Date.now();
    const previos = (intentos.get(ip) || []).filter((t) => ahora - t < ventanaMs);
    if (previos.length >= maxIntentos) {
      return res.status(429).json({ error: 'Demasiados intentos, probá de nuevo en un rato.' });
    }
    previos.push(ahora);
    intentos.set(ip, previos);
    next();
  };
}
const limitarCuentas = limitarPorIp();

const app = express();
// CORS solo hace falta para /api/* (lo llama el panel desde el
// navegador) — el webhook de Meta no pasa por un browser, no lo
// necesita, pero no molesta tenerlo global.
app.use(cors());
// 'verify' guarda el cuerpo crudo antes de parsearlo — hace falta tal
// cual para calcular la firma HMAC, un JSON re-serializado no da el
// mismo hash byte a byte.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

// El panel llama acá para crear la cuenta de Supabase Auth de un
// empleado nuevo o del dueño de un negocio nuevo — antes era un paso a
// mano en el panel de Supabase que un usuario normal no sabe hacer.
// Solo el dueño de un negocio (para su propio equipo) o staff_asbit
// (para dar de alta un negocio cliente nuevo) puede crear cuentas —
// crearCuentaAuth() lo verifica con puedeCrearCuenta().
app.post('/api/crear-cuenta', limitarCuentas, async (req, res) => {
  const usuario = await usuarioDesdeToken(req.headers.authorization);
  if (!usuario) return res.status(401).json({ error: 'No autenticado.' });

  const { email, nombre, password } = req.body || {};
  if (!email || !email.trim()) return res.status(400).json({ error: 'Falta el email.' });

  try {
    const resultado = await crearCuentaAuth({
      llamadorId: usuario.id,
      email: email.trim(),
      nombre: nombre?.trim(),
      passwordElegida: password?.trim(),
    });
    res.json(resultado);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'No se pudo crear la cuenta.' });
  }
});

// Para cuando alguien se olvida la contraseña — queda afuera del panel,
// así que no puede entrar a cambiársela sola. resetearPassword() decide
// adentro si quien llama tiene permiso (su propia cuenta, el dueño de
// su negocio, o staff de AS BIT); acá solo se exige estar logueado.
app.post('/api/resetear-password', limitarCuentas, async (req, res) => {
  const usuario = await usuarioDesdeToken(req.headers.authorization);
  if (!usuario) return res.status(401).json({ error: 'No autenticado.' });

  const { auth_user_id, password } = req.body || {};
  if (!auth_user_id) return res.status(400).json({ error: 'Falta auth_user_id.' });

  try {
    const resultado = await resetearPassword({
      llamadorId: usuario.id,
      authUserId: auth_user_id,
      passwordElegida: password?.trim(),
    });
    res.json(resultado);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'No se pudo resetear la contraseña.' });
  }
});

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

// Meta llama a este GET una sola vez, al configurar el webhook en su panel,
// para confirmar que el servidor es tuyo.
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Si WHATSAPP_VERIFY_TOKEN no está seteado en .env, VERIFY_TOKEN queda
  // undefined — sin el chequeo de abajo, un request sin hub.verify_token
  // también sería undefined y "matchearía", dejando confirmar el webhook
  // a cualquiera. VERIFY_TOKEN tiene que existir Y coincidir.
  if (mode === 'subscribe' && !!VERIFY_TOKEN && token === VERIFY_TOKEN) {
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
