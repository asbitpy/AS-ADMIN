-- ============================================================
-- AS ADMIN — Migración 010: pago mixto en el POS
-- Correr DESPUÉS de 009_ventas_clientes_ecommerce.sql
--
-- Hasta ahora una venta tenía un solo método de pago. En un mostrador
-- real pasa todo el tiempo: el cliente paga una parte en efectivo y el
-- resto por transferencia porque no le alcanzó, o divide entre dos
-- tarjetas. El sistema no lo podía registrar — había que elegir uno y
-- mentir, o anotarlo aparte en un cuaderno.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Los pagos de una venta, en su propia tabla
-- ------------------------------------------------------------
-- Una venta simple (el 90% de los casos) sigue teniendo una sola fila
-- acá — no cambia el caso común, solo deja de ser el único caso posible.

create table if not exists venta_pagos (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references ventas(id) on delete cascade,
  metodo_pago metodo_pago not null,
  monto numeric(12,0) not null check (monto > 0),
  creado_en timestamptz not null default now()
);
create index idx_venta_pagos_venta on venta_pagos(venta_id);

alter table venta_pagos enable row level security;

-- Mismo patrón que venta_items en la migración 005: venta_pagos no
-- tiene negocio_id propio, se valida a través de la venta a la que
-- pertenece.
drop policy if exists "dueño ve sus pagos de venta" on venta_pagos;
create policy "dueño ve sus pagos de venta" on venta_pagos
  for all using (
    venta_id in (
      select id from ventas where negocio_id in (
        select id from negocios where auth_user_id = auth.uid()
      )
    )
  );

-- 'ventas.metodo_pago' se queda, pero deja de ser obligatorio: cuando
-- la venta se dividió en más de un método, esta columna queda en null
-- (la respuesta real vive en venta_pagos) — así una consulta simple que
-- solo quiere "¿fue en efectivo?" sigue funcionando para el caso común,
-- sin mentir en el caso dividido.
alter table ventas alter column metodo_pago drop not null;
alter table ventas alter column metodo_pago drop default;

-- Ventas que ya existen: se les arma su fila en venta_pagos con el
-- método que ya tenían, para que el historial viejo se lea igual con
-- las consultas nuevas.
insert into venta_pagos (venta_id, metodo_pago, monto)
select id, metodo_pago, total
from ventas
where metodo_pago is not null
  and not exists (select 1 from venta_pagos where venta_pagos.venta_id = ventas.id);


-- ------------------------------------------------------------
-- 2. fn_crear_venta ahora recibe una lista de pagos, no uno solo
-- ------------------------------------------------------------
-- Cambia la firma (un jsonb de pagos en vez de un solo metodo_pago), así
-- que hay que borrar la función vieja antes de crear la nueva: Postgres
-- no permite "create or replace" cuando cambian los parámetros.

drop function if exists fn_crear_venta(uuid, uuid, metodo_pago, venta_canal, uuid, numeric, jsonb);

