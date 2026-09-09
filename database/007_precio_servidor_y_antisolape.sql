-- ============================================================
-- AS ADMIN — Migración 007: precio calculado en el servidor +
--                           turnos que no se pueden solapar
-- Correr DESPUÉS de 006_fn_crear_venta.sql
--
-- Dos arreglos que comparten la misma idea: el dato que decide plata
-- o disponibilidad no puede venir del cliente ni depender de que la
-- aplicación "se acuerde" de chequear. Lo decide la base de datos.
-- ============================================================


-- ------------------------------------------------------------
-- PARTE 1 — El precio de venta sale del catálogo, no del navegador
-- ------------------------------------------------------------
-- Antes, fn_crear_venta confiaba en el 'precio_unitario' que le mandaba
-- el panel. Cualquiera con una sesión válida podía cobrar un producto
-- de 500.000 Gs. a 1.000 desde la consola del navegador, y ese número
-- entraba derecho a movimientos_financieros como ingreso legítimo.
-- Hoy el único usuario es el dueño, pero cuando existan cajeros y
-- vendedores (roles y permisos están en el roadmap) esto es plata real.

-- Precio vigente de un ítem: el de la variante si tiene override propio,
-- si no el del producto padre. Una sola definición para que el cálculo
-- del total y el precio guardado en cada ítem nunca puedan discrepar.
create or replace function fn_precio_vigente(
  p_producto_id uuid,
  p_variante_id uuid,
  p_negocio_id uuid
) returns numeric as $$
  select coalesce(v.precio_override, p.precio)
  from productos p
  left join variantes_producto v
    on v.id = p_variante_id
   and v.producto_id = p.id
   and v.negocio_id = p.negocio_id
  where p.id = p_producto_id
    and p.negocio_id = p_negocio_id;
$$ language sql stable security invoker;

grant execute on function fn_precio_vigente(uuid, uuid, uuid) to authenticated;


create or replace function fn_crear_venta(
  p_negocio_id uuid,
  p_cliente_id uuid,
  p_metodo_pago metodo_pago,
  p_canal venta_canal,
  p_caja_sesion_id uuid,
  p_descuento_total numeric,
  p_items jsonb -- [{producto_id, variante_id, cantidad, descuento}, ...]
) returns uuid as $$
declare
  v_venta_id uuid;
  v_subtotal numeric := 0;
  v_item jsonb;
  v_producto_id uuid;
  v_variante_id uuid;
  v_cantidad int;
  v_descuento numeric;
  v_precio numeric;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene items';
  end if;

  -- Todo producto tiene que existir y ser de este negocio. Sin esto, un
  -- producto de otro negocio entraría al carrito con su precio.
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

  -- Si el ítem trae variante, tiene que ser una variante real de ESE
  -- producto y de ESTE negocio (si no, el precio caería al del padre).
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

  -- Ningún descuento de ítem puede superar lo que ese ítem vale.
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

  -- Subtotal con los precios del catálogo, ignorando por completo
  -- cualquier precio que haya venido en p_items.
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

  insert into ventas (
    negocio_id, cliente_id, caja_sesion_id, canal,
    subtotal, descuento, impuesto, total, metodo_pago, estado
  )
  values (
    p_negocio_id, p_cliente_id, p_caja_sesion_id, p_canal,
    v_subtotal, p_descuento_total, 0, v_subtotal - p_descuento_total, p_metodo_pago, 'completada'
  )
  returning id into v_venta_id;
  -- El trigger trg_venta_completada genera el ingreso en
  -- movimientos_financieros con este total ya validado.

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_producto_id := (v_item->>'producto_id')::uuid;
    v_variante_id := nullif(v_item->>'variante_id', '')::uuid;
    v_cantidad    := (v_item->>'cantidad')::int;
    v_descuento   := coalesce((v_item->>'descuento')::numeric, 0);
    v_precio      := fn_precio_vigente(v_producto_id, v_variante_id, p_negocio_id);

    insert into venta_items (venta_id, producto_id, variante_id, cantidad, precio_unitario, descuento)
    values (v_venta_id, v_producto_id, v_variante_id, v_cantidad, v_precio, v_descuento);

    -- Si el stock no alcanza, esto lanza una excepción y TODA la
    -- función se revierte: la venta, los items ya insertados, todo.
    perform fn_descontar_stock(v_producto_id, v_variante_id, v_cantidad, p_negocio_id, v_venta_id);
  end loop;

  return v_venta_id;
