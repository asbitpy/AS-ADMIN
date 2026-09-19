-- ============================================================
-- AS ADMIN — Migración 031: endurecimiento de seguridad
-- Correr DESPUÉS de 030_nombre_dueno.sql (en el SQL Editor de Supabase).
-- Es re-ejecutable: todo usa "if exists" / "create or replace".
--
-- Sale de la revisión completa del 2026-09-18. Hasta ahora, a nivel de
-- base de datos, cualquier persona activa del equipo (incluso un
-- cajero) podía, con la clave pública del panel, hacer cosas que la
-- pantalla no le muestra. Esto cierra los casos más graves:
--
--   1. Un cajero podía anular/borrar ventas y movimientos de plata
--      saltándose el permiso "anular ventas".
--   2. Cualquier usuario logueado podía crearse un negocio propio y
--      ponerse el plan/módulos que quisiera, o el dueño cambiarse el
--      plan solo. Ahora eso es solo de AS BIT (staff_asbit).
--   3. Un dueño podía "adoptar" la cuenta de cualquier persona por su
--      UUID (incluida la de otro negocio o la de AS BIT) para luego
--      resetearle la contraseña.
--   4. fn_anular_venta: dos clics a la vez devolvían el stock dos
--      veces, se podía "anular" una reserva (egreso fantasma), y una
--      venta a crédito anulada dejaba la deuda pendiente.
--   5. fn_recibir_orden_compra: dos clics sumaban el stock doble.
--   6. Los ingresos automáticos se fechaban con el día de UTC: una
--      venta hecha después de las 21:00 caía "mañana".
-- ============================================================

-- ------------------------------------------------------------
-- 0. Funciones auxiliares (SECURITY DEFINER para poder leer
--    negocios/usuarios sin que la RLS las bloquee; siempre filtran por
--    auth.uid(), nunca devuelven datos de otra persona)
-- ------------------------------------------------------------

create or replace function fn_es_gerencia(p_negocio uuid)
returns boolean as $$
  select exists (select 1 from negocios where id = p_negocio and auth_user_id = auth.uid())
      or exists (
        select 1 from usuarios
         where negocio_id = p_negocio and auth_user_id = auth.uid() and activo = true
           and rol in ('dueno', 'gerente')
      );
$$ language sql stable security definer set search_path = public;

create or replace function fn_puede_anular_ventas(p_negocio uuid)
returns boolean as $$
  select fn_es_gerencia(p_negocio)
      or exists (
        select 1 from usuarios
         where negocio_id = p_negocio and auth_user_id = auth.uid() and activo = true
           and 'anular_ventas' = any(permisos_extra)
      );
$$ language sql stable security definer set search_path = public;

grant execute on function fn_es_gerencia(uuid) to authenticated;
grant execute on function fn_puede_anular_ventas(uuid) to authenticated;

-- ------------------------------------------------------------
-- 1. Borrar ventas y movimientos de plata: solo dueño/gerente.
--    Política RESTRICTIVE: se suma (AND) a "equipo ve su data".
--    Anular una venta NO es borrarla — sigue pasando por
--    fn_anular_venta. Los borrados en cascada (borrar un negocio) no
--    pasan por RLS.
-- ------------------------------------------------------------
do $$
declare
  tabla text;
begin
  foreach tabla in array array[
    'ventas', 'movimientos_financieros', 'caja_sesiones',
    'creditos_clientes', 'movimientos_inventario'
  ]
  loop
    if to_regclass(tabla) is not null then
      execute format('drop policy if exists "solo gerencia borra" on %I;', tabla);
      execute format(
        'create policy "solo gerencia borra" on %I as restrictive for delete using (fn_es_gerencia(negocio_id));',
        tabla
      );
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 2. Ventas: un total registrado no se edita a mano, y pasar una venta
--    completada a "anulada" exige el permiso (antes solo lo exigía la
--    función, pero un UPDATE directo se lo saltaba). Cancelar una
--    reserva (reservada → anulada) sigue libre para todo el equipo.
--    Sin sesión (auth.uid() null) = backend con la clave de servicio.
-- ------------------------------------------------------------
create or replace function fn_ventas_proteger()
returns trigger as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.negocio_id is distinct from old.negocio_id
     or new.total is distinct from old.total
     or new.subtotal is distinct from old.subtotal then
    raise exception 'Una venta registrada no se puede modificar: anulala y cargá una nueva.';
  end if;

  if old.estado::text = 'completada' and new.estado::text = 'anulada'
     and not fn_puede_anular_ventas(new.negocio_id) then
    raise exception 'No tenés permiso para anular ventas. Pedile al dueño o a un gerente, o que te den el permiso especial en Equipo.';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_ventas_proteger on ventas;
create trigger trg_ventas_proteger
  before update on ventas
  for each row execute function fn_ventas_proteger();

-- ------------------------------------------------------------
-- 3. Negocios: plan, módulos, estado, dueño y número de WhatsApp solo
--    los cambia AS BIT. Nadie más puede crear negocios. El dueño y los
--    gerentes siguen editando nombre, dirección, horarios, etc.
-- ------------------------------------------------------------
drop policy if exists "solo el dueño crea su negocio" on negocios;

drop policy if exists "gerencia edita el negocio" on negocios;
create policy "gerencia edita el negocio" on negocios
  for update using (fn_es_gerencia(id)) with check (fn_es_gerencia(id));

