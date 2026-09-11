# AS ADMIN — Bot de WhatsApp v3: segunda personalidad (Retail + Inventario)

Documento de definición — sin código todavía. Extiende `AS_ADMIN_arbol_conversacion_bot_v2.md` (personalidad de Agenda, ya construida) sumando la personalidad de **Retail**, que hoy no existe. Corresponde al ítem 9 del roadmap en `AS_ADMIN_arquitectura_unificada_v3.md`.

**Decisiones ya tomadas:**
- Se diseñan las dos personalidades ahora; se construyen en etapas.
- Un pedido por WhatsApp se **retira y paga en el local** — el bot nunca cobra ni queda plata pendiente de conciliar. Esto evita depender de la verificación de transferencias (cabo suelto ya identificado, sin solución simple en Paraguay hoy).

---

## 1. Estado de la personalidad Agenda (ya construida)

No cambia nada de `AS_ADMIN_arbol_conversacion_bot_v2.md`. Quedan dos pendientes de la Fase 1, sin relación con este documento, que se pueden resolver en paralelo:
- Notificación al dueño cuando una conversación se deriva a humano
- Ofrecer la franja liberada al primero de la lista de espera al cancelarse un turno

## 2. Cómo decide el bot qué personalidad usar

No es un bot nuevo — es el mismo motor (`messageHandler.js` + `claude.js`) con ramas nuevas. Al llegar un mensaje, ya se resuelve `negocio` (con sus módulos activos) antes de clasificar. Si el negocio tiene **Retail** activo, el clasificador recibe las intenciones de retail además de (o en vez de) las de agenda, según lo que tenga activado. Un negocio híbrido puede ofrecer ambas ramas desde el mismo menú de bienvenida.

## 3. Intenciones nuevas (retail)

| Intención | Qué extrae Claude | Quién ejecuta |
|---|---|---|
| `consultar_stock` | producto, variante (talle/color) si lo menciona | Lee `variantes_producto` — solo lectura |
| `ver_catalogo` | rubro o categoría si lo menciona | Llama `fn_catalogo_publico()` (ya existe, migración 009, sin usar aún) |
| `hacer_pedido` | producto, variante, cantidad | Arma carrito por chat → confirma → crea reserva (ver sección 4) |
| `cancelar_pedido` | — (resuelve sobre el pedido pendiente de ese cliente) | Libera la reserva, repone stock |

Regla de oro (igual que en la personalidad de Agenda): Claude clasifica y extrae datos, **nunca** redacta el precio, la disponibilidad ni la confirmación — esas siguen siendo plantillas fijas alimentadas por datos reales de la base.

## 4. Árbol de conversación: `hacer_pedido`

```
Cliente: "tenés el buzo negro en L?"
Bot (consultar_stock): "Sí, tenemos 3 en stock 👕 ¿Querés que te lo aparte?"
   [Botón: Sí, apartámelo]  [Botón: No, gracias]

→ Sí, apartámelo
Bot: "¿Cuántas unidades?"
Cliente: "1"
Bot: "Perfecto — Buzo negro L x1, Gs. XX.XXX. Lo retirás y pagás en el local.
      ¿Confirmás?"
   [Botón: ✅ Confirmar]  [Botón: Cancelar]

→ Confirmar
Bot: "Listo ✅ Te lo dejamos apartado hasta las 18:00 de hoy.
      Cualquier cosa, avisanos."
```

Puntos de diseño:
- El stock se aparta **recién al confirmar**, no al iniciar la charla — mismo mecanismo atómico que ya usa el POS (`fn_crear_venta`), nunca "leer y restar" en dos pasos.
- La reserva tiene **vencimiento** (configurable por negocio, ej. fin del día o 2hs): si el cliente no retira, se libera sola y el stock vuelve a estar disponible. Sin esto, alguien podría "trabar" el último talle sin comprarlo nunca.
- El dueño/cajero ve el pedido entrar en tiempo real (ya tenemos `useRealtimeTick` corriendo sobre `ventas` en el panel — se reutiliza tal cual).
- Cuando el cliente llega al local, el cajero lo cierra desde el panel (pantalla Vender o una pestaña "Pedidos pendientes de retiro"): confirma el método de pago real y la venta pasa a completada. Si no llega y venció el plazo, un job libera la reserva automáticamente.

## 5. Lo que falta en la base de datos (no está hecho)

