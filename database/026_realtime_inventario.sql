-- ============================================================
-- AS ADMIN — Migración 026: tiempo real para Inventario
-- Correr DESPUÉS de 025_datos_empleados.sql
--
-- La pantalla nueva de Inventario (escritorio) escucha cambios en
-- 'movimientos_inventario' para refrescarse sola (mismo patrón que
-- 012_realtime.sql) — esa tabla se quedó afuera de esa migración
-- porque en ese momento todavía no tenía ninguna pantalla que la mirara
-- directamente.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'movimientos_inventario'
  ) then
    execute 'alter publication supabase_realtime add table public.movimientos_inventario';
  end if;
end $$;
