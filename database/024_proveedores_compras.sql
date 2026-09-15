-- ============================================================
-- AS ADMIN — Migración 024: pantalla de Proveedores y Compras
-- Correr DESPUÉS de 023_ventas_usuario.sql
--
-- 'proveedores', 'ordenes_compra' y 'orden_compra_items' existen desde
-- la migración 004, con RLS desde la 005 y accesibles para todo el
-- equipo desde la 011 — pero nunca se construyó ninguna pantalla que
-- las use. Esta migración solo agrega lo que faltaba para eso:
--
-- 1. 'proveedores.activo' — no existía ningún soft-delete acá (todo lo
--    demás del sistema usa ese patrón: productos, servicios,
--    profesionales, usuarios). Sin esto, dar de baja un proveedor sería
--    borrarlo de verdad, y una orden de compra vieja que lo referencia
--    perdería el dato.
-- 2. fn_recibir_orden_compra — la única función nueva que hace falta.
--    Marcar una orden como "recibida" TIENE que subir el stock: nunca
--    a mano, mismo criterio que todo lo demás que mueve stock en este
--    proyecto (fn_descontar_stock, fn_reponer_stock). Reutiliza
--    fn_reponer_stock item por item, así el registro en
--    movimientos_inventario queda exactamente igual que cualquier otra
--    entrada de stock — no hay un camino paralelo para esto.
-- ============================================================

alter table proveedores add column if not exists activo boolean not null default true;

create or replace function fn_recibir_orden_compra(p_orden_id uuid)
returns void as $$
declare
  v_negocio_id uuid;
  v_estado orden_compra_estado;
  v_item record;
begin
  select negocio_id, estado into v_negocio_id, v_estado
  from ordenes_compra
  where id = p_orden_id;

  if v_negocio_id is null then
    raise exception 'Orden de compra no encontrada';
  end if;

  if v_estado = 'recibida' then
    raise exception 'Esta orden ya fue recibida';
  end if;
  if v_estado = 'cancelada' then
    raise exception 'Esta orden está cancelada';
  end if;

  for v_item in select * from orden_compra_items where orden_compra_id = p_orden_id loop
    perform fn_reponer_stock(
      v_negocio_id,
      v_item.producto_id,
      v_item.variante_id,
      v_item.cantidad,
      'Recepción de orden de compra'
    );
  end loop;

  update ordenes_compra
     set estado = 'recibida', recibida_en = now()
   where id = p_orden_id;
end;
$$ language plpgsql security invoker;

grant execute on function fn_recibir_orden_compra(uuid) to authenticated;

-- Nota: crear una orden de compra (borrador/enviada) y cancelarla son
-- inserts/updates directos desde el panel, sin función — no mueven
-- stock ni plata todavía, así que no hace falta la misma protección.
-- Recién "recibida" mueve stock de verdad, y por eso es la única que
-- pasa por una función de base de datos.
