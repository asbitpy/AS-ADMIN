# AS ADMIN

Sistema de gestión con WhatsApp para pequeños negocios paraguayos —
agenda para negocios de servicio (clínicas, nutricionistas) y POS/
inventario para retail (tiendas de ropa y afines), unificados en un
solo sistema. Un producto de AS BIT.

**Empezá por acá si es la primera vez que abrís este proyecto:**
`docs/AS_ADMIN_checklist_maestro.md` — es el estado real de qué está
hecho, qué falta, y por dónde seguir. Todo lo demás en este README es
para orientarte en la estructura de carpetas.

---

## Estructura del proyecto

```
as-admin/
├── docs/           → arquitectura, checklist maestro, árbol de conversación del bot
├── database/       → TODAS las migraciones SQL, en un solo orden numérico (001 → 008)
├── backend/        → bot de WhatsApp (Node.js) — el cerebro conversacional
└── panel/          → panel del dueño (React + Vite) — agenda, ventas, catálogo
```

**Por qué la base de datos está separada de backend/panel:** `backend`
y `panel` son dos procesos distintos (uno corre en un servidor, el otro
en el navegador del dueño), pero los dos leen y escriben la **misma**
base de datos en Supabase. Tenerla en una sola carpeta con un solo
orden numérico evita que se pisen migraciones o que alguien corra un
mismo número dos veces con contenido distinto.

---

## Orden para levantar todo de cero

1. **Base de datos**: correr en Supabase, en orden, todo lo que hay en
   `database/` (001 al 008 — ver el README de `backend/` o `panel/`
   para el detalle de qué hace cada una)
2. **Datos de demo (opcional pero recomendado la primera vez)**: correr
   `database/seed_demo.sql`. Carga un negocio híbrido con turnos de hoy,
   facturación de la semana, catálogo con variantes y una conversación
   derivada, así el panel se ve con vida desde el primer login en vez de
   vacío. Se puede correr y borrar las veces que haga falta.
3. **Backend**: seguir `backend/README.md` — conecta con Meta/WhatsApp
   y con Claude para el bot
4. **Panel**: seguir `panel/README.md` — lo usa el dueño desde el
   celular; incluye agenda (si el negocio es de servicio) y POS/catálogo
   (si es retail)

Ambos proyectos son independientes entre sí — se pueden levantar en
cualquier orden — pero los dos necesitan la base de datos ya creada.

---

## Cómo pensar el sistema (resumen de `docs/AS_ADMIN_arquitectura_unificada_v3.md`)

Un negocio no es "de servicio" o "de retail" de forma fija — tiene un
array `modulos_activos` en la tabla `negocios` que determina qué ve en
el panel y qué le ofrece el bot. Un negocio puede tener `agenda`,
`pos`/`inventario`, o ambos a la vez (ej. una nutricionista que agenda
consultas y también vende suplementos). **Nunca se hardcodea "si es
clínica, hacer X"** — siempre se chequea ese array.

## Estado actual (resumen — el detalle real vive en el checklist maestro)

- ✅ Bot de WhatsApp: agenda completa, recordatorios, derivación a humano
- ✅ Panel: vista Hoy (servicio), Turnos, Vender (POS), Productos (con
  variantes de talle/color y fotos), Configuración
- ✅ Base de datos: agenda, finanzas, inventario retail, ventas atómicas
- 🔜 Próximos pasos sugeridos: apertura/cierre de caja con arqueo,
  verificación de negocio en Meta (WhatsApp), legal/compliance (Ley
  6534, términos de servicio)

## Convenciones del proyecto

- Todo el código, comentarios y nombres de tablas/columnas están en
  **español** — es el idioma en el que se piensa el negocio, y en el
  que lo va a leer cualquiera que retome esto después.
- Los montos son en **guaraníes, sin decimales** (`numeric(12,0)`).
- Nunca se actualiza `stock` directamente — siempre a través de
  `movimientos_inventario` o de la función `fn_descontar_stock()`, para
  no perder el historial.
- **Ningún dato que decide plata o disponibilidad se cree de lo que
  manda el navegador.** El precio de una venta lo lee `fn_crear_venta()`
  del catálogo, y que dos turnos no se pisen lo garantiza la restricción
  `turnos_sin_solape`, no un `if` en el código del bot.
- Cada tabla nueva necesita su política de RLS antes de que el panel
  pueda usarla — el patrón está en `database/003_panel_auth_rls.sql`.
