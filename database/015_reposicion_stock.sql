-- ============================================================
-- AS ADMIN — Migración 015: reposición manual de stock por WhatsApp
-- Correr DESPUÉS de 014_alertas_stock.sql
--
-- Etapa 4 del bot retail (ver
-- docs/AS_ADMIN_bot_whatsapp_v3_retail_inventario.md, sección 6b): el
-- DUEÑO (no un cliente) le escribe al mismo número de WhatsApp del
-- negocio para avisar que repuso stock ("cargá 20 unidades más de
-- buzo negro L"). El bot SIEMPRE confirma antes de ejecutar, y la
-- reposición queda registrada como un movimiento de inventario con
-- motivo — nunca se toca 'stock' directamente sin dejar ese rastro.
-- ============================================================

-- Estado del "flujo de reposición" del dueño (elegir producto -> variante
-- -> cantidad -> confirmar). Mismo patrón que conversaciones.contexto,
-- pero acá alcanza con una fila por negocio: hay un solo dueño hablando
-- por este canal, no una conversación por cliente.
alter table negocios add column if not exists contexto_admin jsonb not null default '{}';

comment on column negocios.contexto_admin is
  'Estado del flujo de reposición de stock cuando el dueño le escribe al bot. No es una conversación de cliente — se resetea sola al terminar cada reposición.';

-- ------------------------------------------------------------
-- fn_reponer_stock — suma unidades y deja constancia en
-- movimientos_inventario. Mismo criterio que fn_descontar_stock: nunca
-- se actualiza 'stock' sin ese registro.
-- ------------------------------------------------------------

create or replace function fn_reponer_stock(
  p_negocio_id uuid,
  p_producto_id uuid,
  p_variante_id uuid,
  p_cantidad int,
  p_motivo text default 'Reposición por WhatsApp'
) returns int as $$ -- devuelve el stock nuevo, para que el bot lo confirme
declare
  v_nuevo_stock int;
begin
  if p_cantidad <= 0 then
    raise exception 'La cantidad a reponer debe ser positiva';
  end if;

  if p_variante_id is not null then
    update variantes_producto
       set stock = stock + p_cantidad
     where id = p_variante_id and producto_id = p_producto_id and negocio_id = p_negocio_id
     returning stock into v_nuevo_stock;
  else
    update productos
       set stock = stock + p_cantidad
     where id = p_producto_id and negocio_id = p_negocio_id
     returning stock into v_nuevo_stock;
  end if;

  if v_nuevo_stock is null then
    raise exception 'Producto o variante no encontrado para este negocio';
  end if;

  insert into movimientos_inventario (negocio_id, producto_id, variante_id, tipo, cantidad, motivo)
  values (p_negocio_id, p_producto_id, p_variante_id, 'entrada', p_cantidad, p_motivo);

  return v_nuevo_stock;
end;
$$ language plpgsql security invoker;

grant execute on function fn_reponer_stock(uuid, uuid, uuid, int, text) to service_role, authenticated;

-- ============================================================
-- Notas de uso:
--
-- 1. Si esta reposición hace que el producto vuelva a superar su
--    stock_minimo, el aviso de stock bajo (migración 014) se resetea
--    solo en su próxima corrida (cada 5 minutos) — no hace falta
--    tocarlo acá.
--
-- 2. Este flujo NUNCA decide cuánto reponer ni contacta a un
--    proveedor — solo registra lo que el dueño ya decidió y confirmó.
--    Eso sigue explícitamente fuera de alcance (ver sección 6 del
--    documento de definición del bot).
-- ============================================================
