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

**Decisión (2026-09-14):** la versión celular actual queda **tal cual está** — Arturo la revisó y la dio por buena, no hay que achicar ni sacar nada de ahí. Lo que sigue es sumar una **versión de escritorio** (mismo código, con más espacio y más detalle — no una app aparte, ver `AS_ADMIN_pantallas_y_escritorio_v1.md`, actualizado con la regla concreta: `< 1280px` = panel de siempre sin cambios, `≥ 1280px` = barra lateral con más detalle).

- [x] Shell de escritorio (`Layout.jsx`): barra lateral agrupada (Atender/Vender/Administrar) que aparece desde `1280px` reales — confirmado funcionando; fijada con `sticky` (no bajaba con el resto de la página en pantallas largas como Finanzas — afecta a todas las pantallas de escritorio, no solo esa)
- [x] Fix: la pantalla "saltaba" de tamaño cada vez que se tocaba un panel distinto — el efecto que agranda la letra en escritorio (20px) estaba duplicado en cada pantalla que usa `useEsEscritorio` (Clientes, Equipo, Finanzas, Ventas), y cada una lo reseteaba al desmontarse en cada navegación. Se dejó en un solo lugar (`Layout.jsx`, que nunca se desmonta) — confirmado con navegación real entre 5 pantallas seguidas, tamaño estable
- [x] Selector de vista para desarrollo (`SelectorVistaDev.jsx` + `useEsEscritorio.js`): botón flotante para forzar celular/escritorio sin depender del ancho real de la ventana, así se pueden revisar los dos layouts mientras se construyen sin achicar/agrandar cada vez. Solo existe en `npm run dev` — desaparece solo en el build de producción (`import.meta.env.DEV`)
- [x] Añadir deuda rápido desde la tabla de Clientes (escritorio): botón "+" junto a la columna Deuda, abre un diálogo chico (monto + vencimiento) sin tener que entrar a la ficha completa. No necesita migración (usa `creditos_clientes`, ya existía)
- [x] Clientes de escritorio (`Clientes.jsx`): tabla densa (turnos, compras, gastado, deuda) con filtros de "con deuda" y "cumplen este mes"; ficha en dos columnas (datos+créditos a la izquierda, historial a la derecha). El historial ahora también suma **conversaciones** (antes solo turnos+compras) — línea de tiempo unificada, como marcaba el doc. Falta correr `021_clientes_deuda.sql` y verificarlo en vivo (no lo pude probar yo mismo, sin login)
- [x] Equipo de escritorio (`Equipo.jsx`): tabla (nombre, rol, estado, acción) en vez de tarjetas; el formulario "Agregar" pasó de pantalla completa a diálogo superpuesto (bottom-sheet en celular, modal centrado en escritorio) — mejora también la versión de celular, no solo la de escritorio
- [x] Fix: los 18 campos numéricos de la app (dinero y cantidad — Venta, Finanzas, Productos, Caja, Gastos fijos, Créditos, Servicios, Equipo) cambiaban de valor solo con pasar la rueda del mouse encima estando enfocados (comportamiento nativo del navegador en `<input type="number">`) — se detectó al cargar un sueldo de 3.000.000 y guardarse 2.999.999. Se sacó el foco del campo al hacer scroll (`onWheel` → `blur()`) en los 18 lugares
- [x] Actividad del equipo: `ventas.usuario_id` nunca se completaba (existía desde la migración 004 pero `fn_crear_venta` no lo escribía) — corregido en `023_ventas_usuario.sql` (usa `auth.uid()` adentro de la función, mismo criterio que `registrado_por`). Con eso: (a) sección "Actividad del equipo" en la lista general — días de caja abierta, ventas y total vendido, **todos juntos** incluyendo al dueño si también vende; (b) sección "Actividad" en la ficha de cada empleado — sus propias cajas (fecha, abierta/cerrada, diferencia de arqueo) y su resumen de ventas. Ventas hechas ANTES de esta migración quedan sin responsable asignado (no se puede reconstruir), se agrupan aparte como "Sin asignar"
- [x] Ficha de empleado (sueldo + horario semanal): nueva pantalla "Sueldo y horario" por persona (botón en la lista, en las dos versiones) — sueldo mensual y franjas horarias por día (mismo formato que ya usa Horarios de atención; un día sin franjas es su día libre). Falta correr `022_empleados_horario_sueldo.sql`. **No** es el módulo completo de "Jornadas" del doc (grilla + fichaje de entrada/salida + comisiones) — eso sigue siendo aparte, más grande, sin arrancar
- [x] Finanzas de escritorio — retoque de layout: la columna derecha ahora es fija (`position: sticky`) y no se pierde de vista al bajar; se sacó el scroll interno de la tabla de Movimientos (antes tenía su propia barra de scroll adentro, se veía mal) — ahora la tabla crece normal y es la página entera la que baja. Requirió reestructurar el armado de las dos columnas (antes cada sección se ubicaba con `gridColumn` suelto, ahora se arman explícitamente en dos bloques) — en celular sigue siendo una sola columna en el mismo orden de siempre, sin cambios
- [x] Los dos CSV de Finanzas (Movimientos y Tendencia), más detallados y ordenados: fecha en DD/MM/YYYY + día de la semana, Ingreso/Egreso en columnas separadas (suma directa en Excel), fila de TOTAL al final, y en Movimientos además Comprobante (Sí/No) y **Cargado por** — resuelve `registrado_por` a un nombre por primera vez (existía desde la migración 017, nunca se mostraba en ningún lado). El de Movimientos respeta el filtro de categoría activo si hay uno
- [x] Tendencia del período — retoque 2: barras más grandes y juntas (menos separación, más ancho, gráfico más alto); ahora completa TODOS los días del período aunque no tengan movimientos (quedan en cero) — antes un día sin ventas directamente desaparecía del gráfico y la semana se veía salteada
- [x] Tendencia del período, rediseñada: una sola barra por día (el NETO — verde arriba de la línea si ganó, rojo abajo si perdió), en vez de dos barras separadas que no decían nada a simple vista. Ahora muestra el valor en Gs. directo bajo/sobre cada barra (hasta 14 días a la vista; con "Este mes" son muchas barras y queda solo en el hover), un resumen arriba ("Neto del período" + % vs. período anterior) y un botón "Descargar CSV" con el detalle día por día (fecha, ingresos, egresos, neto)
- [x] Finanzas de escritorio, 4 mejoras más: (1) **Tendencia del período** — mini gráfico de barras (ingresos/egresos por día), solo con más de un día a la vista; (2) **Por método de pago** — cuánto entró en efectivo/transferencia/tarjeta/QR, usa `venta_pagos` que ya existía; (3) **Filtrar Movimientos por categoría** — click en una fila de Categorías filtra la tabla, click de nuevo la saca; (4) **Rango de fechas propio** — dos campos de fecha junto a los botones Hoy/Semana/Mes; mientras no estén los dos cargados, se ignoran (así celular nunca cambia). Con rango propio no se muestra el % vs. período anterior (no hay uno claro que comparar). No necesita ninguna migración
- [x] Finanzas de escritorio (`Finanzas.jsx`): 2 columnas desde 1280px — izquierda (ancha): Categorías y Movimientos (tabla, con fila fija de encabezado); derecha (360px): Lo que se viene, Cargar movimiento, Gastos fijos, Lo más vendido. "Necesita atención" y las 3 MetricPill de Ingresos/Egresos/Neto quedan arriba, a todo el ancho, en las dos versiones. Implementado con `gridColumn` inline en vez de reordenar el DOM — en celular el padre no es grid, así que el orden y la pinta quedan idénticos a como estaban
- [x] Ventas de escritorio (`Ventas.jsx`): tabla (fecha, cliente, canal, método, **vendedor**, estado, total) con filtros de método de pago, canal y vendedor, y "Exportar CSV" (mismo criterio que Finanzas: ordenado, con fila de total). Usa `ventas.usuario_id`, recién completado en la migración 023 — antes de esa migración las ventas viejas van a aparecer como "Sin asignar" en el filtro/columna Vendedor
- [x] Fix: al dividir el pago, no se podía escribir el monto de cada método — el atajo global que devuelve el foco al buscador (para que el lector de código de barras nunca "se pierda") solo sabía ignorar el campo de teléfono, no los de monto dividido ni el de vuelto (nuevo). Cada tecla escrita ahí devolvía el foco a la búsqueda de golpe. Se generalizó: ahora ignora CUALQUIER input/textarea/select con el foco, no una lista fija de campos — probado escribiendo en el monto dividido y en el teléfono, los dos mantienen el foco bien
- [x] Nombre del cliente en Vender (escritorio): campo nuevo junto al teléfono — antes un cliente nuevo se creaba siempre como "Sin nombre" y había que ir a Clientes a completarlo a mano. Nunca pisa el nombre de un cliente que ya existía con un nombre real, solo completa el placeholder. Probado de punta a punta: venta real → cliente aparece en la tabla de Clientes con el nombre cargado
- [x] Vender (POS) de escritorio: 2 columnas fijas (búsqueda a la izquierda, carrito a la derecha, sin que una empuje a la otra) — grilla de "Más vendidos" para tocar sin escribir (útil en gastronomía/servicios sin código de barras, calcula desde `venta_items`) y calculadora de vuelto en efectivo. Los atajos de teclado (F2/F3/F8/Esc/flechas) ya funcionaban antes y siguen igual en las dos versiones — probado de punta a punta (agregar producto → vuelto calculado bien)
- [x] Proveedores y Compras (escritorio): dos pantallas nuevas — la tabla `proveedores`/`ordenes_compra`/`orden_compra_items` existía desde la migración 004 pero nunca tuvo pantalla (estaba anotado como "Fase 7" en `AS_ADMIN_arquitectura_unificada_v3.md`, nunca arrancada). **Proveedores**: ABM simple (nombre, contacto, teléfono, email, notas), dar de baja sin borrar. **Compras**: crear orden (proveedor + productos + cantidad + costo) con ciclo de vida Borrador → Enviada → Recibida (sube el stock solo, vía `fn_recibir_orden_compra`, migración 024) o Cancelada. Selector de proveedor agregado al formulario de producto. Probado de punta a punta: stock de un producto subió de 5 a 15 al recibir una orden de 10 unidades, con su registro en movimientos de inventario
- [x] Importar/exportar productos, de verdad: `ImportarProductos.jsx` ahora acepta `.xlsx` además de `.csv` (librería `xlsx`/SheetJS), agrupa filas por nombre para importar variantes (talle/color), cruza por SKU/código de barras/nombre para actualizar en vez de duplicar productos que ya existen, y resuelve categoría y **proveedor** por nombre (los crea si no existen). Productos ganó un botón "Exportar" (escritorio) que genera un `.xlsx` con el mismo formato de columnas, para ida y vuelta en Excel sin transformar nada
- [x] Equipo de escritorio, rediseño completo (quedó "flojo" en la primera pasada): métricas arriba (personas, activos, vendido del equipo), "Vos" (dueño) integrado como primera fila de la tabla en vez de tarjeta suelta, "Actividad del equipo" como ranking con barra en vez de lista apretada, y la ficha de un empleado ahora es un **panel lateral** (junto a la tabla) en vez de tapar toda la pantalla. Se agregaron datos de contacto a la ficha (teléfono, email, cédula, fecha de ingreso, notas — migración `025_datos_empleados.sql`). Fix: ventas/cajas sin `usuario_id` (de antes de la migración 023) se contaban como "Sin asignar" — ahora se cuentan como del dueño, por descarte
- [x] Conversaciones (escritorio): pantalla nueva — bandeja con TODAS las conversaciones (no solo las derivadas, que ya se veían como alerta en Hoy), con adelanto del último mensaje, filtro "Necesitan respuesta", y el hilo completo al lado (no en un modal) con botón para marcar como respondida. Sigue sin poder responder desde acá — el bot y el envío de WhatsApp no viven en este panel, "Abrir en WhatsApp" sigue siendo el botón real para contestar
- [x] Turnos de escritorio: era la pantalla menos desarrollada (ni una línea de código de escritorio) — ahora tiene tablero semanal (7 días, navegación anterior/hoy/siguiente), métricas arriba (turnos de la semana, confirmados, pendientes, no-shows), filtro por profesional y por estado, y el detalle de un turno se abre en un diálogo con las mismas acciones de siempre (atendido/no vino/cancelar). Se sumó lo que faltaba de verdad: **cargar un turno a mano** (antes todos nacían del bot) — busca o crea cliente al vuelo, elige servicio/profesional/fecha/hora, y avisa (sin bloquear) si ya hay otro turno cerca de ese horario
- [x] Hoy de escritorio, las dos portadas (`Hoy.jsx` agenda y `HoyRetail.jsx` retail) — eran las únicas pantallas sin una sola línea de código de escritorio, siendo la primera que ve el dueño al entrar. **Hoy**: métricas arriba (turnos, confirmados, facturado semana), selector de día ampliado a semana completa (lunes a domingo, con navegación y un punto de color por día según si tiene pendientes), tabla en vez de lista, y "Necesita atención" (conversaciones derivadas) enlazando a la pantalla Conversaciones. **HoyRetail**: mismo criterio — ventas del día completas en tabla (antes se cortaban a 10), stock bajo con cada producto listado y enlace a Productos (antes un solo mensaje sin detalle), y el mismo panel de conversaciones. La barra de Caja (`CajaBar.jsx`) se reutiliza tal cual — su propia versión de escritorio queda para la pantalla "Caja" dedicada, todavía sin empezar
- [x] Caja dedicada (escritorio): historial completo de sesiones de caja (quién, cuándo, inicial/esperado/real/diferencia), con `CajaBar` reutilizada arriba para abrir/cerrar desde la misma pantalla, y detalle de cada sesión (sus movimientos financieros) en un diálogo
- [x] Inventario (escritorio): pantalla nueva de solo lectura sobre `movimientos_inventario` (fuente de verdad del stock desde la migración 004, nunca tuvo pantalla propia) — filtro por tipo y búsqueda por producto. A propósito sin botón para cargar un movimiento a mano: un ajuste de stock sigue yendo por Productos o por una reposición, nunca por un insert directo (migración `026_realtime_inventario.sql` para que se refresque sola)
- [x] Jornadas (escritorio): primera parte de "Agenda semanal/Jornadas del equipo" — fichaje real de entrada/salida (`fichajes`, migración `027_fichajes.sql`), comparado contra el horario de referencia de cada persona (ya existía desde Equipo) en una grilla semanal. **A propósito sin comisiones todavía** — calcularlas depende de reglas de negocio (¿por venta? ¿por servicio? ¿porcentaje fijo o por escalón?) que no están definidas; inventarlas hubiera sido adivinar
- [x] Alta de negocios desde una UI (`AdminNegocios.jsx`, ruta `/asbit/negocios`): reemplaza el insert a mano en el SQL Editor de Supabase por un formulario. Es una herramienta interna de AS BIT, no un panel de negocio — vive fuera del Layout de siempre y solo la ve quien esté en la tabla nueva `staff_asbit` (migración `028_staff_asbit.sql`; **hay que insertar tu propio UUID ahí para poder entrar**, mismo paso manual que agregar un empleado). El paso previo sigue siendo manual: la cuenta de Supabase Auth del dueño del negocio cliente hay que crearla antes
- [x] Permisos por excepción (migración `029_permisos_extra.sql`): antes CUALQUIER persona activa del equipo, sin importar el rol, podía anular una venta sin ninguna restricción (ni visual ni de base de datos) — ahora `fn_anular_venta` exige ser dueño/gerente, o tener `'anular_ventas'` en el nuevo campo `usuarios.permisos_extra`, editable desde la ficha de Equipo ("Permisos especiales"). Acotado a propósito a este único caso real en vez de rediseñar todos los permisos de una — extender el mismo patrón a otras acciones (borrar un producto, editar un precio) es directo cuando haga falta, pero cada una merece su propia decisión de qué rol debería poder hacerla
- [x] Fix real: `Caja.jsx` se suscribía dos veces al mismo canal de tiempo real que `CajaBar` (embebida ahí mismo) — Supabase Realtime tiraba "cannot add postgres_changes callbacks... after subscribe()" y sin límite de error en React eso rompía TODO el panel de golpe (pantalla en blanco, sin aviso). Se sacó la suscripción duplicada; `Caja.jsx` ahora se refresca vía el `onSesionActualizada` que `CajaBar` ya manda, mismo patrón que ya usaba `Venta.jsx`
- [x] Fix: la barra lateral se quedó sin espacio con las 4 pantallas nuevas (Conversaciones/Jornadas/Caja/Inventario) y necesitaba scroll interno para llegar a Equipo/Config — se achicó el padding de cada enlace y el espacio entre grupos (no el tamaño de letra), ahora entran las 15 pantallas sin scroll en una laptop típica
- [x] Configuración, 3 agregados: **teléfono para alertas por WhatsApp** (`negocios.config.telefono_dueno`) — el backend ya lo usa para avisar stock bajo y conversaciones derivadas (`alertasStock.js`, `messageHandler.js`) pero nunca tuvo UI, solo se podía cargar a mano en el JSON de Supabase, y sin él esos avisos directamente no se mandan; **nombre del negocio editable** (antes solo la dirección); **Plan y módulos activos a la vista** (informativo). Se descartó exponer el campo `tono` del bot porque el backend nunca lo lee todavía — hubiera sido una UI que no hace nada
- [x] Pasada de pruebas en vivo (sesión real, negocio de prueba): turno nuevo de punta a punta en Turnos, permiso "anular_ventas" guardado y confirmado tras recargar en Equipo, anulación de venta re-probada (no se rompió con el chequeo de permisos nuevo), Conversaciones (marcar como respondida), Jornadas (fichar salida), y el teléfono de alertas de Configuración — todo funcionando
- [x] AdminNegocios: agregada la edición de un negocio ya creado (plan, módulos activos, activo/inactivo) — antes solo se podía crear, no había forma de subirle el plan a un cliente sin entrar a Supabase a mano. Sin probar en vivo (necesita una cuenta en `staff_asbit`, la sesión de prueba usada esta sesión no lo es)
- [x] Crear cuentas de Supabase Auth sin tocar Supabase: antes, tanto agregar un empleado (Equipo) como dar de alta un negocio (AdminNegocios) pedían pegar un UUID que había que copiar a mano del panel de Supabase — un paso que un usuario normal no sabe hacer. Ahora los dos piden solo el **email** (y opcionalmente una contraseña propia — si se deja vacío, se genera una), y un endpoint nuevo del backend (`POST /api/crear-cuenta`, en `backend/lib/adminUsuarios.js`) crea la cuenta con la service key (nunca expuesta al navegador). **Probado en vivo, funciona** (`backend/.env` cargado con la Service Role Key real)
- [x] Resetear contraseña (`POST /api/resetear-password`): para cuando alguien se olvida — como queda afuera del panel, no puede entrar a cambiársela sola. Botón "Generar nueva contraseña" en la ficha de un empleado (Equipo) y en el negocio (AdminNegocios). El backend decide quién puede resetear a quién (`puedeResetear` en `adminUsuarios.js`): la propia cuenta, el dueño sobre sus empleados, o staff de AS BIT sobre cualquiera — sin este chequeo cualquiera logueado podría secuestrar cualquier cuenta con solo el UUID
- [x] Nombre del dueño (`negocios.nombre_dueno`, migración `030_nombre_dueno.sql`): antes todas las pantallas de "quién hizo esto" (Ventas, Caja, Inventario, Finanzas, Equipo, Jornadas) mostraban "Vos" en vez del nombre real del dueño — a diferencia de un empleado, que sí tiene su nombre cargado. Campo nuevo en Configuración ("Tu nombre") — opcional, si no se carga sigue mostrando "Vos". **Probado en vivo, funciona**

