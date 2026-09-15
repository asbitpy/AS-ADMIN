# AS ADMIN — Checklist maestro de desarrollo

> AS ADMIN es un solo sistema con núcleo común + módulos activables por negocio, para soportar tanto negocios de **servicio** (agenda) como de **retail** (POS/inventario/ventas), incluyendo negocios híbridos. Ver `AS_ADMIN_arquitectura_unificada_v3.md` para el detalle de los 15 módulos.
>
> El proyecto vive en el repositorio git (`asbitpy/AS-ADMIN`): `backend/` (bot de WhatsApp), `panel/` (React + Tailwind + Supabase), `database/` (migraciones `001` a `017`, en orden), `docs/` (este archivo y los demás `.md`).

Documento de referencia único: todo lo que hay que ver, tener y hacer para llevar AS ADMIN del estado actual al lanzamiento con el cliente piloto y más allá. Actualizalo a medida que avances.

---

## 1. Cuentas, accesos y herramientas

- [x] Repositorio Git creado (`asbitpy/AS-ADMIN`)
- [ ] **Meta Business Manager** de AS BIT creado
- [ ] **Verificación de negocio en Meta** iniciada (⚠️ es el trámite que más demora — arrancarlo primero; pueden pedir registro comercial, factura de servicios, etc.)
- [ ] App creada en **Meta for Developers** con el producto WhatsApp agregado
- [ ] ⚠️ Copiar el **App Secret** de esa app (Configuración básica, NO el token de WhatsApp) y cargarlo como `WHATSAPP_APP_SECRET` en el `.env` del backend — sin esto el webhook rechaza todos los mensajes entrantes a propósito (ver `backend/lib/seguridadWebhook.js`)
- [ ] Número del negocio piloto registrado → anotar su `phone_number_id` y token
- [ ] **Plantillas enviadas a aprobación** (categoría utility): recordatorio 24hs, recordatorio mismo día (payloads `rec_confirmo`/`rec_reprogramar`/`rec_cancelar`), alerta de stock bajo (`template_alerta_stock`, ver sección 11) y aviso de derivación a humano (`template_derivacion_humano`, sección 3)
- [ ] **API key de Claude** (Anthropic) activa
- [x] Proyecto de **Supabase** creado (base de datos + auth) — ya en uso, migraciones 001-017 corridas
- [ ] Hosting elegido para el backend (Railway / Render) y para el panel (Vercel) — el backend **todavía no está desplegado en ningún lado**, solo corrido localmente para pruebas puntuales
- [ ] **Dominio** comprado (asadmin.com.py o similar) — revisar disponibilidad
- [ ] `ngrok` (o similar) instalado para probar el webhook en desarrollo
- [ ] Crear el bucket **`productos-fotos`** en Supabase Storage (público: sí) — paso manual, no lo crea ninguna migración (ver `005_retail_rls_y_fotos.sql`)
- [x] Crear el bucket **`comprobantes-pago`** en Supabase Storage (privado: sí) — hecho

## 2. Base de datos

- [x] Migraciones `001` a `017` corridas y verificadas en Supabase (ver tabla de archivos al final de este documento)
- [ ] Cargar el negocio piloto con sus datos reales (servicios, precios, horarios, feriados)
- [ ] Configurar **backups automáticos** (Supabase los incluye — verificar retención del plan)
- [ ] Definir política de acceso a datos sensibles (documentos médicos: solo el profesional)

## 3. Desarrollo — Fase 1 (Agenda + WhatsApp) — estado actual: ~80%

Hecho en el backend actual:
- [x] Webhook con verificación y deduplicación, **y firma de Meta verificada** (`backend/lib/seguridadWebhook.js` — ver sección 1, necesita `WHATSAPP_APP_SECRET`)
- [x] Multi-tenant por `phone_number_id`
- [x] Menú de bienvenida con lista interactiva (adaptado según `modulos_activos` del negocio)
- [x] Clasificador de intenciones híbrido (Claude clasifica, plantillas responden)
- [x] Flujo completo de agendado (servicio → para quién → nombre → franjas → confirmación)
- [x] Motor de agenda con compactado, feriados y revalidación de franjas
- [x] Reprogramar / cancelar / confirmar turnos existentes
- [x] Lista de espera cuando no hay lugar
- [x] Recordatorios 24hs + mismo día (requiere plantillas aprobadas)
- [x] Derivación a humano con prioridad
- [x] Trigger: turno completado → ingreso automático
- [x] Cada negocio responde desde **su propio** número y token de
      WhatsApp (`negocios_credenciales`, migración 008) — antes el bot
      ruteaba bien la entrada pero contestaba siempre desde el número
      del `.env`, lo que rompía con el segundo cliente
