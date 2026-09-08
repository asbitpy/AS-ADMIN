# AS ADMIN — Panel del dueño

App React (Vite + Tailwind) mobile-first para que el dueño del negocio
gestione su día desde el celular. Se conecta directo a Supabase con la
`anon key` — el acceso a los datos está protegido por las políticas de
RLS de `migrations/003_panel_auth_rls.sql`, no por lógica del frontend.

## Identidad visual (por qué se ve así)
Paleta alejada a propósito de los defaults típicos de IA (nada de
crema+terracota ni negro+neón): verde salvia pálido de fondo, verde
bosque como acento de acción/confirmado, ámbar cálido para "necesita
atención" y un rojo ladrillo apagado para lo urgente. Tipografía Fraunces
para los títulos (calidez, carácter), Plus Jakarta Sans para el texto de
uso diario, e IBM Plex Mono para horarios y montos — así los datos
"se sienten" precisos, distintos del texto conversacional.

**El elemento distintivo** es la línea de tiempo del día en la vista Hoy:
una espina vertical con los turnos ubicados según su hora real, feriados
respetados, y una marca "estás acá" que se mueve sola — responde
directamente al problema real: el dueño quiere saber, de un vistazo,
qué tiene ahora y qué sigue.

## Qué incluye
- **Login** contra Supabase Auth
- **Vista Hoy**: métricas del día (turnos, confirmados, conversaciones
  que necesitan atención), línea de tiempo del día, ingreso de la
  semana, y marcar turnos como atendidos con un toque
- **Vista Turnos**: listado con filtros (próximos / esta semana / todos)
  y acciones para marcar atendido / no vino / cancelar
- **Vista Productos** (retail): catálogo con foto, alerta de stock bajo,
  alta de producto con o sin variantes (talle/color), edición y ajuste
  de stock por variante
- **Vista Configuración**: editar dirección, ABM de servicios y precios,
  ABM de feriados/excepciones, cerrar sesión
- **Navegación adaptable**: las pestañas Hoy/Turnos solo aparecen si el
  negocio tiene el módulo `agenda` activo; Productos solo si tiene
  `inventario` o `pos` — un negocio puede tener ambos, uno solo, o
  ninguno de los dos activos todavía

## Qué falta (siguiente iteración)
- Editar los horarios de atención (`negocios.config.horarios`) desde una
  UI — hoy se edita directo en Supabase o pidiéndomelo a mí
- Historial de conversación completo al tocar una alerta derivada (hoy
  abre WhatsApp directo al número del cliente)
- POS real (armar una venta con carrito y cobrar) — Productos hoy solo
  cubre alta/edición de catálogo, no la venta en sí
- Apertura/cierre de caja con arqueo
- Selector de profesional, para clínicas con más de uno

## Puesta en marcha

### 1. Base de datos
Correr en Supabase, en orden numérico, todo lo que hay en `../database/`
(`001` → `008`) si todavía no lo hiciste. Las que más le importan al
panel son la `003` y la `005` (RLS: cada dueño ve solo su negocio), la
`006`/`007` (`fn_crear_venta`, que es como el POS cobra) y la `007`, que
además hace que el precio de cada venta lo ponga el servidor y no el
navegador.

> Las copias que hay en `panel/migrations/` son de una versión anterior,
> de cuando el panel tenía sus propias migraciones. La fuente de verdad
> es `../database/`.

### 1.b Bucket de fotos de producto
En Supabase → Storage → New bucket → nombre exacto `productos-fotos`,
marcado como **público**. Las políticas de acceso ya quedan resueltas
por `005_retail_rls_y_fotos.sql` (cualquiera puede ver las fotos, solo
el dueño del negocio puede subir/borrar las suyas).

### 1.c Activar el módulo retail para un negocio piloto (tienda de ropa)
Por ahora se activa a mano (todavía no hay pantalla de onboarding):
```sql
update negocios
set modulos_activos = array['pos', 'inventario']
where id = 'ID-DEL-NEGOCIO';
```
Si el negocio también maneja turnos, agregá `'agenda'` al array.

### 2. Dar de alta al dueño piloto
En Supabase → Authentication → Add user, creá su usuario (email + contraseña).
Copiá su UUID y vinculalo a su negocio:
```sql
update negocios set auth_user_id = 'UUID-DEL-USUARIO' where id = 'ID-DEL-NEGOCIO';
```

### 3. Instalar y correr
```bash
npm install
cp .env.example .env   # completar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev
```

### 4. Desplegar
```bash
npm run build
```
Subir la carpeta `dist/` a Vercel (o conectar el repo directo — Vercel
detecta Vite automáticamente). Configurar las mismas variables de
entorno del `.env` en el panel de Vercel.

## Estructura
```
src/
  main.jsx                → punto de entrada
  App.jsx                 → rutas adaptables según módulos activos
  context/AuthContext.jsx → sesión + datos del negocio logueado
  lib/
    supabase.js             → cliente (anon key)
    storage.js               → subida de fotos de producto
  components/
    Layout.jsx             → barra de navegación inferior (adaptable)
    DayTimeline.jsx          → línea de tiempo del día (elemento distintivo)
    TurnoCard.jsx              → tarjeta de turno con acciones
    ProductoCard.jsx            → tarjeta de producto del catálogo
    ProductoForm.jsx              → alta/edición de producto + variantes
    VarianteRow.jsx                 → fila de variante (talle/color/stock)
    MetricPill.jsx
    EstadoBadge.jsx
    ConversacionAlerta.jsx
  pages/
    Login.jsx
    Hoy.jsx
    Turnos.jsx
    Productos.jsx
    Configuracion.jsx
migrations/
  003_panel_auth_rls.sql
  005_retail_rls_y_fotos.sql
```
