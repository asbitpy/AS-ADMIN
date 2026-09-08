-- ============================================================
-- AS ADMIN — Migración 006: función fn_crear_venta
-- Correr DESPUÉS de 005_retail_rls_y_fotos.sql
--
-- Por qué una función y no varios inserts desde el panel: una venta
-- con 3 productos son, como mínimo, 1 insert en 'ventas' + 3 en
-- 'venta_items' + 3 descuentos de stock. Si el celular del vendedor
-- pierde conexión a mitad de camino, con inserts separados quedaría
-- una venta a medio registrar y stock descontado de forma inconsistente.
-- Con todo esto adentro de una sola función, Postgres lo trata como
-- una única transacción: o se guarda todo, o no se guarda nada.
-- ============================================================

create or replace function fn_crear_venta(
  p_negocio_id uuid,
  p_cliente_id uuid,
  p_metodo_pago metodo_pago,
  p_canal venta_canal,
  p_caja_sesion_id uuid,
  p_descuento_total numeric,
  p_items jsonb -- [{producto_id, variante_id, cantidad, precio_unitario, descuento}, ...]
) returns uuid as $$
declare
  v_venta_id uuid;
  v_subtotal numeric := 0;
  v_item jsonb;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene items';
  end if;

  select coalesce(sum(
    (elem->>'cantidad')::int * (elem->>'precio_unitario')::numeric
    - coalesce((elem->>'descuento')::numeric, 0)
  ), 0)
  into v_subtotal
  from jsonb_array_elements(p_items) elem;

  insert into ventas (
    negocio_id, cliente_id, caja_sesion_id, canal,
    subtotal, descuento, impuesto, total, metodo_pago, estado
  )
  values (
    p_negocio_id, p_cliente_id, p_caja_sesion_id, p_canal,
    v_subtotal, p_descuento_total, 0, v_subtotal - p_descuento_total, p_metodo_pago, 'completada'
  )
  returning id into v_venta_id;
  -- El trigger trg_venta_completada ya genera el ingreso en
  -- movimientos_financieros automáticamente al insertar acá arriba.

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into venta_items (venta_id, producto_id, variante_id, cantidad, precio_unitario, descuento)
    values (
      v_venta_id,
      (v_item->>'producto_id')::uuid,
      nullif(v_item->>'variante_id', '')::uuid,
      (v_item->>'cantidad')::int,
      (v_item->>'precio_unitario')::numeric,
      coalesce((v_item->>'descuento')::numeric, 0)
    );

    -- Si el stock no alcanza, esto lanza una excepción y TODA la
    -- función se revierte: la venta, los items ya insertados, todo.
    perform fn_descontar_stock(
      (v_item->>'producto_id')::uuid,
      nullif(v_item->>'variante_id', '')::uuid,
      (v_item->>'cantidad')::int,
      p_negocio_id,
      v_venta_id
    );
  end loop;

  return v_venta_id;
end;
$$ language plpgsql security invoker;
-- security invoker (el default, pero lo dejamos explícito a propósito):
-- la función corre con los permisos de quien la llama, así que las
-- políticas de RLS se siguen aplicando igual que si fueran inserts sueltos.

grant execute on function fn_crear_venta(uuid, uuid, metodo_pago, venta_canal, uuid, numeric, jsonb) to authenticated;