create or replace function fn_negocios_proteger_columnas()
returns trigger as $$
begin
  if auth.uid() is null or fn_es_staff_asbit() then
    return new;
  end if;

  if new.plan is distinct from old.plan
     or new.modulos_activos is distinct from old.modulos_activos
     or new.activo is distinct from old.activo
     or new.auth_user_id is distinct from old.auth_user_id
     or new.whatsapp_phone_number_id is distinct from old.whatsapp_phone_number_id then
    raise exception 'Solo AS BIT puede cambiar el plan, los módulos, el estado o el número de WhatsApp de un negocio.';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_negocios_proteger_columnas on negocios;
create trigger trg_negocios_proteger_columnas
  before update on negocios
  for each row execute function fn_negocios_proteger_columnas();

-- ------------------------------------------------------------
-- 4. Equipo: no se puede sumar a un negocio la cuenta de alguien que
--    ya es dueño de otro negocio, staff de AS BIT o empleado de otro
--    negocio (así el dueño no puede "adoptar" cuentas ajenas por UUID).
-- ------------------------------------------------------------
create or replace function fn_usuarios_validar_alta()
returns trigger as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if exists (select 1 from negocios where auth_user_id = new.auth_user_id)
     or exists (select 1 from staff_asbit where auth_user_id = new.auth_user_id)
     or exists (
       select 1 from usuarios
        where auth_user_id = new.auth_user_id and negocio_id <> new.negocio_id
     ) then
    raise exception 'Esa cuenta ya pertenece a otro negocio o al equipo de AS BIT y no se puede agregar acá.';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_usuarios_validar_alta on usuarios;
create trigger trg_usuarios_validar_alta
  before insert on usuarios
  for each row execute function fn_usuarios_validar_alta();

-- ------------------------------------------------------------
-- 5. fn_anular_venta: bloquea la fila (dos clics a la vez ya no
--    devuelven el stock doble), solo anula ventas completadas (una
--    reserva se cancela con fn_cancelar_reserva, no genera egreso),
--    deja sin deuda el crédito ligado, y fecha con el día de Asunción.
-- ------------------------------------------------------------
create or replace function fn_anular_venta(p_venta_id uuid, p_motivo text default null)
returns void as $$
declare
  v_venta record;
  v_item record;
begin
  select * into v_venta from ventas where id = p_venta_id for update;

  if v_venta is null then
    raise exception 'Venta no encontrada';
  end if;
  if v_venta.estado::text = 'anulada' then
    raise exception 'Esta venta ya estaba anulada';
  end if;
  if v_venta.estado::text <> 'completada' then
    raise exception 'Solo se puede anular una venta completada. Un pedido reservado se cancela desde Ventas.';
  end if;

  if not fn_puede_anular_ventas(v_venta.negocio_id) then
    raise exception 'No tenés permiso para anular ventas. Pedile al dueño o a un gerente, o que te den el permiso especial en Equipo.';
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
      v_item.cantidad, p_venta_id, coalesce(p_motivo, 'Venta anulada')
    );
  end loop;

  insert into movimientos_financieros (negocio_id, tipo, monto, categoria, origen, fecha, caja_sesion_id, notas)
  values (
    v_venta.negocio_id, 'egreso', v_venta.total, 'venta_anulada', 'automatico',
    (now() at time zone 'America/Asuncion')::date, v_venta.caja_sesion_id, 'Anulación de venta ' || p_venta_id
  );

  -- Si la venta fue a crédito, esa deuda ya no existe. No hay un estado
  -- "anulado" en credito_estado: queda en 0 y como pagado para que no
  -- siga sumando en "Créditos por cobrar" ni en la deuda del cliente.
  update creditos_clientes
     set saldo_pendiente = 0, estado = 'pagado'
   where venta_id = p_venta_id and estado <> 'pagado';

  update ventas
     set estado = 'anulada', anulada_por = auth.uid(), anulada_motivo = p_motivo
   where id = p_venta_id;
end;
$$ language plpgsql security invoker;

grant execute on function fn_anular_venta(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 6. fn_recibir_orden_compra: bloquea la orden mientras se recibe
-- ------------------------------------------------------------
create or replace function fn_recibir_orden_compra(p_orden_id uuid)
returns void as $$
declare
  v_negocio_id uuid;
  v_estado orden_compra_estado;
  v_item record;
begin
  select negocio_id, estado into v_negocio_id, v_estado
  from ordenes_compra
  where id = p_orden_id
  for update;

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

-- ------------------------------------------------------------
-- 7. Ingreso automático de una venta: fecha de Asunción, no de UTC
-- ------------------------------------------------------------
create or replace function fn_venta_genera_ingreso()
returns trigger as $$
begin
  if new.estado = 'completada' and (tg_op = 'INSERT' or old.estado is distinct from 'completada') then
    insert into movimientos_financieros (negocio_id, tipo, monto, categoria, origen, fecha, caja_sesion_id)
    values (
      new.negocio_id, 'ingreso', new.total, 'venta', 'automatico',
      (now() at time zone 'America/Asuncion')::date, new.caja_sesion_id
    );
  end if;
  return new;
end;
$$ language plpgsql;

-- ------------------------------------------------------------
-- 8. Fotos de producto: las URLs públicas funcionan sin esta política;
--    con ella, cualquiera podía LISTAR el bucket y ver los id de todos
--    los negocios.
-- ------------------------------------------------------------
drop policy if exists "cualquiera puede ver fotos de producto" on storage.objects;

-- ------------------------------------------------------------
-- 9. Índices de las consultas más frecuentes
-- ------------------------------------------------------------
create index if not exists idx_ventas_cliente on ventas(cliente_id);
create index if not exists idx_creditos_cliente on creditos_clientes(cliente_id);
create index if not exists idx_conversaciones_cliente_actividad
  on conversaciones(negocio_id, cliente_id, ultima_actividad desc);
create index if not exists idx_turnos_fecha_hora on turnos(fecha_hora);