create or replace function fn_crear_venta(
  p_negocio_id uuid,
  p_cliente_id uuid,
  p_pagos jsonb, -- [{metodo_pago, monto}, ...] — uno para el caso simple, varios para dividir
  p_canal venta_canal,
  p_caja_sesion_id uuid,
  p_descuento_total numeric,
  p_items jsonb -- [{producto_id, variante_id, cantidad, descuento}, ...]
) returns uuid as $$
declare
  v_venta_id uuid;
  v_subtotal numeric := 0;
  v_total numeric;
  v_suma_pagos numeric;
  v_metodo_unico metodo_pago;
  v_item jsonb;
  v_pago jsonb;
  v_producto_id uuid;
  v_variante_id uuid;
  v_cantidad int;
  v_descuento numeric;
  v_precio numeric;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene items';
  end if;
  if jsonb_array_length(p_pagos) = 0 then
    raise exception 'La venta no tiene ningún pago registrado';
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
       or coalesce((elem->>'descuento')::numeric, 0) < 0
  ) then
    raise exception 'Cantidad o descuento inválido en un ítem';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) elem
    where coalesce((elem->>'descuento')::numeric, 0) >
          fn_precio_vigente(
            (elem->>'producto_id')::uuid,
            nullif(elem->>'variante_id', '')::uuid,
            p_negocio_id
          ) * (elem->>'cantidad')::int
  ) then
    raise exception 'El descuento de un ítem supera su precio';
  end if;

  select coalesce(sum(
    fn_precio_vigente(
      (elem->>'producto_id')::uuid,
      nullif(elem->>'variante_id', '')::uuid,
      p_negocio_id
    ) * (elem->>'cantidad')::int
    - coalesce((elem->>'descuento')::numeric, 0)
  ), 0)
  into v_subtotal
  from jsonb_array_elements(p_items) elem;

  if p_descuento_total < 0 or p_descuento_total > v_subtotal then
    raise exception 'El descuento total es inválido para esta venta';
  end if;

  v_total := v_subtotal - p_descuento_total;

  -- Lo que suman los pagos tiene que ser EXACTAMENTE el total. Ni de
  -- más ni de menos — así el vuelto y el "faltó cobrar" los calcula el
  -- panel antes de mandar, no queda a mitad de camino en la base.
  if exists (select 1 from jsonb_array_elements(p_pagos) elem where (elem->>'monto')::numeric <= 0) then
    raise exception 'Hay un pago con monto inválido';
  end if;

  select coalesce(sum((elem->>'monto')::numeric), 0)
  into v_suma_pagos
  from jsonb_array_elements(p_pagos) elem;

  if v_suma_pagos != v_total then
    raise exception 'Los pagos (Gs. %) no coinciden con el total de la venta (Gs. %)', v_suma_pagos, v_total;
  end if;

  -- Si es un solo método, ventas.metodo_pago lo guarda tal cual (para
  -- que las consultas simples de siempre lo sigan viendo ahí). Si se
  -- dividió, queda en null: la verdad completa vive en venta_pagos.
  if jsonb_array_length(p_pagos) = 1 then
    v_metodo_unico := (p_pagos->0->>'metodo_pago')::metodo_pago;
  else
    v_metodo_unico := null;
  end if;

  insert into ventas (
    negocio_id, cliente_id, caja_sesion_id, canal,
    subtotal, descuento, impuesto, total, metodo_pago, estado
  )
  values (
    p_negocio_id, p_cliente_id, p_caja_sesion_id, p_canal,
    v_subtotal, p_descuento_total, 0, v_total, v_metodo_unico, 'completada'
  )
  returning id into v_venta_id;
  -- El trigger trg_venta_completada genera el ingreso en
  -- movimientos_financieros con este total ya validado.

  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    insert into venta_pagos (venta_id, metodo_pago, monto)
    values (v_venta_id, (v_pago->>'metodo_pago')::metodo_pago, (v_pago->>'monto')::numeric);
  end loop;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_producto_id := (v_item->>'producto_id')::uuid;
    v_variante_id := nullif(v_item->>'variante_id', '')::uuid;
    v_cantidad    := (v_item->>'cantidad')::int;
    v_descuento   := coalesce((v_item->>'descuento')::numeric, 0);
    v_precio      := fn_precio_vigente(v_producto_id, v_variante_id, p_negocio_id);

    insert into venta_items (venta_id, producto_id, variante_id, cantidad, precio_unitario, descuento)
    values (v_venta_id, v_producto_id, v_variante_id, v_cantidad, v_precio, v_descuento);

    -- Si el stock no alcanza, esto lanza una excepción y TODA la
    -- función se revierte: la venta, los pagos, los items, todo.
    perform fn_descontar_stock(v_producto_id, v_variante_id, v_cantidad, p_negocio_id, v_venta_id);
  end loop;

  return v_venta_id;
end;
$$ language plpgsql security invoker;

grant execute on function fn_crear_venta(uuid, uuid, jsonb, venta_canal, uuid, numeric, jsonb) to authenticated;


-- ------------------------------------------------------------
-- 3. fn_anular_venta: al devolver la plata hay que devolver TODOS
--    los métodos con los que se cobró, no solo uno
-- ------------------------------------------------------------
-- La lógica de stock y del egreso financiero no cambia — sigue siendo
-- un solo movimiento por el total, porque a movimientos_financieros no
-- le importa CÓMO se cobró, solo cuánto entró y cuánto salió. Lo único
-- que hay que releer acá es de dónde sale 'v_venta.metodo_pago', que ya
-- no es obligatorio: la función no lo usaba de todos modos, así que no
-- cambia nada — se deja igual, con un comentario para que quede claro.

comment on function fn_anular_venta is
  'No necesita tocar venta_pagos: anular no revierte pago por pago, revierte el total en un solo movimiento financiero (igual que se generó). El desglose de venta_pagos queda como quedó, es historia — no se borra.';
