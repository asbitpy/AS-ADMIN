-- ============================================================
-- AS ADMIN — Migración 013: reservas de pedido por WhatsApp
-- Correr DESPUÉS de 012_realtime.sql
--
-- Sustenta la Etapa 2 del bot retail (ver
-- docs/AS_ADMIN_bot_whatsapp_v3_retail_inventario.md, sección 5):
-- el cliente aparta un producto por WhatsApp y lo retira y paga en el
-- local. El stock se descuenta al reservar (mismo mecanismo atómico que
-- el POS) para que dos canales no vendan la última unidad dos veces, y
-- la reserva vence sola si nadie la retira.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Nuevo estado de venta
-- ------------------------------------------------------------
-- No se usa este valor en ninguna sentencia de este mismo script (solo
-- dentro del cuerpo de funciones, que no se ejecuta al crearlas) — así
-- evitamos el error de Postgres "unsafe use of new value of enum type"
-- por usar el valor en la misma transacción en la que se agrega.

alter type venta_estado add value if not exists 'reservada';

-- ------------------------------------------------------------
-- 2. Vencimiento de la reserva
-- ------------------------------------------------------------

alter table ventas add column if not exists reservado_hasta timestamptz;

comment on column ventas.reservado_hasta is
  'Solo tiene valor mientras estado = ''reservada''. Pasado este momento, fn_liberar_reservas_vencidas() cancela la reserva y devuelve el stock.';

-- ------------------------------------------------------------
-- 3. El trigger de ingreso automático ahora también dispara al
--    COMPLETAR una reserva, no solo al insertar una venta ya completada
-- ------------------------------------------------------------
-- Antes el trigger era "after insert" nada más, porque toda venta nacía
-- completada. Ahora una venta puede nacer 'reservada' y completarse
-- recién cuando el cliente paga en el local — el ingreso tiene que
-- generarse en ESE momento, no cuando se apartó el producto.
-- La condición "old.estado is distinct from 'completada'" evita
-- duplicar el ingreso si algo vuelve a actualizar la fila ya completada.

drop trigger if exists trg_venta_completada on ventas;

create or replace function fn_venta_genera_ingreso()
returns trigger as $$
begin
  if new.estado = 'completada' and (tg_op = 'INSERT' or old.estado is distinct from 'completada') then
    insert into movimientos_financieros (negocio_id, tipo, monto, categoria, origen, fecha, caja_sesion_id)
    values (new.negocio_id, 'ingreso', new.total, 'venta', 'automatico', current_date, new.caja_sesion_id);
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_venta_completada
  after insert or update of estado on ventas
  for each row execute function fn_venta_genera_ingreso();

-- ------------------------------------------------------------
-- 4. fn_crear_reserva — arma el pedido y aparta el stock, sin cobrar
-- ------------------------------------------------------------
-- Mismas validaciones que fn_crear_venta (producto y variante existen y
-- son de este negocio, cantidades positivas), pero sin pagos: nadie
-- cobró todavía. El precio se calcula server-side igual que siempre
-- (fn_precio_vigente), nunca lo manda el bot.

