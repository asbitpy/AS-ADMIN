-- ============================================================
-- AS ADMIN — Migración 011: usuarios del equipo (empleados y roles)
-- Correr DESPUÉS de 010_pago_mixto.sql
--
-- Hasta ahora un negocio era un solo login compartido: el dueño, y
-- quien tuviera su contraseña. Ahora cada persona del equipo entra con
-- su propia cuenta, y cada venta, cada caja abierta, cada movimiento
-- de stock puede quedar a nombre de quién lo hizo de verdad.
--
-- Esta es la migración más delicada de todas las que hay en esta
-- carpeta: no agrega una pantalla, cambia el modelo de seguridad de
-- TODA la app. Por eso el enfoque es conservador a propósito —
-- lo que sigue es la base sólida (quién puede entrar a los datos de
-- qué negocio), no todavía los permisos finos (quién puede hacer un
-- descuento, quién puede anular una venta). Esos quedan para una
-- migración aparte, sobre esta base — mezclar las dos cosas en un
-- solo paso es la forma más común de terminar con un modelo de
-- permisos a medio hacer y difícil de auditar.
-- ============================================================


-- ------------------------------------------------------------
-- 1. La tabla de usuarios del equipo
-- ------------------------------------------------------------

create type rol_usuario as enum ('dueno', 'gerente', 'cajero', 'vendedor', 'profesional');
-- Se guarda sin tilde ('dueno', no 'dueño') por la misma razón que el
-- resto de los valores de enum de este proyecto son ASCII simple
-- ('no_show', 'reprogramado', etc.): en la UI se muestra "Dueño" igual,
-- pero el valor guardado no depende de que todo lo que lo toque
-- (URLs, comparaciones de texto) maneje bien la tilde.

