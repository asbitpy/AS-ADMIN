# AS ADMIN — Checklist maestro de desarrollo

> **Decisión clave (actualización):** AS ADMIN se unificó en un solo sistema con núcleo común + módulos activables por negocio, para soportar tanto negocios de **servicio** (agenda) como de **retail** (POS/inventario/ventas), incluyendo negocios híbridos. Ver `AS_ADMIN_arquitectura_unificada_v3.md` para el detalle completo de los 15 módulos, y `AS_ADMIN_migracion_004_retail_core.sql` para la base de datos del núcleo retail.
>
> **Todo el proyecto (backend + panel + base de datos + docs) ya está consolidado en una sola carpeta: `as-admin.zip`.** Es el punto de partida para abrir en Claude Code — el README raíz de esa carpeta orienta la estructura completa.

Documento de referencia único: todo lo que hay que ver, tener y hacer para llevar AS ADMIN del estado actual al lanzamiento con el cliente piloto y más allá. Actualizalo a medida que avances.

---

## 1. Cuentas, accesos y herramientas

- [ ] **Meta Business Manager** de AS BIT creado
- [ ] **Verificación de negocio en Meta** iniciada (⚠️ es el trámite que más demora — arrancarlo primero; pueden pedir registro comercial, factura de servicios, etc.)
- [ ] App creada en **Meta for Developers** con el producto WhatsApp agregado
- [ ] Número del negocio piloto registrado → anotar su `phone_number_id` y token
- [ ] **Plantillas enviadas a aprobación** (categoría utility): recordatorio 24hs, recordatorio mismo día (con payloads `rec_confirmo` / `rec_reprogramar` / `rec_cancelar`)
- [ ] **API key de Claude** (Anthropic) activa
- [ ] Proyecto de **Supabase** creado (base de datos + auth)
- [ ] Hosting elegido para el backend (Railway / Render) y para el panel (Vercel)
- [ ] **Dominio** comprado (asadmin.com.py o similar) — revisar disponibilidad
- [ ] `ngrok` (o similar) instalado para probar el webhook en desarrollo
- [ ] Repositorio Git creado (el zip actual como commit inicial)

## 2. Base de datos

- [ ] Correr `AS_ADMIN_esquema_base_datos.sql` en Supabase
- [ ] Correr `migrations/002_mejoras_flujo.sql`
- [ ] Cargar el negocio piloto con sus datos reales (servicios, precios, horarios, feriados)
- [ ] Configurar **backups automáticos** (Supabase los incluye — verificar retención del plan)
- [ ] Definir política de acceso a datos sensibles (documentos médicos: solo el profesional)

## 3. Desarrollo — Fase 1 (Agenda + WhatsApp) — estado actual: ~80%

Hecho en el backend actual:
- [x] Webhook con verificación y deduplicación
- [x] Multi-tenant por `phone_number_id`
- [x] Menú de bienvenida con lista interactiva
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
- [ ] Ofrecer franja liberada al primero de la lista de espera al cancelarse un turno
- [ ] Notificación al dueño cuando una conversación se deriva (email / push / WhatsApp al dueño)
- [ ] Probar de punta a punta con el número de prueba de Meta (10-15 conversaciones simuladas, incluyendo los casos especiales de la tabla del árbol v2)
- [ ] Manejo de errores y reintentos si la API de Claude o Supabase fallan mediante una respuesta segura ("dame un momento 🙌" + log)
- [ ] Desplegar en hosting definitivo con URL estable (adiós ngrok)

## 4. Desarrollo — Panel del dueño (parte de Fase 1) — estado actual: ~80%

- [x] Proyecto React mobile-first (Vite + Tailwind, listo para Vercel)
- [x] Login (Supabase Auth) protegido por RLS — un usuario por negocio
- [x] Vista **HOY**: métricas del día + línea de tiempo con los turnos y su estado
- [x] Alertas de conversaciones derivadas (prioridad alta destacada), con acceso directo al WhatsApp del cliente
- [x] ABM de servicios y precios, ABM de feriados/excepciones, editar dirección
- [x] Marcar turno como **completado** (dispara el ingreso automático), **no_show** o **cancelado**
- [x] Ingreso de la semana visible en la vista Hoy
- [ ] Historial completo de conversación al tocar una alerta (hoy abre WhatsApp directo)
- [ ] Editar horarios de atención desde la UI (hoy se edita en Supabase directo)
- [ ] Selector de profesional para clínicas con más de uno
- [ ] Dar de alta el usuario del dueño en Supabase Auth y vincularlo a su negocio (paso manual, documentado en el README del panel)

## 5. Desarrollo — Fase 2 (Finanzas simples)

- [ ] Carga manual de gastos (categoría, monto, fecha)
- [ ] Vista de caja: ingresos vs egresos por día/semana/mes
- [ ] Top de servicios más vendidos
- [ ] Exportar a Excel/PDF (para el contador / e-Kuatia)
- [ ] Resumen semanal proactivo al dueño ("esta semana facturaste X")

## 6. Desarrollo — Fase 3 (Inventario opcional)

- [ ] ABM de productos con stock y stock mínimo
- [ ] Registrar venta de producto (asociable a un turno)
- [ ] Alerta de stock bajo
- [ ] Reporte de productos más vendidos

## 7. Desarrollo — Fase 4 (Visión) y Fase 5 (Voz)

- [ ] Clasificador de imágenes con Claude: comprobante de pago / documento médico / referencia / irrelevante (según Módulo A del addendum v3)
- [ ] Flujo de comprobante: "parece un pago de Gs. X" → el dueño confirma con un toque
- [ ] Transcripción de audios (clave en Paraguay) con un servicio de speech-to-text
- [ ] Verificar el estado actual de la integración telefónica de ElevenLabs (documentación oficial) antes de diseñar la Fase 5
- [ ] Modelar el costo por minuto de voz dentro del precio del add-on

