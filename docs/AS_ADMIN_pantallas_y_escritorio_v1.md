# AS ADMIN — Especificación de pantallas y versión de escritorio (v1)

Documento de trabajo para diseñar el frontend. Define **qué tiene cada
pantalla**: para qué existe, quién la usa, qué datos muestra, cómo se
divide, en qué estados puede estar y qué se puede hacer en ella.

No define colores ni tipografías — eso sale del proceso de diseño. Acá
está el contenido y el comportamiento, que es lo que hay que tener
resuelto **antes** de diseñar, para no maquetar pantallas lindas que no
sirven para trabajar.

---

## 1. El problema con lo que hay hoy

El panel actual es una columna de 448px de ancho (`max-w-md`) con
navegación de pestañas abajo. Es un teléfono, y punto. Eso está bien
para el dueño de una nutricionista que mira su día en el colectivo,
pero está mal para el caso de uso que más plata mueve: **una persona
parada en un mostrador, con un lector de código de barras, cobrando**.

Nadie cobra 40 ventas por día con el pulgar en un teléfono. Se cobra
con las dos manos, mirando una pantalla grande, sin soltar el lector.

Además hay tres pantallas que directamente no existen:

| Falta | Consecuencia hoy |
|---|---|
| **Ventas** (historial) | Se cobra, pero no se puede ver una venta pasada, ni anularla, ni hacer una devolución |
| **Clientes** | Los clientes se crean solos desde el bot y desde el POS, pero nadie puede verlos ni buscarlos |
| **Conversaciones** | Cuando el bot deriva a un humano, el panel solo abre WhatsApp: se pierde el historial que el sistema ya guarda en `mensajes` |

O sea: la base de datos ya guarda cosas que ninguna pantalla muestra.

---

## 2. Dos contextos de uso, un solo sistema

No es "la versión de celular y la versión de computadora". Son **dos
formas de trabajar distintas** que comparten los mismos datos:

| | Mostrador (escritorio) | Dueño (celular) |
|---|---|---|
| Quién | Cajero, vendedor, recepcionista | Dueño / gerente |
| Sesión | Todo el día abierta | 2 minutos, varias veces |
| Entrada | Teclado + lector de código de barras | Pulgar |
| Qué necesita | Velocidad, densidad, atajos | Resumen, decisiones, alertas |
| Pantalla estrella | **Vender** | **Inicio** |

La consecuencia de diseño: en escritorio la densidad de información
tiene que ser **alta** (tablas, varias columnas, todo a la vista) y en
celular **baja** (una cosa por vez, tarjetas grandes). No alcanza con
estirar el diseño del celular hasta 1440px: queda una columna flaca en
el medio de un mar de blanco, que es exactamente lo que pasa hoy.

**Puntos de quiebre:**

- `< 768px` — celular: navegación inferior, una columna, tarjetas
- `768 – 1279px` — tablet: navegación lateral colapsada a íconos, dos columnas
- `≥ 1280px` — escritorio: barra lateral completa, hasta tres columnas, tablas densas

---

## 3. Qué lo tiene que hacer mejor que el resto

Esto es lo que decide si la gente lo usa o vuelve al cuaderno. Cada
pantalla más abajo se mide contra estos seis principios.

**3.1 Cobrar sin mirar la pantalla.** El cajero escanea, escanea,
escanea, cobra. Todo el flujo de venta tiene que funcionar solo con
teclado y lector: sin mouse, sin buscar botones. Si para cobrar hay que
hacer cuatro clics, el vendedor deja de usar el sistema en la segunda
semana y factura por cuaderno.

**3.2 Aguantar internet malo.** Un local en Paraguay se queda sin
internet. Mínimo: que la pantalla avise claramente y no pierda el
carrito. Idealmente (fase posterior): seguir vendiendo y sincronizar
después. Un POS que se cuelga cuando cae el wifi es un POS que se
abandona.

**3.3 WhatsApp adentro del sistema.** Este es el diferencial real y hoy
está desaprovechado. Ningún sistema chico del mercado tiene el bot y el
panel en el mismo lugar. Hay que poder leer la conversación completa,
responder desde el panel, y ver que ese cliente compró tres veces —
todo en la misma pantalla.

**3.4 No abrumar.** Ya está resuelto como principio (`modulos_activos`):
una barbería nunca ve "Órdenes de compra". Hay que sostenerlo cuando
aparezcan 13 secciones.

