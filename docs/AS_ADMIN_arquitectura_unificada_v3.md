# AS ADMIN — Arquitectura unificada (v3): Servicio + Retail

Este documento define cómo se integran los 15 módulos del POS/retail que trajiste con lo que ya está construido (agenda + WhatsApp para negocios de servicio). No reemplaza nada de lo anterior — lo extiende.

---

## 1. El principio de unificación

AS ADMIN deja de ser "el sistema de turnos" y pasa a ser **un núcleo común con módulos que se activan según lo que el negocio necesita**. Esto no es una idea nueva — es el mismo principio que ya usamos para Finanzas e Inventario opcional, llevado a su forma completa.

Un negocio puede ser:
- **Solo servicio** (clínica, nutricionista, barbería) → módulos de Agenda activos, Retail apagado
- **Solo retail** (tienda de ropa, zapatillas) → módulos de Ventas activos, Agenda apagado
- **Híbrido** (nutricionista que vende suplementos, barbería que vende productos de cuidado) → ambos activos a la vez

Esto se resuelve con un campo en `negocios`: qué módulos tiene activos cada uno. **El dueño de una barbería nunca ve un botón de "Proveedores" si no lo activó** — evita el problema clásico de los ERP grandes (SAP, NetSuite) que vimos en la investigación: abrumar con funciones que no se usan.

---

## 2. Mapa de los 15 módulos, clasificados

```
                         ┌─────────────────────────┐
                         │       NÚCLEO COMÚN       │
                         │  (todo negocio lo tiene) │
                         └────────────┬────────────┘
                                      │
        ┌───────────────┬────────────┼────────────┬───────────────┐
        │               │            │             │               │
    Clientes         Caja /      Dashboard      Usuarios       WhatsApp
    (CRM)           Finanzas                   y permisos      (bot)
        │               │            │             │               │
        └───────┬───────┴─────┬──────┴──────┬──────┴───────┬───────┘
                │             │             │              │
         ┌──────┴──────┐      │      ┌──────┴──────┐       │
         │  FAMILIA     │      │      │  FAMILIA     │       │
         │  SERVICIO    │      │      │  RETAIL      │       │
         ├──────────────┤      │      ├──────────────┤       │
         │ Agenda/turnos│      │      │ POS          │       │
         │              │      │      │ Inventario   │       │
         │              │      │      │ Proveedores  │       │
         │              │      │      │ Compras      │       │
         └──────────────┘      │      └──────────────┘       │
                                │                              │
                       ┌────────┴────────┬─────────┬──────────┴──┐
                       │                 │         │             │
                  Facturación      Automatizaciones  IA      Ecommerce
                   (SIFEN)                                  + App móvil
```

**Núcleo común (5 módulos)** — todo negocio los tiene, se comportan distinto según qué familia esté activa:
1. **Clientes (CRM)** — ya existe. Se extiende con crédito/deuda y fecha de cumpleaños, útil para ambas familias
2. **Caja / Finanzas** — ya existe como `movimientos_financieros`. Se extiende con **sesiones de caja** (apertura/cierre/arqueo), necesarias para retail pero opcionales para servicio
3. **Dashboard** — la vista "Hoy" que ya armamos. Se adapta según los módulos activos (ver sección 4)
4. **Usuarios y permisos** — hoy es un dueño = un login. Se generaliza a múltiples usuarios con roles, necesario sobre todo para retail (cajeros, vendedores)
5. **WhatsApp** — ya existe el motor. Se le suma una segunda "personalidad" de bot (consulta de stock/catálogo) además de la de agenda

**Familia Servicio (1 módulo)** — ya construido:
6. **Agenda/turnos** — todo lo que ya tenemos

**Familia Retail (4 módulos)** — nuevos:
7. **POS** — venta rápida, código de barras, medios de pago, devoluciones
8. **Inventario** — productos con variantes (talle/color), stock, movimientos, alertas
9. **Proveedores** — a quién le comprás
10. **Compras** — órdenes de compra, reposición

**Capa avanzada (5 módulos)** — se construyen después, aplican a ambas familias:
11. **Facturación (SIFEN)** — más urgente para retail que para servicio (IVA por unidad vendida)
12. **Automatizaciones** — alertas de stock bajo, clientes inactivos, deudas vencidas
13. **IA / Análisis** — "¿qué debería reponer esta semana?", "¿por qué bajó mi margen?"
14. **Ecommerce** — mismo inventario alimentando tienda física + web
15. **App móvil** — ya cubierto en buena parte por el panel mobile-first que armamos

---

## 3. Qué se ve primero (información de navegación)

### Alta de un negocio nuevo (onboarding)
Primera pantalla, antes que nada: **"¿Qué tipo de negocio tenés?"**
- Servicio (turnos)
- Venta de productos
- Ambos

Esto activa los módulos correspondientes en `negocios` y determina qué ve ese dueño de ahí en adelante. Nunca le mostramos retail a quien no lo pidió, ni agenda a quien no la necesita.

### La vista "Hoy" se vuelve adaptable
Ya no es una sola pantalla fija — cambia según los módulos activos del negocio:

| Negocio tiene activo | Qué ve primero en "Hoy" |
|---|---|
| Solo Agenda | La línea de tiempo del día (lo que ya construimos) |
| Solo Retail | Resumen de caja del día: ventas, ganancia estimada, productos con poco stock |
| Ambos | Ambos bloques, uno debajo del otro — agenda arriba (es lo urgente/temporal), caja abajo |