create or replace function fn_crear_reserva(
  p_negocio_id uuid,
  p_cliente_id uuid,
  p_items jsonb, -- [{producto_id, variante_id, cantidad}, ...]
  p_horas_para_retirar numeric default 4
) returns uuid as $$
declare
  v_venta_id uuid;
  v_subtotal numeric := 0;
  v_item jsonb;
  v_producto_id uuid;
  v_variante_id uuid;
  v_cantidad int;
  v_precio numeric;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no tiene items';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) elem
    left join productos p
      on p.id = (elem->>'producto_id')::uuid
     and p.negocio_id = p_negocio_id
    where p.id is null
  ) then
    raise exception 'Hay un producto que no existe o no pertenece a este negocio';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) elem
    left join variantes_producto v
      on v.id = nullif(elem->>'variante_id', '')::uuid
     and v.producto_id = (elem->>'producto_id')::uuid
     and v.negocio_id = p_negocio_id
    where nullif(elem->>'variante_id', '') is not null
      and v.id is null
  ) then
    raise exception 'Hay una variante que no existe o no corresponde a ese producto';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) elem
    where (elem->>'cantidad')::int <= 0
  ) then
    raise exception 'Cantidad inválida en un ítem';
  end if;

  select coalesce(sum(
    fn_precio_vigente(
      (elem->>'producto_id')::uuid,
      nullif(elem->>'variante_id', '')::uuid,
      p_negocio_id
    ) * (elem->>'cantidad')::int
  ), 0)
  into v_subtotal
  from jsonb_array_elements(p_items) elem;

  insert into ventas (
    negocio_id, cliente_id, canal, subtotal, descuento, impuesto, total,
    metodo_pago, estado, reservado_hasta
  )
  values (
    p_negocio_id, p_cliente_id, 'whatsapp', v_subtotal, 0, 0, v_subtotal,
    null, 'reservada', now() + (p_horas_para_retirar || ' hours')::interval
  )
  returning id into v_venta_id;
  -- El trigger no dispara acá: estado = 'reservada', no 'completada'.
  -- Todavía no hay ingreso porque todavía no hay plata cobrada.

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_producto_id := (v_item->>'producto_id')::uuid;
    v_variante_id := nullif(v_item->>'variante_id', '')::uuid;
    v_cantidad    := (v_item->>'cantidad')::int;
    v_precio      := fn_precio_vigente(v_producto_id, v_variante_id, p_negocio_id);

    insert into venta_items (venta_id, producto_id, variante_id, cantidad, precio_unitario, descuento)
    values (v_venta_id, v_producto_id, v_variante_id, v_cantidad, v_precio, 0);

    -- Se descuenta el stock ACÁ, al reservar — no al completar. Es lo
    -- que evita que dos canales vendan la última unidad dos veces.
    perform fn_descontar_stock(v_producto_id, v_variante_id, v_cantidad, p_negocio_id, v_venta_id);
  end loop;

  return v_venta_id;
end;
$$ language plpgsql security invoker;

grant execute on function fn_crear_reserva(uuid, uuid, jsonb, numeric) to service_role, authenticated;

-- ------------------------------------------------------------
-- 5. fn_completar_reserva — el cajero cobra cuando el cliente retira
-- ------------------------------------------------------------
-- El stock NO se vuelve a tocar acá (ya se descontó al reservar). Solo
-- se registran los pagos reales y la venta pasa a 'completada' — ahí
-- recién dispara el trigger que genera el ingreso.

create or replace function fn_completar_reserva(
  p_venta_id uuid,
  p_pagos jsonb, -- [{metodo_pago, monto}, ...]
  p_caja_sesion_id uuid default null
) returns void as $$
declare
  v_venta record;
  v_suma_pagos numeric;
  v_metodo_unico metodo_pago;
  v_pago jsonb;
begin
  select * into v_venta from ventas where id = p_venta_id;

  if v_venta is null then
    raise exception 'Pedido no encontrado';
  end if;
  if v_venta.estado <> 'reservada' then
    raise exception 'Este pedido ya no está reservado (estado actual: %)', v_venta.estado;
  end if;
  if jsonb_array_length(p_pagos) = 0 then
    raise exception 'El pedido no tiene ningún pago registrado';
  end if;
  if exists (select 1 from jsonb_array_elements(p_pagos) elem where (elem->>'monto')::numeric <= 0) then
    raise exception 'Hay un pago con monto inválido';
  end if;

  select coalesce(sum((elem->>'monto')::numeric), 0)
  into v_suma_pagos
  from jsonb_array_elements(p_pagos) elem;

  if v_suma_pagos != v_venta.total then
    raise exception 'Los pagos (Gs. %) no coinciden con el total del pedido (Gs. %)', v_suma_pagos, v_venta.total;
  end if;

  if jsonb_array_length(p_pagos) = 1 then
    v_metodo_unico := (p_pagos->0->>'metodo_pago')::metodo_pago;
  else
    v_metodo_unico := null;
  end if;

  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    insert into venta_pagos (venta_id, metodo_pago, monto)
    values (p_venta_id, (v_pago->>'metodo_pago')::metodo_pago, (v_pago->>'monto')::numeric);
  end loop;

  update ventas
     set estado = 'completada',
         metodo_pago = v_metodo_unico,
         caja_sesion_id = p_caja_sesion_id,
         reservado_hasta = null
   where id = p_venta_id;
