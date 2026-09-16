-- ============================================================
-- AS ADMIN — Migración 029: permisos por excepción
-- Correr DESPUÉS de 028_staff_asbit.sql
--
-- Hasta ahora los roles (011_usuarios_y_roles.sql) solo deciden qué
-- PANTALLAS ve cada quien en el panel — a nivel de base de datos,
-- cualquier persona activa del equipo, sea cual sea su rol, puede hacer
-- CUALQUIER cosa operativa de su negocio (ver comentario de la sección
-- 4 de esa migración: "restringir por rol acá adentro es la migración
-- que sigue"). Esta es esa migración, pero a propósito acotada a UN
-- SOLO caso concreto en vez de rediseñar todos los permisos de una vez
-- (eso sí sería adivinar reglas de negocio que nadie pidió todavía):
--
-- ANULAR UNA VENTA pasa a estar restringido a dueño/gerente por
-- default — antes lo podía hacer cualquier cajero o vendedor sin
-- ninguna restricción, ni siquiera visual. 'permisos_extra' es la
-- lista de excepciones: un cajero puntual al que el dueño le da ese
-- permiso de más, sin tener que ascenderlo a gerente.
-- ============================================================

alter table usuarios add column if not exists permisos_extra text[] not null default '{}';

comment on column usuarios.permisos_extra is
  'Permisos que esta persona tiene DE MÁS sobre lo que le daría su rol solo — hoy el único valor que algo hace es ''anular_ventas''. Se edita desde Equipo (solo el dueño, misma política de siempre).';

-- fn_anular_venta ahora exige permiso: dueño, gerente, o alguien con
-- 'anular_ventas' en su permisos_extra. security invoker sigue igual
-- (corre con los permisos del que llama) — el chequeo de abajo es
-- ADEMÁS de eso, no en lugar de eso.
create or replace function fn_anular_venta(p_venta_id uuid, p_motivo text default null)
returns void as $$
declare
  v_venta record;
  v_item record;
  v_dueno_id uuid;
  v_puede boolean;
begin
  select * into v_venta from ventas where id = p_venta_id;

  if v_venta is null then
    raise exception 'Venta no encontrada';
  end if;
  if v_venta.estado = 'anulada' then
    raise exception 'Esta venta ya estaba anulada';
  end if;

  select auth_user_id into v_dueno_id from negocios where id = v_venta.negocio_id;

  select
    (auth.uid() = v_dueno_id)
    or exists (
      select 1 from usuarios
       where negocio_id = v_venta.negocio_id
         and auth_user_id = auth.uid()
         and (rol in ('dueno', 'gerente') or 'anular_ventas' = any(permisos_extra))
    )
  into v_puede;

  if not v_puede then
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
    current_date, v_venta.caja_sesion_id, 'Anulación de venta ' || p_venta_id
  );

  update ventas
     set estado = 'anulada', anulada_por = auth.uid(), anulada_motivo = p_motivo
   where id = p_venta_id;
end;
$$ language plpgsql security invoker;

grant execute on function fn_anular_venta(uuid, text) to authenticated;

-- ============================================================
-- Nota: esto deja UN solo caso realmente exigido (anular ventas). El
-- resto de las acciones sensibles (borrar un producto, editar un
-- precio, etc.) siguen con el mismo acceso amplio de siempre — extender
-- este mismo patrón a otras acciones es directo cuando haga falta, pero
-- cada una merece su propia decisión de qué rol debería poder hacerla
-- por default, no un cambio en bloque.
-- ============================================================