create table usuarios (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  -- unique: una cuenta de Supabase Auth pertenece a un solo negocio acá.
  -- Alguien que de verdad trabaje en dos negocios distintos necesita dos
  -- cuentas (dos emails) — una limitación consciente para no complicar
  -- el modelo con membresías múltiples en la primera versión.
  auth_user_id uuid not null unique references auth.users(id),
  nombre text not null,
  rol rol_usuario not null default 'vendedor',
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
create index idx_usuarios_negocio on usuarios(negocio_id);

comment on table usuarios is
  'Empleados con su propio login, vinculados a un negocio con un rol. El dueño del negocio (negocios.auth_user_id) no necesita fila acá — ya tiene acceso total por ser el dueño.';


-- ------------------------------------------------------------
-- 2. La pregunta que se repite en cada política de seguridad:
--    "¿a qué negocios puede entrar el usuario logueado ahora mismo?"
-- ------------------------------------------------------------
-- Antes la respuesta era una sola línea ("el negocio cuyo auth_user_id
-- soy yo") repetida en cada política. Ahora la respuesta es "el negocio
-- del que soy dueño, MÁS los negocios donde soy un empleado activo" —
-- para no repetir esa unión en 20 políticas distintas (y arriesgarse a
-- que una quede desactualizada), vive en una sola función.
--
-- SECURITY DEFINER a propósito: esta función necesita leer 'negocios'
-- y 'usuarios' por dentro sin que la propia RLS de esas tablas la
-- bloquee (si no, sería una gallina-y-huevo: la política de 'usuarios'
-- necesitaría esta función, que necesitaría leer 'usuarios'...). Es
-- seguro porque SIEMPRE filtra por auth.uid() — el usuario de la sesión
-- actual — nunca puede devolver el negocio de otra persona.
create or replace function fn_negocios_accesibles()
returns setof uuid as $$
  select id from negocios where auth_user_id = auth.uid()
  union
  select negocio_id from usuarios where auth_user_id = auth.uid() and activo = true;
$$ language sql stable security definer set search_path = public;

grant execute on function fn_negocios_accesibles() to authenticated;


-- ------------------------------------------------------------
-- 3. Negocios: todo el equipo lo puede VER, solo el dueño lo EDITA
-- ------------------------------------------------------------
-- La política vieja era "for all" con una sola condición. Se separa en
-- una por operación porque ver los datos del negocio (dirección,
-- horarios) es algo que un cajero necesita todos los días, pero cambiar
-- esos datos, o los módulos activos, sigue siendo solo del dueño.

drop policy if exists "dueño ve su negocio" on negocios;

create policy "negocio visible para dueño y equipo" on negocios
  for select using (id in (select fn_negocios_accesibles()));

create policy "solo el dueño crea su negocio" on negocios
  for insert with check (auth_user_id = auth.uid());

create policy "solo el dueño edita su negocio" on negocios
  for update using (auth_user_id = auth.uid());

create policy "solo el dueño borra su negocio" on negocios
  for delete using (auth_user_id = auth.uid());


-- ------------------------------------------------------------
-- 4. El resto de las tablas: mismo patrón de siempre, apuntando
--    ahora a fn_negocios_accesibles() en vez de a auth_user_id directo
-- ------------------------------------------------------------
-- Deliberado para esta versión: cualquier persona activa del equipo
-- tiene el mismo acceso de lectura/escritura a los datos operativos de
-- su negocio (vender, agendar, cargar productos...). Restringir por
-- rol ACÁ ADENTRO ("un cajero no puede borrar una venta") es la
-- migración que sigue — hacerlo bien necesita su propio diseño, no es
-- un ajuste de una línea en este loop.

do $$
declare
  tabla text;
begin
  foreach tabla in array array[
    'clientes', 'servicios', 'profesionales', 'turnos', 'conversaciones',
    'movimientos_financieros', 'productos', 'ventas_productos', 'pagos',
    'feriados_excepciones', 'lista_espera',
    'categorias', 'variantes_producto', 'movimientos_inventario', 'caja_sesiones',
    'ventas', 'proveedores', 'ordenes_compra', 'creditos_clientes'
  ]
  loop
    execute format('drop policy if exists "dueño ve su data" on %I;', tabla);
    execute format(
      'create policy "equipo ve su data" on %I for all using (
        negocio_id in (select fn_negocios_accesibles())
      );', tabla
    );
  end loop;
end $$;

-- Las que se validan a través de otra tabla (no tienen negocio_id
-- propio), mismo cambio, uno por uno porque cada una junta con una
-- tabla distinta.

drop policy if exists "dueño ve sus mensajes" on mensajes;
create policy "equipo ve sus mensajes" on mensajes
  for all using (
    conversacion_id in (
      select id from conversaciones where negocio_id in (select fn_negocios_accesibles())
    )
  );

drop policy if exists "dueño ve sus items de venta" on venta_items;
create policy "equipo ve sus items de venta" on venta_items
  for all using (
    venta_id in (
      select id from ventas where negocio_id in (select fn_negocios_accesibles())
    )
  );

drop policy if exists "dueño ve sus items de compra" on orden_compra_items;
create policy "equipo ve sus items de compra" on orden_compra_items
  for all using (
    orden_compra_id in (
      select id from ordenes_compra where negocio_id in (select fn_negocios_accesibles())
    )
  );

drop policy if exists "dueño ve sus pagos de venta" on venta_pagos;
create policy "equipo ve sus pagos de venta" on venta_pagos
  for all using (
    venta_id in (
      select id from ventas where negocio_id in (select fn_negocios_accesibles())
    )
  );

-- Fotos de producto (Supabase Storage): mismo cambio.
drop policy if exists "dueño sube fotos de su negocio" on storage.objects;
create policy "equipo sube fotos de su negocio" on storage.objects
  for insert with check (
    bucket_id = 'productos-fotos'
    and (storage.foldername(name))[1]::uuid in (select fn_negocios_accesibles())
  );

drop policy if exists "dueño borra fotos de su negocio" on storage.objects;
create policy "equipo borra fotos de su negocio" on storage.objects
  for delete using (
    bucket_id = 'productos-fotos'
    and (storage.foldername(name))[1]::uuid in (select fn_negocios_accesibles())
  );


-- ------------------------------------------------------------
-- 5. La tabla 'usuarios' se protege a sí misma
-- ------------------------------------------------------------
-- Todo el equipo puede VER quiénes son sus compañeros (para mostrar
-- nombres en reportes, por ejemplo). Pero dar de alta, cambiar el rol
-- o dar de baja a alguien queda SOLO para el dueño real — a propósito
-- no se usa fn_negocios_accesibles() acá: un empleado (cualquiera sea
-- su rol) nunca puede tocar la tabla que decide quién es empleado.

alter table usuarios enable row level security;

create policy "equipo ve su propio equipo" on usuarios
  for select using (negocio_id in (select fn_negocios_accesibles()));

create policy "solo el dueño da de alta empleados" on usuarios
  for insert with check (negocio_id in (select id from negocios where auth_user_id = auth.uid()));

create policy "solo el dueño edita empleados" on usuarios
  for update using (negocio_id in (select id from negocios where auth_user_id = auth.uid()));

create policy "solo el dueño da de baja empleados" on usuarios
  for delete using (negocio_id in (select id from negocios where auth_user_id = auth.uid()));


-- ============================================================
-- Cómo dar de alta a un empleado (a mano, por ahora — la pantalla
-- Equipo del panel hace el resto, pero la cuenta de Supabase Auth
-- todavía se crea igual que la del dueño):
--
-- 1. Supabase → Authentication → Add user (email + contraseña,
--    marcando "Auto Confirm User")
-- 2. Copiar su UUID
-- 3. Panel → Equipo → Agregar empleado → pegar ese UUID, nombre y rol
--
-- El paso 3 también se puede hacer con SQL directo:
--   insert into usuarios (negocio_id, auth_user_id, nombre, rol)
--   values ('ID-DEL-NEGOCIO', 'UUID-DEL-USUARIO', 'Nombre', 'cajero');
-- ============================================================
