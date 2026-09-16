-- ============================================================
-- AS ADMIN — Migración 027: fichaje de entrada/salida
-- Correr DESPUÉS de 026_realtime_inventario.sql
--
-- Primera parte de "Jornadas del equipo" (ver
-- AS_ADMIN_pantallas_y_escritorio_v1.md, sección 8 — quedaba explícita
-- como "todavía sin diseñar"). A propósito, esta migración es SOLO el
-- fichaje real (cuándo entró y salió cada quien) — no incluye
-- comisiones: calcularlas bien depende de reglas de negocio (¿por
-- venta? ¿por servicio completado? ¿porcentaje fijo o por escalón?)
-- que todavía no están definidas, e inventarlas acá sería adivinar.
-- El horario DE REFERENCIA (lo planificado) ya existe desde la
-- migración 022 (usuarios.horario) — esto es lo REAL, para compararlo.
-- ============================================================

create table fichajes (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references negocios(id) on delete cascade,
  -- auth.uid() de quien fichó — el dueño (negocios.auth_user_id) o
  -- alguien de 'usuarios', mismo criterio sin FK que ventas.usuario_id
  -- y caja_sesiones.usuario_id (esa columna vive en las dos tablas de
  -- auth distintas, así que no se puede apuntar con una sola FK).
  usuario_id uuid not null,
  entrada timestamptz not null default now(),
  salida timestamptz,
  creado_en timestamptz not null default now()
);
create index idx_fichajes_negocio on fichajes(negocio_id, entrada);

alter table fichajes enable row level security;

-- Mismo criterio que el resto de las tablas operativas desde la
-- migración 011: cualquiera del equipo activo ve y crea fichajes de su
-- negocio (no solo los propios) — así se puede armar la grilla de
-- "quién está trabajando ahora" para todos, no una vista aislada por
-- persona.
create policy "equipo ve y ficha su negocio" on fichajes
  for all using (negocio_id in (select fn_negocios_accesibles()));

-- Tiempo real, mismo patrón que 012_realtime.sql — la pantalla de
-- Jornadas necesita verse sola cuando alguien ficha desde su celular
-- mientras el dueño la tiene abierta.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fichajes'
  ) then
    execute 'alter publication supabase_realtime add table public.fichajes';
  end if;
end $$;