## 5. Desarrollo — Finanzas

- [x] Carga manual de gastos e ingresos (categoría, monto, notas)
- [x] Vista de caja: ingresos vs egresos por día/semana/mes, con lo que "necesita atención" arriba de todo (caja sin cerrar, créditos vencidos, etc.)
- [x] Detalle de cada movimiento financiero individual (no solo el total por categoría) + comprobante adjunto (mismo bucket privado que las ventas) + quién lo cargó (`registrado_por`)
- [x] Gastos fijos mensuales (alquiler, luz, agua...): se definen una vez y Finanzas recuerda confirmarlos el día que corresponde — **nunca se cargan solos**, siempre los confirma una persona (mismo criterio que los comprobantes). Migración `018_gastos_fijos.sql`, componente `GastosFijos.jsx`
- [x] Top de servicios/productos más vendidos ("Lo más vendido", top 5 por cantidad)
- [x] Exportar a CSV (se abre bien en Excel/Sheets) y a **PDF** (escritorio: Ventas y Movimientos de Finanzas, con jsPDF cargado recién al tocar el botón)
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
- [x] Manual de uso del panel y el bot de WhatsApp — dos formatos: página web (`claude.ai/artifact/GqS72F4XFoFfnF4tZFsh9e`, con el mismo estilo del producto) y PowerPoint descargable con el logo y los colores reales de AS BIT (`backend/scripts/subir-manual.js` lo sube al bucket público `recursos-publicos` de Supabase Storage). Los dos, con link directo desde Configuración → arriba de todo
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
- [x] Definir `modulos_activos` al dar de alta un negocio desde una UI (`/asbit/negocios`: checkboxes de módulos + plan, y presets por tipo de negocio — consultorio, peluquería, tienda, gastronomía, mixto — que completan rubro y módulos con un clic)
- [x] Panel: vista "Hoy" propia para negocios retail (`HoyRetail.jsx`) — resumen del día, caja, alertas de stock/conversaciones, últimas ventas
- [ ] Reporte de productos más vendidos
- [ ] Decidir el alcance de lector de código de barras (USB primero; cámara del celular, después)
- [ ] Usuarios multiusuario con roles y permisos más finos (hoy existen los roles base de la migración 011; falta UI para permisos por excepción)
- [x] Créditos de clientes: seguimiento de deuda desde el panel (ficha del cliente en Clientes) — registrar crédito manual y marcar pagado. **Ya conectado al POS (escritorio):** `Venta.jsx` ofrece "Crédito" como método (también dividido), exige el teléfono del cliente, deja fecha de vencimiento opcional y anota la deuda en `creditos_clientes` ligada a la venta

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