Hoy `venta_estado` solo tiene `'completada'` y `'anulada'` (migración 004). Para soportar la reserva hace falta una migración nueva (a definir cuando se construya esta etapa):
- Nuevo valor de estado, ej. `'reservada'`
- Campo de vencimiento de la reserva (`reservado_hasta`)
- Job o chequeo que libere stock de reservas vencidas (mismo patrón que `fn_anular_venta`, que ya reversa stock + movimiento financiero)

No se toca la base todavía — queda anotado para cuando se implemente la Etapa 2 (sección 8).

## 6. Módulo Inventario — automatizaciones

Dos cosas separadas a propósito, por nivel de riesgo:

**(a) Alerta de stock bajo al dueño — automática, solo lectura.**
Cuando `stock <= stock_minimo` en algún producto, el sistema le manda un WhatsApp al dueño avisando. No escribe nada, no decide nada — es una notificación.

**(b) Reposición manual iniciada por el dueño desde WhatsApp — con confirmación siempre.**
El dueño (no el cliente) escribe algo como "cargá 20 unidades más de buzo negro L". El bot confirma cantidad y producto antes de ejecutar, y la reposición queda registrada como un movimiento de inventario con motivo, igual que cualquier ajuste manual desde el panel.

**Explícitamente fuera de esta ronda:**
- Que el bot decida solo cuánto o cuándo reponer
- Que el bot se comunique con un proveedor
- Cualquier automatización de compra sin un humano confirmando

## 7. Límites duros (aplican a toda la personalidad retail)

- El bot nunca cobra ni recibe comprobantes de pago por WhatsApp.
- El bot nunca ejecuta una escritura en inventario o ventas sin pasar por una función Postgres ya validada (mismo patrón que `fn_crear_venta` / `fn_anular_venta`) — nunca SQL libre generado por el modelo.
- Toda escritura que mueve stock queda registrada con motivo — igual que ya se exige para el módulo Retail en `AS_ADMIN_arquitectura_unificada_v3.md`.
- El clasificador sigue sin redactar precios, confirmaciones ni disponibilidad — eso son plantillas fijas con datos reales.

## 8. Orden de construcción sugerido (por etapas)

| Etapa | Qué incluye | Riesgo | Estado |
|---|---|---|---|
| 1 | `consultar_stock` + `ver_catalogo` | Ninguno — solo lectura | ✅ Construido |
| 2 | `hacer_pedido` + `cancelar_pedido` con reserva | Medio — primera escritura real desde el bot | ✅ Construido (falta correr la migración y cerrar el loop en el panel) |
| 3 | Alerta automática de stock bajo al dueño | Bajo — solo notificación | Pendiente |
| 4 | Reposición manual por WhatsApp (con confirmación) | Medio — escritura, pero siempre confirmada por el dueño | Pendiente |

**Etapa 2, estado real al cerrar esta ronda: ✅ construida, corrida y verificada de punta a punta contra la base real.**
- Migración `013_reservas_whatsapp.sql`: agrega el estado `reservada`, `ventas.reservado_hasta`, y las funciones `fn_crear_reserva` / `fn_completar_reserva` / `fn_cancelar_reserva` / `fn_liberar_reservas_vencidas`. **Corrida en Supabase.**
- `backend/lib/flujoPedido.js`: máquina de estados del pedido (elegir producto → variante si aplica → cantidad → confirmar → reservado), con el mismo patrón que `flujoAgendar.js`.
- Después de consultar stock con resultado positivo, el bot ofrece directo "¿Querés que te lo aparte?" — no hace falta reescribir el producto.
- `backend/lib/reservas.js` + `server.js`: job cada 5 minutos (mismo patrón que los recordatorios) que libera reservas vencidas.
- Panel (`Ventas.jsx`): pedidos reservados aparecen con ícono de reloj y badge "pendiente de retiro", separados de las ventas cobradas. El cajero puede cobrarlo (elige método de pago) o cancelarlo desde ahí.
- **Verificado en vivo:** se creó una reserva de prueba por SQL (`fn_crear_reserva`), apareció en el panel en tiempo real, se cobró en efectivo desde la nueva UI (`fn_completar_reserva`), y se confirmó que el ingreso en `movimientos_financieros` se generó recién en ese momento — no al reservar. Datos de prueba limpiados después.

Los dos pendientes de la personalidad Agenda (sección 1) son independientes y se pueden resolver en cualquier momento sin bloquear esto.