end;
$$ language plpgsql security invoker;

grant execute on function fn_completar_reserva(uuid, jsonb, uuid) to service_role, authenticated;

-- ------------------------------------------------------------
-- 6. fn_cancelar_reserva — el cliente no retira, o se arrepiente
-- ------------------------------------------------------------
-- A diferencia de fn_anular_venta: acá NUNCA se genera un movimiento
-- financiero de egreso, porque una reserva nunca generó el ingreso que
-- habría que compensar (el trigger solo dispara en 'completada'). Si
-- reutilizáramos fn_anular_venta acá, generaría un egreso fantasma sin
-- ingreso previo que lo justifique.

create or replace function fn_cancelar_reserva(p_venta_id uuid, p_motivo text default 'Reserva cancelada')
returns void as $$
declare
  v_venta record;
  v_item record;
begin
  select * into v_venta from ventas where id = p_venta_id;

  if v_venta is null then
    raise exception 'Pedido no encontrado';
  end if;
  if v_venta.estado <> 'reservada' then
    raise exception 'Este pedido ya no está reservado (estado actual: %)', v_venta.estado;
  end if;

  for v_item in select * from venta_items where venta_id = p_venta_id loop
    if v_item.variante_id is not null then
      update variantes_producto set stock = stock + v_item.cantidad where id = v_item.variante_id;
    else
      update productos set stock = stock + v_item.cantidad where id = v_item.producto_id;
    end if;

    insert into movimientos_inventario (
      negocio_id, producto_id, variante_id, tipo, cantidad, referencia_venta_id, motivo
    ) values (
      v_venta.negocio_id, v_item.producto_id, v_item.variante_id, 'devolucion',
      v_item.cantidad, p_venta_id, p_motivo
    );
  end loop;

  update ventas set estado = 'anulada', anulada_motivo = p_motivo, reservado_hasta = null where id = p_venta_id;
end;
$$ language plpgsql security invoker;

grant execute on function fn_cancelar_reserva(uuid, text) to service_role, authenticated;

-- ------------------------------------------------------------
-- 7. fn_liberar_reservas_vencidas — housekeeping, llamado periódicamente
--    desde el backend (mismo patrón que procesarRecordatorios en
--    server.js: setInterval cada 5 minutos, sin cron externo por ahora)
-- ------------------------------------------------------------

create or replace function fn_liberar_reservas_vencidas()
returns int as $$
declare
  v_venta record;
  v_contador int := 0;
begin
  for v_venta in
    select id from ventas where estado = 'reservada' and reservado_hasta < now()
  loop
    perform fn_cancelar_reserva(v_venta.id, 'Venció el plazo de retiro sin que el cliente pasara a buscarlo');
    v_contador := v_contador + 1;
  end loop;
  return v_contador;
end;
$$ language plpgsql security invoker;

grant execute on function fn_liberar_reservas_vencidas() to service_role;

-- ============================================================
-- Notas de uso:
--
-- 1. reservado_hasta es configurable por negocio: el backend decide qué
--    pasarle a fn_crear_reserva como p_horas_para_retirar (ej. leyendo
--    negocio.config->>'reserva_horas'), no hay un valor fijo en la base.
--
-- 2. vista_clientes_resumen (migración 009) ya filtra por
--    estado = 'completada' para "compras_totales"/"total_gastado" — una
--    reserva pendiente o cancelada no se cuenta ahí sin cambios.
--
-- 3. Falta la parte del panel: una acción para que el cajero complete o
--    cancele una reserva a mano (llamando fn_completar_reserva /
--    fn_cancelar_reserva). Queda para cuando se conecte esta migración
--    al panel — no se toca el panel en esta migración.
-- ============================================================
