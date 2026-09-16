-- ============================================================
-- AS ADMIN — Migración 028: equipo de AS BIT (alta de negocios)
-- Correr DESPUÉS de 027_fichajes.sql
--
-- Hasta ahora dar de alta un negocio cliente era un insert a mano en
-- el SQL Editor de Supabase. Esta migración agrega el mínimo necesario
-- para hacerlo desde una pantalla del panel: una tabla chica que dice
-- quién de AS BIT (no un dueño de negocio) puede administrar negocios
-- ajenos, y los permisos para que esas personas vean y creen filas en
-- 'negocios' sin pisar el modelo de seguridad existente (que sigue
-- siendo "cada dueño solo ve/edita el suyo").
-- ============================================================

create table staff_asbit (
  auth_user_id uuid primary key references auth.users(id),
  nombre text,
  creado_en timestamptz not null default now()
);

comment on table staff_asbit is
  'Quién de AS BIT (no un dueño de negocio) puede dar de alta y administrar negocios de clientes. Se carga a mano la primera vez, mismo criterio que agregar un empleado: creás la cuenta en Supabase Auth, copiás el UUID, y lo insertás acá — insert into staff_asbit (auth_user_id, nombre) values (''UUID'', ''Tu nombre'');';

alter table staff_asbit enable row level security;

-- Cada quien puede ver únicamente si SU PROPIA cuenta está en la lista
-- (para que el panel pueda preguntar "¿soy staff?" sin poder listar ni
-- editar el resto de la tabla).
create policy "cada quien ve si es staff" on staff_asbit
  for select using (auth_user_id = auth.uid());

-- security invoker (no definer): alcanza con la política de arriba,
-- que ya permite leer la propia fila — no hace falta saltarse RLS.
create or replace function fn_es_staff_asbit()
returns boolean as $$
  select exists (select 1 from staff_asbit where auth_user_id = auth.uid());
$$ language sql stable security invoker set search_path = public;

grant execute on function fn_es_staff_asbit() to authenticated;

-- Políticas ADICIONALES sobre 'negocios' (se suman a las de
-- 011_usuarios_y_roles.sql, no las reemplazan — un dueño común sigue
-- viendo y editando exactamente lo mismo que antes).
create policy "staff de as bit ve todos los negocios" on negocios
  for select using (fn_es_staff_asbit());

create policy "staff de as bit crea negocios" on negocios
  for insert with check (fn_es_staff_asbit());

create policy "staff de as bit edita negocios" on negocios
  for update using (fn_es_staff_asbit());

-- ============================================================
-- Para activar tu propio acceso después de correr esta migración:
--
-- 1. Copiá tu UUID de Supabase → Authentication → Users (el mismo que
--    ya usás para loguearte en un negocio de prueba).
-- 2. insert into staff_asbit (auth_user_id, nombre) values
--    ('TU-UUID', 'Arturo');
-- 3. Entrá a /asbit/negocios en el panel.
-- ============================================================