La barra de navegación inferior también se adapta: un negocio solo-servicio ve `Hoy / Turnos / Config`; uno solo-retail ve `Hoy / Ventas / Inventario / Config`; uno híbrido ve las cinco.

---

## 4. Problemas de implementación a resolver (y cómo)

Esto es lo que separa un plan que se ve bien en el papel de uno que funciona en producción.

**Sincronización de stock entre POS, WhatsApp y ecommerce (el más peligroso).**
Si dos canales venden la última unidad al mismo tiempo, sin cuidado el sistema vende dos veces algo que solo existe una vez. Solución: nunca "leer el stock y después descontarlo" en dos pasos separados — descontar stock es siempre una operación atómica en la base de datos (una sola transacción que verifica y resta a la vez). Además, cada cambio de stock queda registrado en `movimientos_inventario` — nunca se edita el número de stock directamente, siempre a través de un movimiento con motivo. Así, si algo no cierra, se puede reconstruir la historia completa.

**Variantes de producto sin explotar el catálogo.**
"Remera Nike" no son 4 productos distintos (negra M, negra L, blanca M...) — es un producto padre con variantes hijas. Modelarlo mal acá contamina todo lo demás (precios, reportes, código de barras). Se resuelve con `productos` (el padre) + `variantes_producto` (cada combinación, con su propio stock y código de barras).

**El POS tiene que ser rápido incluso con mala conexión.**
Un empleado no puede esperar 5 segundos por cada venta, y el internet en un local no siempre es estable. Esto es un desafío de ingeniería real, no cosmético: en la primera versión el POS puede depender de conexión estable; una versión más madura necesitaría poder seguir vendiendo sin internet y sincronizar después. Lo marco como una decisión consciente a tomar más adelante, no algo a resolver ahora.

**Arqueo de caja.**
Hay que separar claramente "lo que el sistema calcula que debería haber" (caja inicial + ventas + ingresos - egresos - retiros) de "lo que el cajero contó a mano" — la diferencia entre ambos es justamente lo que permite detectar errores o faltantes. Esto necesita su propia tabla de sesiones de caja, no alcanza con sumar movimientos sueltos.

**Permisos granulares ("puede hacer descuentos hasta 10%, no puede eliminar ventas").**
Si hardcodeamos roles fijos (admin/vendedor/cajero) vamos a terminar peleando contra el código cada vez que un negocio necesite una regla distinta. Mejor: roles con permisos base + un campo flexible por usuario para excepciones puntuales.

**Código de barras: hay que aclarar qué tan lejos llega la v1.**
Un lector de código de barras USB que se conecta a la compu funciona como si fuera un teclado — fácil de soportar. Leer código de barras con la cámara del celular es una historia técnica distinta y bastante más compleja. Conviene arrancar con el lector USB/teclado y dejar la cámara para más adelante.

**El bot de WhatsApp ahora tiene dos "personalidades".**
El clasificador de intenciones que ya armamos se extiende con intenciones nuevas ("consultar_stock", "hacer_pedido") y decide qué árbol de conversación usar según los módulos activos del negocio que le escriben. Técnicamente no es reescribir el bot — es sumarle ramas nuevas al mismo motor.

**No abrumar al dueño con módulos que no usa.**
Ya lo resolvimos a nivel de principio (sección 1) — acá solo dejo la advertencia de no aflojar esa disciplina cuando se sienta la tentación de "total, ya que está, lo muestro igual".

**Facturación se vuelve más urgente para retail que para servicio.**
En servicios podíamos posponer SIFEN sin mucho drama (turno = registro interno). En retail, cada venta con IVA tiene más presión legal/fiscal encima. Esto sugiere que, cuando se construya Facturación, convenga priorizarla primero para los negocios retail.

---

## 5. Roadmap actualizado (los 15 módulos, en orden de construcción sugerido)

| Fase | Módulos | Estado |
|---|---|---|
| 1 | Agenda + WhatsApp (servicio) | ✅ Construido |
| 1 | Panel del dueño (vista Hoy, turnos, config) | ✅ Construido (versión servicio) |
| 2 | Finanzas simples | ✅ Base construida (trigger de ingresos) |
| 3 | Inventario opcional (versión liviana) | ✅ Base construida |
| **4** | **Retail core: Productos con variantes, POS, Caja con arqueo** | 🔜 Siguiente paso natural |
| 5 | Clientes extendido (crédito/deuda, cumpleaños) | Pendiente |
| 6 | Usuarios y permisos multiusuario | Pendiente |
| 7 | Proveedores y Compras | Pendiente |
| 8 | Panel adaptado (vista Hoy según módulos activos, nav dinámica) | Pendiente |
| 9 | WhatsApp — segunda personalidad (consulta de stock/catálogo) | Pendiente |
| 10 | Facturación (SIFEN) — priorizar retail primero | Pendiente |
| 11 | Automatizaciones (stock bajo, clientes inactivos, deudas) | Pendiente |
| 12 | Ecommerce integrado | Pendiente |
| 13 | IA / Análisis de negocio | Pendiente |
| 14 | Multi-sucursal / multi-depósito | Pendiente (explícitamente "para después" en el documento original) |
| 15 | App móvil dedicada | El panel mobile-first ya cubre buena parte de esto |

La Fase 4 es la que da el salto más grande de valor: sin POS + Inventario + Caja, ningún negocio de retail puede usar el sistema en absoluto. El resto de los módulos son mejoras sobre una base que ya funciona.