end;
$$ language plpgsql security invoker;
-- security invoker (el default, pero lo dejamos explícito a propósito):
-- la función corre con los permisos de quien la llama, así que las
-- políticas de RLS se siguen aplicando igual que si fueran inserts sueltos.

grant execute on function fn_crear_venta(uuid, uuid, metodo_pago, venta_canal, uuid, numeric, jsonb) to authenticated;


-- ------------------------------------------------------------
-- PARTE 2 — Dos turnos no pueden pisarse en el mismo horario
-- ------------------------------------------------------------
-- El bot revalidaba la franja y recién después insertaba el turno: dos
-- clientes que elegían la misma franja en el mismo instante pasaban los
-- dos el chequeo. Es el mismo problema que ya resolvimos para el stock
-- con fn_descontar_stock (select ... for update); acá lo resolvemos con
-- una restricción de exclusión, que es la herramienta de Postgres para
-- "estos dos rangos de tiempo no pueden superponerse".

create extension if not exists btree_gist;

-- La duración se copia al turno igual que ya se copia el monto: un turno
-- de 45 minutos sigue ocupando 45 minutos aunque mañana el servicio pase
-- a durar 30. Además, sin la duración en la propia fila, la restricción
-- de abajo no puede calcular el rango que ocupa el turno.
alter table turnos add column if not exists duracion_minutos int;

update turnos t
set duracion_minutos = s.duracion_minutos
from servicios s
where s.id = t.servicio_id
  and t.duracion_minutos is null;

update turnos set duracion_minutos = 30 where duracion_minutos is null;

alter table turnos alter column duracion_minutos set default 30;
alter table turnos alter column duracion_minutos set not null;

-- La hora de fin se guarda como columna, no se calcula dentro de la
-- restricción. Motivo: en Postgres, "timestamptz + interval" es STABLE y
-- no IMMUTABLE (un intervalo puede traer días o meses, que dependen del
-- huso horario), y un índice solo admite expresiones inmutables. Con la
-- hora de fin ya guardada, la restricción compara dos columnas y listo.
alter table turnos add column if not exists fecha_hora_fin timestamptz;

create or replace function fn_turno_calcula_fin()
returns trigger as $$
begin
  new.fecha_hora_fin := new.fecha_hora + make_interval(mins => new.duracion_minutos);
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_turno_calcula_fin on turnos;
create trigger trg_turno_calcula_fin
  before insert or update of fecha_hora, duracion_minutos on turnos
  for each row execute function fn_turno_calcula_fin();

update turnos
   set fecha_hora_fin = fecha_hora + make_interval(mins => duracion_minutos)
 where fecha_hora_fin is null;

alter table turnos alter column fecha_hora_fin set not null;

-- Un negocio sin profesionales cargados tiene profesional_id null en
-- todos sus turnos, y en una restricción de exclusión dos NULL nunca
-- "chocan" entre sí. El coalesce los agrupa bajo un mismo valor para
-- que la agenda del negocio se comporte como una sola agenda, que es
-- exactamente como la trata hoy el motor de disponibilidad.
alter table turnos drop constraint if exists turnos_sin_solape;
alter table turnos add constraint turnos_sin_solape
  exclude using gist (
    negocio_id with =,
    (coalesce(profesional_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    tstzrange(fecha_hora, fecha_hora_fin) with &&
  )
  where (estado in ('pendiente', 'confirmado', 'reprogramado'));

-- Si el ALTER de arriba falla, es porque la base YA tiene turnos
-- superpuestos (datos de prueba, o el bug que esto viene a arreglar).
-- Para encontrarlos:
--
--   select a.id, b.id, a.fecha_hora, b.fecha_hora
--   from turnos a
--   join turnos b
--     on a.negocio_id = b.negocio_id
--    and a.id < b.id
--    and a.estado in ('pendiente','confirmado','reprogramado')
--    and b.estado in ('pendiente','confirmado','reprogramado')
--    and tstzrange(a.fecha_hora, a.fecha_hora_fin)
--     && tstzrange(b.fecha_hora, b.fecha_hora_fin);
--
-- Cancelá o moví uno de cada par y volvé a correr la migración.