- [x] Dos turnos no se pueden pisar: lo garantiza la restricción
      `turnos_sin_solape` en la base (migración 007), no la revalidación
      del bot, que dejaba una ventana entre el chequeo y el insert

Pendiente para cerrar la Fase 1:
- [x] Ofrecer franja liberada al primero de la lista de espera al cancelarse un turno (`backend/lib/flujoListaEspera.js`) — si declina o la franja se ocupó justo antes, cae en cascada al siguiente. No cubre todavía el caso de silencio (sin responder, sin decidir): no hay timeout que pase al siguiente si nadie contesta
- [x] Notificación al dueño cuando una conversación se deriva a humano — usa `negocio.config.telefono_dueno` (mismo campo que las otras alertas). Falta correr `019_notificacion_derivacion.sql` y dar de alta + esperar aprobación de Meta de la plantilla (`template_derivacion_humano`)
- [ ] Probar de punta a punta con el número de prueba de Meta (10-15 conversaciones simuladas, incluyendo los casos especiales de la tabla del árbol v2)
- [x] Red de seguridad si Claude, Supabase o cualquier otra cosa falla procesando un mensaje: antes se perdía en silencio (el cliente se quedaba sin ninguna respuesta); ahora se loguea con contexto y se manda un mensaje de respaldo ("tuve un problema, dame un momento 🙏"). Cubre tanto el canal de clientes como el del dueño. No incluye reintentos automáticos (ej. reintentar la llamada a Claude antes de rendirse) — solo la respuesta segura
- [ ] Desplegar en hosting definitivo con URL estable (adiós ngrok) — bloquea probar cualquiera de los puntos de arriba con WhatsApp real

## 4. Desarrollo — Panel del dueño (parte de Fase 1) — estado actual: ~85%

- [x] Proyecto React mobile-first (Vite + Tailwind, listo para Vercel)
- [x] Login (Supabase Auth) protegido por RLS — un usuario por negocio
- [x] Identidad visual de AS BIT aplicada (dark navy + celeste + morado, Space Grotesk/Inter) con tiempo real (Supabase Realtime) en las pantallas principales
- [x] Vista **Hoy**: navegador de días + lista de turnos/agenda del día
- [x] Alertas de conversaciones derivadas (prioridad alta destacada), con acceso directo al WhatsApp del cliente
- [x] ABM de servicios y precios, ABM de feriados/excepciones, editar dirección
- [x] Marcar turno como **completado** (dispara el ingreso automático), **no_show** o **cancelado**
- [x] Dar de alta el usuario del dueño en Supabase Auth y vincularlo a su negocio — ya en uso activo durante todo el desarrollo
- [x] Historial completo de conversación al tocar una alerta (`HistorialConversacion.jsx`) — WhatsApp sigue siendo el botón para responder, pero ya no hay que abrirlo a ciegas para saber de qué se trata
- [x] Editar horarios de atención desde la UI (`HorariosAtencion.jsx`, en Configuración) — mismo formato que ya lee el motor de disponibilidad del bot
- [x] Selector de profesional para clínicas con más de uno — ABM en Configuración; con 2+ profesionales activos el bot pregunta "¿con quién preferís?" (o "el primero disponible") antes de mostrar franjas; `agenda.js` ahora filtra ocupados por profesional, no solo por negocio. De paso se corrigió un bug real: al reprogramar, el contexto de la conversación se pisaba solo y perdía qué turno se estaba reprogramando
- [x] Probar el flujo de empleado de punta a punta: cuenta de prueba en Supabase Auth, agregada desde Equipo con rol Cajero, logueada y confirmado que la barra de navegación y las rutas respetan el rol (sin Finanzas/Equipo/Config) — **queda pendiente decidir si se borra o se deja esa cuenta de prueba**
- [x] Personalización de color: Configuración → Apariencia, 5 colores de acento a elegir (curados, no selector libre) — se guarda en `negocios.config.color_acento` y se aplica al instante en todo el panel vía variables CSS (`panel/src/lib/temaAccent.js`)

## 5. Desarrollo — Finanzas

