# AS ADMIN — Backend del bot de WhatsApp (v0.2)

Backend funcional: recibe mensajes de WhatsApp, los clasifica con Claude
(arquitectura híbrida) y responde con plantillas fijas. Incluye el flujo
completo de agendado, recordatorios y multi-negocio.

## Qué funciona en esta versión
- Webhook de Meta (verificación + recepción) con **deduplicación** de
  reintentos (índice único por `wa_message_id`)
- **Multi-tenant real**: cada mensaje se enruta al negocio correcto por
  `whatsapp_phone_number_id`, y cada negocio **responde desde su propio
  número** con su propio token (tabla `negocios_credenciales`)
- Menú de bienvenida con **lista interactiva nativa** (sin pedir "escribí 1")
- **Flujo completo de agendado** (máquina de estados en
  `conversaciones.contexto`): servicio → para quién → nombre → franjas
  disponibles → confirmación → guardado en `turnos`
- **Motor de agenda** (`lib/agenda.js`): respeta horarios del negocio,
  feriados, turnos tomados; compacta la agenda priorizando franjas
  pegadas a turnos existentes; revalida antes de confirmar
- **Reprogramación y cancelación** de turnos existentes
- **Lista de espera** cuando no hay franjas
- **Recordatorios automáticos** (24hs + mismo día para los que no
  respondieron) vía plantillas aprobadas de Meta
- Derivación a humano con prioridad (contenido médico, reclamos, pedido
  explícito) — corta cualquier flujo en curso
- Filtro por día con texto libre ("¿tenés el jueves?") usando la fecha
  extraída por el clasificador
- **Trigger de finanzas** (migración 002): turno completado → ingreso
  automático en `movimientos_financieros`

## Qué falta (TODOs marcados en el código)
- Ofrecer la franja liberada al primero de la lista de espera cuando
  alguien cancela
- Clasificación de imágenes (comprobantes/documentos) y transcripción de
  audios — Módulo A del addendum v3 (Fase 4)
- Notificación push/email al dueño cuando una conversación se deriva
- Panel web del dueño (frontend) — proyecto aparte
- Plantillas post-consulta: pedido de reseña de Google y reactivación

## Puesta en marcha

### 1. Base de datos
Todo vive en `../database/`, compartido con el panel — correr en Supabase
(SQL editor) **todas, en orden numérico** (`001` → `008`), aunque el
negocio sea solo de servicio: las tablas de retail simplemente quedan
vacías. Las dos que le importan directamente al bot son:
- `007_precio_servidor_y_antisolape.sql` — su Parte 2 es la que impide
  que dos turnos se pisen en el mismo horario
- `008_whatsapp_por_negocio.sql` — la tabla de credenciales que el bot
  lee para saber desde qué número responder

Después cargar el negocio piloto, por ejemplo:
```sql
insert into negocios (nombre, rubro, direccion, telefono_whatsapp, whatsapp_phone_number_id, config)
values (
  'Consultorio Demo', 'nutricionista', 'Av. Ejemplo 123, Asunción',
  '595981000000',
  'EL_PHONE_NUMBER_ID_DE_META',
  '{
    "horarios": { "lun": ["08:00-12:00","15:00-19:00"], "mar": ["08:00-12:00"], "mie": ["08:00-12:00","15:00-19:00"], "jue": ["08:00-12:00"], "vie": ["08:00-12:00","15:00-19:00"] },
    "horarios_texto": "Lun a Vie de 8 a 12 y de 15 a 19"
  }'
);

insert into servicios (negocio_id, nombre, precio, duracion_minutos, es_recurrente, recurrencia_dias)
values
  ((select id from negocios limit 1), 'Primera consulta', 150000, 45, false, null),
  ((select id from negocios limit 1), 'Control', 100000, 30, true, 15);
```

### 2. Backend
```bash
npm install
cp .env.example .env   # completar credenciales
npm run dev
```

### 3. Exponer a internet (desarrollo)
```bash
ngrok http 3000
```

### 4. Webhook en Meta
Meta for Developers → tu app → WhatsApp → Configuration:
- Callback URL: `https://xxxx.ngrok-free.app/webhook`
- Verify token: el de tu `.env`
- Suscribirse al campo `messages`

### 5. Plantillas de recordatorio (Meta Business Manager)
Crear dos plantillas categoría **utility**, idioma `es`:
- Recordatorio 24hs — cuerpo sugerido:
  `Hola {{1}} 👋 Te recordamos tu turno: {{2}}. ¿Seguís confirmado?`
  con botones de respuesta rápida cuyo payload sea exactamente:
  `rec_confirmo`, `rec_reprogramar`, `rec_cancelar`
- Recordatorio mismo día — cuerpo sugerido:
  `Hola {{1}}, tu turno es hoy: {{2}}. ¿Contamos con vos?`
  con botones `rec_confirmo` y `rec_cancelar`

Cuando estén aprobadas, cargar sus nombres **por negocio**:
```sql
insert into negocios_credenciales (
  negocio_id, whatsapp_token, template_recordatorio_24h, template_recordatorio_hoy
) values (
  (select id from negocios where nombre = 'Consultorio Demo'),
  'TOKEN-PERMANENTE-DE-META', 'recordatorio_24h', 'recordatorio_hoy'
);
```
Si un negocio no tiene fila en `negocios_credenciales`, el bot usa lo que
haya en el `.env` — útil mientras hay un solo número, pero cada cliente
nuevo necesita el suyo.

## Estructura
```
server.js                → servidor, webhook y loop de recordatorios
lib/whatsapp.js           → Cloud API: recibir, texto, botones, listas, plantillas
lib/credenciales.js       → número y token de WhatsApp de cada negocio
lib/claude.js             → clasificador de intenciones (híbrido)
lib/agenda.js             → motor de disponibilidad y formato de fechas
lib/flujoAgendar.js       → máquina de estados del agendado
lib/respuestas.js         → plantillas fijas de respuesta
lib/responder.js          → envía y registra cada respuesta del bot
lib/recordatorios.js      → recordatorios 24hs y mismo día
lib/messageHandler.js     → orquestador principal
lib/supabase.js           → cliente de base de datos
```

Las migraciones de base de datos ya no viven acá — están centralizadas
en `../database/`, compartidas con el panel (ver el README raíz del
proyecto).