## 8. Legal y administrativo (pendiente — lo dejamos para después)

- [ ] Confirmar con el contador el rubro SaaS/software en el RUC de AS BIT
- [ ] Términos y condiciones del servicio (AS BIT ↔ negocio cliente)
- [ ] Acuerdo de tratamiento de datos (Ley 6534: negocio = responsable, AS BIT = encargado)
- [ ] Aviso de privacidad plantilla para el cliente final (pacientes)
- [ ] Definir facturación de la suscripción (factura legal, medio de cobro)
- [ ] Revisar todo con un abogado antes del primer contrato real

## 9. Comercial y lanzamiento

- [ ] Confirmar el cliente piloto (clínica o nutricionista actual de AS BIT) y cargar sus datos reales
- [ ] Acordar condiciones del piloto: gratis o muy barato por 30-60 días a cambio de feedback + testimonio
- [ ] Definir precios de los planes en guaraníes (Básico / Negocio / Full / Add-on Voz)
- [ ] Definir cómo cobrar la suscripción (transferencia, Tigo Money, Bancard/dLocal más adelante)
- [ ] Medir la métrica estrella durante el piloto: **tasa de ausencias antes vs. después**
- [ ] Página de AS ADMIN dentro del sitio de AS BIT (con SEO local: "sistema de turnos por WhatsApp Paraguay", etc. — tu especialidad)
- [ ] Material de venta con las métricas reales del piloto para salir a buscar los clientes 2-5

## 10. Operación continua

- [ ] Monitoreo básico de errores del backend (logs del hosting + alertas)
- [ ] Controlar el costo mensual: conversaciones de Meta + tokens de Claude por negocio
- [ ] Proceso documentado de onboarding de un cliente nuevo (alta de número en Meta, carga de config, plantillas) — cada cliente nuevo debería tomar horas, no días
- [ ] Canal de soporte para los dueños (un WhatsApp de AS BIT, irónicamente puede atenderlo el propio AS ADMIN algún día)

## 11. Retail (Fase 4 — núcleo nuevo)

- [x] Correr `AS_ADMIN_migracion_004_retail_core.sql` en Supabase (después de 003)
- [x] Agregar políticas de RLS para las tablas nuevas (`005_retail_rls_y_fotos.sql`)
- [x] Panel: ABM de productos con variantes (talle/color), categorías, fotos, alerta de stock bajo
- [x] Navegación adaptable: pestaña Productos solo visible si el negocio tiene `pos`/`inventario` activo
- [ ] Definir `modulos_activos` al dar de alta un negocio desde una UI (por ahora se activa a mano, ver README del panel)
- [ ] Backend: endpoint/flujo de POS (crear venta + items, llamar a `fn_descontar_stock()` dentro de la misma transacción)
- [x] Panel: pantalla de POS (búsqueda de producto, carrito, cobro) — `Venta.jsx`, con `fn_crear_venta()` como operación atómica (venta + items + descuento de stock, todo o nada)
- [x] El precio de cada venta lo pone el servidor leyendo el catálogo
      (`fn_precio_vigente` + `fn_crear_venta`, migración 007). Antes el
      panel mandaba el precio y la base lo aceptaba: con cajeros y
      vendedores en el roadmap, eso era plata real. También arregla que
      el POS cobrara el precio del padre ignorando `precio_override` de
      la variante
- [x] Panel: apertura y cierre de caja con arqueo (`CajaBar.jsx`) — monto inicial, gastos/retiros durante el día, diferencia entre caja esperada y contada al cerrar. No bloquea la venta si está cerrada
- [ ] Panel: vista "Hoy" para negocios retail (resumen de caja del día) — hoy un negocio sin `agenda` cae directo a Productos
- [ ] Bot de WhatsApp: nuevas intenciones (`consultar_stock`, `hacer_pedido`) y su árbol de respuesta
- [ ] Decidir el alcance de lector de código de barras (USB primero; cámara del celular, después)
- [ ] Proveedores y Compras (ABM + órdenes de compra)
- [ ] Usuarios multiusuario con roles y permisos (admin/gerente/vendedor/cajero)
- [ ] Créditos de clientes (venta a crédito, seguimiento de deuda)

---

## Archivos de referencia del proyecto

| Archivo | Qué contiene |
|---|---|
| `AS_ADMIN_arbol_conversacion_bot_v2.md` | Árbol de conversación completo con casos especiales y métricas |
| `AS_ADMIN_vision_y_voz_v3.md` | Módulos de visión (imágenes) y voz (ElevenLabs) |
| `AS_ADMIN_esquema_base_datos.sql` | Esquema base de la base de datos |
| `as-admin-backend.zip` → `migrations/002_mejoras_flujo.sql` | Mejoras de esquema + trigger de finanzas |
| `as-admin-backend.zip` | Backend v0.2 completo con README de puesta en marcha |
| `as-admin-panel.zip` | Panel del dueño (React + Tailwind + Supabase), con `migrations/003_panel_auth_rls.sql` |
| `AS_ADMIN_arquitectura_unificada_v3.md` | Cómo se unifican servicio + retail: mapa de los 15 módulos, navegación adaptable, riesgos técnicos, roadmap |
| `AS_ADMIN_migracion_004_retail_core.sql` | Base de datos del núcleo retail: productos con variantes, POS, caja con arqueo, proveedores, compras, créditos |
| `as-admin.zip` | **Proyecto completo consolidado** (backend + panel + database/ + docs/), listo para abrir en Claude Code |
| Informe de investigación ERP/CRM | Benchmarks y los 8 principios de diseño |