- [x] Carga manual de gastos e ingresos (categoría, monto, notas)
- [x] Vista de caja: ingresos vs egresos por día/semana/mes, con lo que "necesita atención" arriba de todo (caja sin cerrar, créditos vencidos, etc.)
- [x] Detalle de cada movimiento financiero individual (no solo el total por categoría) + comprobante adjunto (mismo bucket privado que las ventas) + quién lo cargó (`registrado_por`)
- [x] Gastos fijos mensuales (alquiler, luz, agua...): se definen una vez y Finanzas recuerda confirmarlos el día que corresponde — **nunca se cargan solos**, siempre los confirma una persona (mismo criterio que los comprobantes). Migración `018_gastos_fijos.sql`, componente `GastosFijos.jsx`
- [x] Top de servicios/productos más vendidos ("Lo más vendido", top 5 por cantidad)
- [x] Exportar a CSV (se abre bien en Excel/Sheets) — PDF queda pendiente, necesitaría sumar una librería nueva al panel
- [x] Resumen semanal proactivo al dueño ("esta semana facturaste X") — `backend/lib/resumenSemanal.js`, los lunes en horario comercial; falta correr `020_resumen_semanal.sql` y dar de alta + esperar aprobación de Meta de la plantilla (`template_resumen_semanal`)
- [x] Flujo de caja **proyectado** ("Lo que se viene": pedidos reservados por cobrar, créditos por cobrar, gastos fijos del mes sin confirmar)
- [x] Comparación vs. período anterior en los 3 números principales (Ingresos/Egresos/Neto)

## 6. Visión y voz (Fase futura, sin empezar)

- [ ] Transcripción de audios (clave en Paraguay) con un servicio de speech-to-text
- [ ] Clasificador de imágenes con Claude para fotos/documentos que manda un cliente (no comprobantes de pago — ver la nota abajo)
- [ ] Verificar el estado actual de la integración telefónica de ElevenLabs (documentación oficial) antes de diseñar la fase de voz
- [ ] Modelar el costo por minuto de voz dentro del precio del add-on

> **Decisión de diseño (importante, no reabrir sin una razón nueva):** el bot **nunca** lee ni verifica comprobantes de pago para confirmar que una transferencia es válida — ni con visión de Claude ni con ningún otro método. Una imagen se puede falsificar o corresponder a una transferencia luego reversada; solo una persona mirando su propia app del banco puede confirmar que la plata realmente entró. Lo que sí existe (ver sección 11) es guardar el comprobante como **respaldo/auditoría** en la venta o el movimiento financiero — nunca como confirmación automática.

## 7. Legal y administrativo (pendiente — lo dejamos para después)

- [ ] Confirmar con el contador el rubro SaaS/software en el RUC de AS BIT
- [ ] Términos y condiciones del servicio (AS BIT ↔ negocio cliente)
- [ ] Acuerdo de tratamiento de datos (Ley 6534: negocio = responsable, AS BIT = encargado)
- [ ] Aviso de privacidad plantilla para el cliente final (pacientes)
- [ ] Definir facturación de la suscripción (factura legal, medio de cobro)
- [ ] Revisar todo con un abogado antes del primer contrato real

## 8. Comercial y lanzamiento

- [ ] Confirmar el cliente piloto (clínica o nutricionista actual de AS BIT) y cargar sus datos reales
- [ ] Acordar condiciones del piloto: gratis o muy barato por 30-60 días a cambio de feedback + testimonio
- [ ] Definir precios de los planes en guaraníes (Básico / Negocio / Full / Add-on Voz)
- [ ] Definir cómo cobrar la suscripción (transferencia, Tigo Money, Bancard/dLocal más adelante)
- [ ] Medir la métrica estrella durante el piloto: **tasa de ausencias antes vs. después**
- [ ] Página de AS ADMIN dentro del sitio de AS BIT (con SEO local: "sistema de turnos por WhatsApp Paraguay", etc.)
- [ ] Material de venta con las métricas reales del piloto para salir a buscar los clientes 2-5
- [ ] Manual de uso del panel para el dueño/equipo — descargable o como link directo (explícitamente pausado hasta terminar el resto del producto)
- [ ] Mini link/botón dentro del panel ("¿Problemas técnicos?") que comunique directo con AS BIT — pausado para el final, junto con el manual
- [ ] La "Página de AS ADMIN dentro del sitio de AS BIT" (línea de arriba) cubre también el pedido de una página para promocionar el sistema — mismo ítem, sin duplicar

## 9. Operación continua