**3.5 Cerrar la caja sin miedo.** Que se vea siempre quién abrió la
caja, cuánto debería haber, cuánto hay, y la diferencia. Con historial
por persona. Es lo que le da al dueño la tranquilidad de delegar.

**3.6 Que no haya que capacitar a nadie.** Cada pantalla vacía tiene
que enseñar qué hacer, no decir "sin datos". Un negocio chico no tiene
a quién preguntarle.

---

## 4. Mapa de navegación (escritorio)

Barra lateral fija a la izquierda, agrupada. Solo aparecen las secciones
de los módulos activos del negocio.

```
┌──────────────┬──────────────────────────────────────────────┐
│  AS ADMIN    │  [negocio]        [caja: abierta] [usuario]  │  ← barra superior
│  Nutrición   ├──────────────────────────────────────────────┤
│              │                                              │
│  Inicio      │                                              │
│              │                                              │
│  ATENDER     │              área de trabajo                 │
│   Agenda     │                                              │
│   Conversac. │                                              │
│   Clientes   │                                              │
│              │                                              │
│  VENDER      │                                              │
│   Vender     │                                              │
│   Ventas     │                                              │
│   Productos  │                                              │
│   Inventario │                                              │
│              │                                              │
│  ADMINISTRAR │                                              │
│   Caja       │                                              │
│   Finanzas   │                                              │
│   Equipo     │                                              │
│   Config     │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

- **ATENDER** aparece si el negocio tiene `agenda` (Conversaciones y
  Clientes aparecen siempre: son del núcleo común)
- **VENDER** aparece si tiene `pos` o `inventario`
- **Equipo** aparece solo para roles dueño/gerente

La barra superior siempre muestra **el estado de la caja**, porque es la
pregunta que más veces por día se hace quien está en el mostrador.

---

## 5. Inventario de pantallas

| # | Pantalla | Hoy | Prioridad |
|---|---|---|---|
| 1 | Acceso | Existe, mínima | Media |
| 2 | Inicio | Existe como "Hoy" | Alta |
| 3 | Agenda | Existe como "Turnos" | Alta |
| 4 | **Vender (POS)** | Existe, pensada para celular | **Máxima** |
| 5 | Ventas (historial) | **No existe** | **Máxima** |
| 6 | Productos | Existe | Alta |
| 7 | Inventario | **No existe** | Media |
| 8 | Clientes | **No existe** | Alta |
| 9 | Conversaciones | **No existe** | Alta |
| 10 | Caja | Existe como barra dentro de Vender | Alta |
| 11 | Finanzas | **No existe** | Media |
| 12 | **Equipo** | **No existe** | Alta |
| 13 | Configuración | Existe | Media |

---

## 6. Pantalla por pantalla

### 6.1 Acceso

**Para qué:** entrar al sistema. Hoy son dos campos y un botón en el
medio de la nada.

**Contenido:** identidad de AS ADMIN, correo, contraseña, "olvidé mi
contraseña", y —importante— una franja lateral que muestre qué es el
producto (es la primera pantalla que ve un cliente nuevo el día del
alta). En escritorio: dos columnas, formulario a la izquierda, franja
de marca a la derecha. En celular: solo el formulario.

**Estados:** normal · enviando · credenciales inválidas · usuario sin
negocio vinculado (mensaje claro, no un error técnico) · sin conexión.

---

### 6.2 Inicio

**Para qué:** que el dueño sepa en 5 segundos cómo viene el día. Es la
pantalla del celular por excelencia, pero también la primera del
escritorio.

**Quién:** dueño y gerente.

**Datos:** turnos de hoy, conversaciones derivadas, ventas del día,
ingresos de la semana, productos bajo mínimo, estado de caja.

**Zonas (escritorio, tres columnas):**

| Columna | Contenido |
|---|---|
| Izquierda (ancha) | Agenda del día (si tiene `agenda`) o ventas del día (si es solo retail) |
| Centro | Métricas: facturado hoy / semana, ventas, ticket promedio, ausencias |
| Derecha | Lo que necesita atención: conversaciones derivadas, stock bajo, caja sin cerrar de ayer |

**Adaptación por módulo** (ya definida en la arquitectura v3): solo
agenda → línea de tiempo; solo retail → resumen de caja y ventas;
híbrido → los dos bloques.

**Arreglos concretos sobre lo que hay hoy:**
- La línea de tiempo dibuja de 07:00 a 20:00 siempre, aunque el negocio
  abra 08:00–12:00. Tiene que ajustarse al horario real del negocio
- Que la fecha no salga "Lunes, 7 **De** Septiembre" (hoy se capitaliza
  cada palabra)
- El bloque "Marcar como atendido" repite la lista de turnos que ya
  está arriba: la acción tiene que estar sobre el turno, no en una
  segunda lista

**Estados:** día sin turnos (no "sin datos": "Hoy no tenés turnos.
¿Querés ver la semana?") · negocio recién creado sin nada cargado
(enseña los 3 pasos para empezar) · cargando · error.

---

### 6.3 Agenda

**Para qué:** ver y manejar los turnos. Hoy es una lista vertical de un
día.

**Quién:** recepcionista, profesional, dueño.

**En escritorio cambia el paradigma:** vista **semana**, con los días
en columnas y las horas como filas. Es como piensa una recepcionista
("¿tenés algo el jueves a la tarde?") y hace visible el hueco libre,
que es lo que se quiere vender.

**Vistas:** Día · **Semana (por defecto en escritorio)** · Mes (solo
densidad, para ver carga)

**Elementos:**
- Grilla de horarios con los bloques de atención del negocio marcados,
  y el resto en gris (fuera de horario)
- Turnos como bloques de alto proporcional a su duración
- Feriados y excepciones pintados sobre la columna del día
- Columna por profesional cuando el negocio tiene más de uno
- Franja "ahora"
- Panel lateral al hacer clic en un turno: cliente, servicio, estado,
  historial de ese cliente, acciones

**Acciones:** crear turno manual (mostrador/teléfono), reprogramar
arrastrando, cancelar, marcar completado/no_show, ver conversación de
WhatsApp de ese cliente.

**Mejor que la competencia:** arrastrar para reprogramar y que el
cliente reciba el aviso por WhatsApp automáticamente. Eso es una cosa
que las agendas comunes no hacen porque no tienen el canal.

**Estados:** semana vacía · día feriado · turno pisado (no debería
pasar con la restricción `turnos_sin_solape`, pero la UI tiene que
mostrar el error si el servidor lo rechaza).

---

### 6.4 Vender (POS) — la pantalla más importante

**Para qué:** cobrar rápido. Si esta pantalla es buena, el sistema se
usa; si es lenta, no.

**Quién:** cajero y vendedor, todo el día, de pie.

**Diseño de escritorio: dos columnas fijas, sin scroll de página.**

```
┌────────────────────────────────────┬─────────────────────────┐
│  [ buscar o escanear ..........]   │  CARRITO                │
│                                    │                         │
│  resultados / grilla de productos  │  2x Remera M    240.000 │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐       │  1x Proteína    210.000 │
│  │    │ │    │ │    │ │    │       │                         │
│  └────┘ └────┘ └────┘ └────┘       │  ─────────────────────  │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐       │  Subtotal      450.000  │
│  │    │ │    │ │    │ │    │       │  Descuento           0  │
│  └────┘ └────┘ └────┘ └────┘       │  TOTAL         450.000  │
│                                    │                         │
│  favoritos / más vendidos          │  [efectivo][transf][QR] │
│                                    │  [   COBRAR  (F2)    ]  │
└────────────────────────────────────┴─────────────────────────┘
```

**El campo de búsqueda siempre tiene el foco.** El lector de código de
barras es un teclado: escribe el código y manda Enter. Si el foco se
pierde (porque alguien hizo clic en otro lado), escanear no hace nada y
el cajero no entiende por qué. Regla: **cualquier tecla que no sea un
atajo devuelve el foco a la búsqueda.**

**Atajos de teclado (obligatorios, no un lujo):**

| Tecla | Acción |
|---|---|
| Enter | Agregar el resultado seleccionado / confirmar |
| ↑ ↓ | Moverse entre resultados |
| F2 | Cobrar |
| F3 | Buscar cliente |
| F4 | Descuento (si el rol lo permite) |
| F8 | Cancelar venta |
| Esc | Limpiar búsqueda / cerrar diálogo |
| + / − | Cantidad del último ítem |

**Elementos:**
- Búsqueda por nombre, SKU o código de barras (producto o variante)
- Grilla de productos frecuentes para lo que no tiene código (útil en
  gastronomía y servicios)
- Selector de variante que aparece solo si el producto tiene variantes,
  navegable con teclado
- Carrito con cantidad editable, descuento por ítem, quitar
- Cliente opcional (por teléfono; si no existe lo crea)
- Método de pago, incluido **pago mixto** (parte efectivo, parte
  transferencia) — pasa todo el tiempo y casi ningún sistema chico lo
  soporta
- Vuelto: si el pago es en efectivo, cuánto entregó y cuánto es el
  vuelto (una calculadora mental que el cajero hace mal cuando hay cola)
- Estado de caja visible; si está cerrada, avisa pero **no bloquea**

**Después de cobrar:** confirmación con el total real que registró el
servidor, opción de imprimir/compartir comprobante, y foco de vuelta en
la búsqueda para la próxima venta. Sin clics extra.

**Estados:** carrito vacío (enseña: "escaneá un producto o buscalo por
nombre") · producto sin stock · stock insuficiente al cobrar · sin
conexión (el carrito no se pierde) · caja cerrada · sin permiso para
descuento.

---

### 6.5 Ventas (historial) — NUEVA

**Para qué:** ver qué se vendió. Hoy es imposible, y es lo primero que
pide cualquier dueño.

**Quién:** dueño, gerente; el cajero solo ve las suyas del día.

**Contenido:** tabla densa — fecha y hora, número, cliente, ítems,
método de pago, vendedor, total, estado. Filtros por rango de fechas,
método de pago, vendedor, canal (local / WhatsApp / ecommerce).

**Detalle de una venta:** ítems con precio unitario y descuento, quién
la hizo, en qué sesión de caja, y las acciones **anular** y
**devolución** (parcial o total, que devuelve stock con su movimiento
de inventario y su registro financiero).

**Mejor que la competencia:** poder buscar una venta por el teléfono
del cliente y ver toda su conversación de WhatsApp al lado.

**Estados:** sin ventas todavía · rango sin resultados · venta anulada
(se muestra tachada, nunca se borra).

---

### 6.6 Productos

**Para qué:** el catálogo.

**En escritorio: tabla, no tarjetas.** Con 200 productos, las tarjetas
grandes de hoy son inusables. Columnas: foto (miniatura), nombre, SKU,
categoría, precio, costo, margen, stock, estado. Ordenable por
cualquier columna.

**Elementos:** buscador, filtros (categoría, stock bajo, sin stock,
inactivos), selección múltiple para acciones en lote (cambiar precio
por porcentaje, cambiar categoría, activar/desactivar), botón de
importar desde Excel/CSV (clave para un negocio que ya tiene su lista
en una planilla — sin esto, cargar 300 productos a mano es la razón #1
por la que un sistema se abandona en la primera semana).

**Ficha de producto:** datos generales, precios (venta, costo,
mayorista, margen calculado), variantes en tabla editable, fotos,
stock y su historial de movimientos.

**Estados:** catálogo vacío (ofrece importar o cargar el primero) ·
producto sin variantes vs. con variantes · stock bajo destacado.

---

### 6.7 Inventario — NUEVA

**Para qué:** entender por qué el stock dice lo que dice. Hoy
`movimientos_inventario` se escribe pero nadie lo lee.

**Contenido:** historial de movimientos (entrada, salida, ajuste,
venta, devolución) con producto, cantidad, motivo, usuario y fecha.
Filtros por producto y por tipo.

**Acciones:** ajuste manual con motivo obligatorio, recepción de
mercadería, y **conteo físico** (listar, cargar lo contado, ver la
diferencia y aplicarla como ajuste) — que es el equivalente del arqueo
de caja pero para el stock.

---

### 6.8 Clientes — NUEVA

**Para qué:** que el negocio sepa quién es su gente. Los clientes ya se
crean solos (bot y POS) pero nadie los ve.

**Contenido:** tabla con nombre, teléfono, última visita, total
gastado, cantidad de turnos/compras, deuda. Filtros: inactivos hace más
de X, con deuda, cumpleaños del mes.

**Ficha del cliente:** datos, historial unificado de **turnos + compras
+ conversaciones en una sola línea de tiempo**, notas, deuda.

**Mejor que la competencia:** esa línea de tiempo unificada. En los
sistemas chicos, la agenda, las ventas y el WhatsApp viven en tres
lugares distintos.

---

### 6.9 Conversaciones — NUEVA

**Para qué:** que el WhatsApp sea parte del sistema y no una app
aparte. Hoy el panel solo abre `wa.me` y se pierde todo.

**Diseño:** bandeja de tres columnas, como un cliente de correo —
lista de conversaciones · hilo de mensajes · ficha del cliente al
costado (sus turnos, sus compras, su deuda).

**Elementos:** filtros (derivadas, prioridad alta, sin responder, todas),
el hilo completo con quién dijo qué (bot / cliente / persona del
negocio), y **responder desde el panel**, lo que devuelve la
conversación al bot cuando se resuelve.

**Detalle importante:** hay que mostrar si la ventana de 24 horas de
Meta sigue abierta, porque de eso depende si se puede responder libre o
hay que usar una plantilla. Si no se muestra, el usuario escribe, falla
y no entiende por qué.

**Estados:** sin conversaciones · conversación tomada por otra persona
del equipo (para que dos no respondan lo mismo) · ventana de 24hs
vencida.

---

### 6.10 Caja

**Para qué:** abrir, controlar y cerrar el día. Hoy vive como una barra
dentro de Vender; en escritorio necesita su propia pantalla, sin dejar
de estar visible en la superior.

**Contenido:** sesión actual (quién abrió, a qué hora, monto inicial,
ventas por método de pago, gastos y retiros, esperado en efectivo),
cierre con arqueo (lo contado vs. lo esperado, y la diferencia), e
historial de sesiones con sus diferencias por persona.

**Estados:** sin caja abierta · caja abierta por otra persona · caja de
ayer sin cerrar (alerta, es el error más común) · diferencia negativa
(se muestra, no se esconde).

---

### 6.11 Finanzas

**Para qué:** saber si el negocio gana plata. Hoy `movimientos_financieros`
se llena solo y nadie lo mira.

**Contenido:** ingresos vs. egresos por día/semana/mes, desglose por
categoría, servicios y productos más vendidos, ticket promedio,
comparación con el período anterior. Carga manual de gastos.
Exportar a Excel/PDF para el contador.

**Estados:** menos de una semana de datos (no dibujar tendencias con 2
puntos) · sin egresos cargados (avisar que la ganancia mostrada es
incompleta).

---

### 6.12 Equipo — NUEVA (lo que pediste)

Esta es la sección que falta para que un negocio con más de una persona
pueda usar el sistema en serio. Hoy es un negocio = un login, y todos
comparten la misma contraseña, que es la forma más rápida de que nadie
se haga responsable de nada.

**Aviso de nombres:** en este sistema "turno" ya significa *cita de un
cliente*. Los turnos de trabajo de los empleados tienen que llamarse
distinto para no romper todo el vocabulario del código y de la base.
Propuesta: **jornadas** (una jornada = el bloque que a alguien le toca
trabajar). Hay que decidirlo antes de escribir la migración.

**Buena noticia:** las tablas `ventas`, `caja_sesiones` y
`movimientos_inventario` ya tienen una columna `usuario_id` sin usar,
esperando exactamente esto.

#### 6.12.1 Empleados

Tabla con nombre, rol, estado, último ingreso. Ficha con datos de
contacto, rol, permisos, jornadas y actividad (ventas hechas, cajas
abiertas, diferencias de arqueo).

**Roles base:**

| Rol | Puede |
|---|---|
| Dueño | Todo, incluido crear usuarios y ver finanzas |
| Gerente | Todo lo operativo; finanzas sí, crear usuarios no |
| Cajero | Vender, abrir/cerrar su caja, ver sus ventas del día |
| Vendedor | Vender, ver stock; no maneja caja |
| Profesional | Su agenda y sus clientes; no ve ventas ni finanzas |

**Permisos finos sobre el rol** (como ya anticipa la arquitectura v3:
rol base + excepciones por persona):
- Descuento máximo permitido (0%, 10%, sin límite)
- Anular ventas
- Editar precios y productos
- Ver el costo y el margen (muchos dueños no quieren que el vendedor lo vea)
- Ver finanzas
- Abrir y cerrar caja

#### 6.12.2 Jornadas (turnos de trabajo)

Grilla semanal: personas en filas, días en columnas. Se asigna quién
trabaja de mañana, de tarde, o el día completo. Sirve para tres cosas
concretas:

1. Saber quién tendría que estar cuando aparece una diferencia de caja
2. Repartir la agenda entre profesionales según quién trabaja ese día
3. Que el dueño deje de armar el cuadro de horarios en el cuaderno

**Vistas:** semana (por defecto) · por persona · quién está ahora.

#### 6.12.3 Fichaje (entrada y salida)

Simple: la persona marca entrada al llegar y salida al irse, desde el
mismo sistema donde ya trabaja. Reporte de horas trabajadas por semana,
y comparación entre la jornada asignada y la real.

Es opcional por negocio (se activa como módulo). Un local de dos
personas no lo quiere; uno de ocho, sí.

#### 6.12.4 Comisiones

Porcentaje por vendedor sobre lo que vendió, o por producto. Reporte de
comisión por período. Es una función que **hace que el vendedor quiera
usar el sistema** en vez de resistirlo, porque su plata depende de que
la venta quede registrada a su nombre. Es el mejor truco de adopción
que existe en retail.

---

### 6.13 Configuración

Secciones: negocio (datos, dirección, mapa) · horarios de atención
(hoy se editan en Supabase a mano) · feriados y excepciones · servicios
y precios · categorías · módulos activos · WhatsApp (número, estado de
conexión, plantillas) · facturación (cuando exista SIFEN).

---

## 7. Qué implica en la base de datos

| Necesita | Cambio |
|---|---|
| Empleados | Tabla `usuarios` (negocio_id, auth_user_id, nombre, rol, permisos jsonb, activo) |
| Permisos | Políticas RLS por rol, además del `negocio_id` actual |
| Jornadas | Tabla `jornadas` (usuario_id, fecha, hora_inicio, hora_fin, tipo) |
| Fichaje | Tabla `fichajes` (usuario_id, entrada, salida) |
| Comisiones | Porcentaje en `usuarios` y/o en `productos`; se calcula sobre `ventas.usuario_id` |
| Quién hizo qué | Ya existe: `ventas.usuario_id`, `caja_sesiones.usuario_id`, `movimientos_inventario.usuario_id` — hay que empezar a completarlos |
| Devoluciones | Tabla `devoluciones` o estado en `ventas` + movimiento de inventario tipo `devolucion` (el enum ya lo tiene) |
| Pago mixto | Tabla `venta_pagos` (venta_id, metodo, monto) en vez de un solo `metodo_pago` |

**Decisión pendiente:** hoy existe una tabla `profesionales` separada.
Una nutricionista que atiende turnos **y** entra al sistema es las dos
cosas. Hay que decidir si `profesionales` se fusiona con `usuarios`
(un usuario con rol profesional) o si quedan separadas. Recomiendo
fusionar: si no, todo negocio de servicio va a tener que cargar a su
gente dos veces.

---

## 8. Orden sugerido de construcción

1. **Vender (POS) de escritorio** con teclado y lector — es lo que
   decide si el sistema se usa
2. **Ventas (historial)** — hoy se cobra a ciegas
3. **Equipo**: usuarios, roles y permisos — sin esto no se puede
   delegar el mostrador
4. **Caja** como pantalla propia
5. **Conversaciones** — el diferencial que hoy está desperdiciado
6. **Clientes**
7. Agenda semanal de escritorio
8. Inventario y Finanzas
9. Jornadas, fichaje y comisiones

---

## 9. Cómo seguir con el diseño

Cada pantalla de la sección 6 tiene lo necesario para diseñarse: para
qué existe, quién la usa, qué muestra, cómo se divide y en qué estados
puede estar. El orden de trabajo sugerido:

1. Definir la identidad visual y el sistema (color, tipografía,
   espaciado, componentes base) sobre **una** pantalla piloto
2. La pantalla piloto tiene que ser **Vender en escritorio**: es la más
   exigente y la que más restricciones impone
3. Recién con el sistema validado ahí, aplicar al resto
4. Diseñar siempre los estados vacíos junto con los llenos: son la
   mitad de la experiencia real de un negocio que recién arranca

**Regla que no se negocia:** ninguna pantalla se diseña sin sus estados
vacío / cargando / error. Un diseño que solo existe lleno de datos
falsos bonitos es un diseño que se rompe el primer día en un negocio
real, que empieza sin ningún dato.
