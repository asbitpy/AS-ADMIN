-- ============================================================
-- AS ADMIN — Migración 012: panel en tiempo real
-- Correr DESPUÉS de 011_usuarios_y_roles.sql
--
-- Hasta ahora, si el bot agendaba un turno nuevo o un cajero cobraba
-- una venta, el dueño no lo veía en el panel hasta recargar la
-- pantalla a mano. Con Equipo ya permitiendo varios cajeros al mismo
-- tiempo, esto pasó de ser una comodidad a algo que puede confundir de
-- verdad (dos personas mirando el stock de un producto sin saber que
-- el otro ya lo vendió).
--
-- Esta migración solo HABILITA la réplica en tiempo real de las tablas
-- que el panel necesita ver actualizarse solas. No cambia ningún dato
-- ni ninguna política de seguridad — Supabase Realtime respeta las
-- mismas políticas de RLS que ya existen: cada usuario solo recibe
-- avisos de cambios en filas que ya podía leer.
-- ============================================================

do $$
declare
  tabla text;
begin
  foreach tabla in array array[
    'turnos', 'conversaciones', 'ventas', 'productos',
    'variantes_producto', 'movimientos_financieros', 'caja_sesiones'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tabla
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tabla);
    end if;
  end loop;
end $$;

-- ============================================================
-- Nota para más adelante: si algún día hace falta ver en el aviso de
-- cambio los valores ANTERIORES de una fila (por ejemplo, para animar
-- "el stock bajó de 5 a 3"), esa tabla necesitaría
-- `alter table <tabla> replica identity full;`. Hoy no hace falta: el
-- panel, al recibir un aviso de cambio, simplemente vuelve a pedir los
-- datos frescos — más simple y sin duplicar la lógica de cada pantalla.
-- ============================================================
