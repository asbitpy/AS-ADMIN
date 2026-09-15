-- ============================================================
-- AS ADMIN — Migración 023: registrar quién hizo cada venta
-- Correr DESPUÉS de 022_empleados_horario_sueldo.sql
--
-- 'ventas.usuario_id' existe desde la migración 004 pero nunca se
-- completó — fn_crear_venta nunca lo escribía. Sin esto, la nueva
-- sección "Actividad" de Equipo (cuánto vendió cada persona) no tiene
-- de dónde sacar el dato. 'caja_sesiones.usuario_id' sí se completa
-- desde el panel (CajaBar.jsx) — mismo criterio se aplica acá.
--
-- Se usa auth.uid() DENTRO de la función (no un parámetro nuevo desde
-- el panel) porque fn_crear_venta ya es security invoker: auth.uid()
-- adentro es siempre el usuario que de verdad está logueado haciendo
-- la venta, no algo que el cliente pueda mandar armado. Mismo criterio
-- que 'movimientos_financieros.registrado_por default auth.uid()' de
-- la migración 017.
--
-- La firma de la función NO cambia (mismos parámetros), así que
-- 'create or replace' alcanza — no hace falta un drop primero.
-- ============================================================

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

  if exists (select 1 from jsonb_array_elements(p_pagos) elem where (elem->>'monto')::numeric <= 0) then
    raise exception 'Hay un pago con monto inválido';
  end if;

  select coalesce(sum((elem->>'monto')::numeric), 0)
  into v_suma_pagos
  from jsonb_array_elements(p_pagos) elem;

  if v_suma_pagos != v_total then
    raise exception 'Los pagos (Gs. %) no coinciden con el total de la venta (Gs. %)', v_suma_pagos, v_total;
  end if;

  if jsonb_array_length(p_pagos) = 1 then
    v_metodo_unico := (p_pagos->0->>'metodo_pago')::metodo_pago;
  else
    v_metodo_unico := null;
  end if;

  insert into ventas (
    negocio_id, cliente_id, caja_sesion_id, canal,
    subtotal, descuento, impuesto, total, metodo_pago, estado, usuario_id
  )
  values (
    p_negocio_id, p_cliente_id, p_caja_sesion_id, p_canal,
    v_subtotal, p_descuento_total, 0, v_total, v_metodo_unico, 'completada', auth.uid()
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

    perform fn_descontar_stock(v_producto_id, v_variante_id, v_cantidad, p_negocio_id, v_venta_id);
  end loop;

  return v_venta_id;
end;
$$ language plpgsql security invoker;

grant execute on function fn_crear_venta(uuid, uuid, jsonb, venta_canal, uuid, numeric, jsonb) to authenticated;

-- Nota: las ventas hechas ANTES de esta migración quedan con
-- usuario_id en null para siempre — no hay forma de reconstruir
-- después quién las hizo. La sección "Actividad" de Equipo las
-- agrupa aparte, sin romper ni inventar un responsable.
