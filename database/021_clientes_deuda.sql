-- ============================================================
-- AS ADMIN — Migración 021: deuda pendiente en vista_clientes_resumen
-- Correr DESPUÉS de 020_resumen_semanal.sql
--
-- La pantalla de Clientes en escritorio (docs/AS_ADMIN_pantallas_y_
-- escritorio_v1.md, sección 6.8) necesita mostrar la deuda de cada
-- cliente en la tabla, sin tener que abrir la ficha de cada uno. Hoy
-- 'creditos_clientes' se lee por cliente cuando se abre su ficha; acá
-- se suma a nivel de vista para poder listarla y filtrar por ella.
--
-- 'create or replace view' solo permite AGREGAR columnas al final, no
-- reordenar ni sacar las que ya existen — por eso esta va después de
-- 'ultima_actividad', no intercalada.
-- ============================================================

create or replace view vista_clientes_resumen
with (security_invoker = true) as
select
  c.id,
  c.negocio_id,
  c.nombre,
  c.telefono,
  c.notas,
  c.fecha_nacimiento,
  c.credito_disponible,
  c.creado_en,
  (select count(*) from turnos t where t.cliente_id = c.id) as turnos_totales,
  (select count(*) from ventas v where v.cliente_id = c.id and v.estado = 'completada') as compras_totales,
  (select coalesce(sum(v.total), 0) from ventas v where v.cliente_id = c.id and v.estado = 'completada') as total_gastado,
  greatest(
    (select max(t.fecha_hora) from turnos t where t.cliente_id = c.id),
    (select max(v.creado_en) from ventas v where v.cliente_id = c.id)
  ) as ultima_actividad,
  (
    select coalesce(sum(cr.saldo_pendiente), 0)
    from creditos_clientes cr
    where cr.cliente_id = c.id and cr.estado <> 'pagado'
  ) as deuda_pendiente
from clientes c;

grant select on vista_clientes_resumen to authenticated;