- [ ] Monitoreo básico de errores del backend (logs del hosting + alertas)
- [ ] Controlar el costo mensual: conversaciones de Meta + tokens de Claude por negocio
- [ ] Proceso documentado de onboarding de un cliente nuevo (alta de número en Meta, carga de config, plantillas) — cada cliente nuevo debería tomar horas, no días
- [ ] Canal de soporte para los dueños (un WhatsApp de AS BIT, irónicamente puede atenderlo el propio AS ADMIN algún día)

## 10. Retail (POS + inventario + bot retail)

- [x] Núcleo retail: productos con variantes (talle/color), categorías, caja con arqueo, proveedores/compras, créditos de cliente (migración 004 + RLS en 005)
- [x] Panel: ABM de productos con variantes, categorías, fotos, alerta de stock bajo
- [x] Navegación adaptable: pestañas de retail solo visibles si el negocio tiene `pos`/`inventario` activo
- [x] Panel: pantalla de POS (`Venta.jsx`) — búsqueda/escaneo, carrito, pago simple o dividido, `fn_crear_venta()` atómica (precio de servidor + descuento de stock, todo o nada)
- [x] Panel: apertura y cierre de caja con arqueo (`CajaBar.jsx`)
- [x] Panel: comprobante de pago adjunto a la venta (respaldo, nunca verificación automática — ver la nota en sección 6)
- [ ] Definir `modulos_activos` al dar de alta un negocio desde una UI (por ahora se activa a mano en Supabase)
- [x] Panel: vista "Hoy" propia para negocios retail (`HoyRetail.jsx`) — resumen del día, caja, alertas de stock/conversaciones, últimas ventas
- [ ] Reporte de productos más vendidos
- [ ] Decidir el alcance de lector de código de barras (USB primero; cámara del celular, después)
- [ ] Usuarios multiusuario con roles y permisos más finos (hoy existen los roles base de la migración 011; falta UI para permisos por excepción)
- [x] Créditos de clientes: seguimiento de deuda desde el panel (ficha del cliente en Clientes) — registrar crédito manual y marcar pagado. Todavía no está conectado a "vender a crédito" desde el POS (`Venta.jsx` no ofrece 'credito' como método de pago) — eso sigue pendiente si hace falta

## 11. Bot de WhatsApp retail (ver `AS_ADMIN_bot_whatsapp_v3_retail_inventario.md` para el detalle de diseño)

- [x] Etapa 1 — `consultar_stock` y `ver_catalogo` (solo lectura)
- [x] Etapa 2 — `hacer_pedido` y `cancelar_pedido` con reserva de stock (el cliente retira y paga en el local; la reserva vence sola si no la retira)
- [x] Panel: acción para que el cajero complete (`fn_completar_reserva`) o cancele (`fn_cancelar_reserva`) a mano un pedido reservado
- [x] Etapa 3 — Alerta de stock bajo al dueño (`telefono_dueno` cargado) — falta dar de alta y esperar la aprobación de Meta de la plantilla (`template_alerta_stock`, ver sección 1)
- [x] Etapa 4 — Reposición manual de stock: el dueño le escribe al mismo número del negocio y confirma antes de cargar (`backend/lib/dueno.js`)
- [ ] Todo lo de esta sección solo se puede probar con WhatsApp real una vez desplegado el backend (ver sección 1/3) — hasta ahora se verificó la lógica llamando a las funciones de la base directamente

---

## Archivos de referencia del proyecto

| Archivo | Qué contiene |
|---|---|
| `database/001` a `017` (en orden) | Todas las migraciones de base de datos — correrlas en ese orden en el SQL Editor de Supabase |
| `database/seed_demo.sql` | Datos de ejemplo para probar el panel sin cargar todo a mano |
| `AS_ADMIN_arquitectura_unificada_v3.md` | Cómo se unifican servicio + retail: mapa de los 15 módulos, navegación adaptable, riesgos técnicos, roadmap |
| `AS_ADMIN_arbol_conversacion_bot_v2.md` | Árbol de conversación de la personalidad de Agenda del bot, con casos especiales y métricas |
| `AS_ADMIN_bot_whatsapp_v3_retail_inventario.md` | Diseño y estado de las 4 etapas del bot retail (stock, pedidos, alertas, reposición) |
| `AS_ADMIN_pantallas_y_escritorio_v1.md` | Especificación de las 13 pantallas del panel y la decisión de versión de escritorio |
| `AS_ADMIN_vision_y_voz_v3.md` | Módulos futuros de visión (imágenes) y voz (ElevenLabs) |
| `backend/` | Bot de WhatsApp (Node.js + Express + Claude + Supabase) |
| `panel/` | Panel del dueño (React + Vite + Tailwind + Supabase) |
