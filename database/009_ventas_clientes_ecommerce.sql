-- ============================================================
-- AS ADMIN — Migración 009: anular venta, resumen de clientes,
--                           catálogo público para ecommerce
-- Correr DESPUÉS de 008_whatsapp_por_negocio.sql
--
-- Habilita del lado de la base lo que necesitan tres pantallas nuevas
-- del panel: Ventas (con anulación real, no solo un estado sin efecto),
-- Clientes (con el resumen de actividad de cada uno) y la posibilidad
-- de conectar un sitio de ecommerce externo al catálogo.
-- ============================================================


-- ------------------------------------------------------------
-- PARTE 1 — Anular una venta de verdad
-- ------------------------------------------------------------
-- Hasta ahora 'anulada' era un valor posible de ventas.estado que nadie
-- ponía: no había función que lo hiciera. Anular no es solo cambiar un
-- estado — hay que devolver el stock (con su movimiento, nunca tocando
-- el número a mano) y revertir el ingreso que ya se generó en
-- movimientos_financieros. Todo o nada, misma lógica que fn_crear_venta.

create or replace function fn_anular_venta(p_venta_id uuid, p_motivo text default null)
returns void as $$
declare
  v_venta record;
  v_item record;
begin
  select * into v_venta from ventas where id = p_venta_id;

  if v_venta is null then
    raise exception 'Venta no encontrada';
  end if;
  if v_venta.estado = 'anulada' then
    raise exception 'Esta venta ya estaba anulada';
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

  -- Egreso que compensa el ingreso automático que generó el trigger al
  -- crear la venta. No se borra el ingreso original: así el historial de
  -- movimientos_financieros sigue mostrando la historia completa.
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
-- security invoker: corre con los permisos del que llama, así que un
-- cajero solo puede anular ventas de SU negocio — las políticas de RLS
-- de 'ventas' y 'movimientos_inventario' se siguen aplicando igual.

grant execute on function fn_anular_venta(uuid, text) to authenticated;


-- ------------------------------------------------------------
-- PARTE 2 — Resumen de cada cliente (turnos, compras, gastado)
-- ------------------------------------------------------------
-- La pantalla de Clientes necesita, por cada cliente, cuánto gastó y
-- cuándo fue su última actividad. Calcularlo sumando en el navegador
-- (como hace hoy Productos.jsx con el stock de las variantes) obligaría
-- a traer TODAS las ventas y turnos de TODOS los clientes. Una vista lo
-- resuelve en la base, y con `security_invoker` las políticas de RLS de
-- clientes/turnos/ventas se aplican igual que si fueran consultas
-- sueltas — un dueño no ve nada que no fuera a ver ya antes.

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
  ) as ultima_actividad
from clientes c;

grant select on vista_clientes_resumen to authenticated;


-- ------------------------------------------------------------
-- PARTE 3 — Catálogo público, para conectar un sitio de ecommerce
-- ------------------------------------------------------------
-- 'ecommerce' ya estaba anticipado como valor posible de
-- modulos_activos desde la migración 004, pero no existía ninguna forma
-- de que un sitio externo (que no tiene login de Supabase) leyera el
-- catálogo. Esta función es de lectura pública, A PROPÓSITO:
--   - Solo se puede llamar si el negocio activó el módulo 'ecommerce'
--     (el mismo principio de "nunca mostrar/exponer lo que no se activó")
--   - Solo devuelve productos activos, y solo campos de catálogo
--     (nombre, precio, foto, si hay stock) — nunca costos, nunca datos
--     de clientes, nunca nada del negocio que no sea el catálogo
--   - Es SECURITY DEFINER porque un visitante anónimo de la tienda no
--     tiene sesión de Supabase: no hay auth.uid() que las políticas de
--     RLS puedan usar. Por eso el filtro de seguridad va adentro de la
--     función, no en RLS.

alter table negocios add column if not exists sitio_web_url text;

create or replace function fn_catalogo_publico(p_negocio_id uuid)
returns table (
  producto_id uuid,
  nombre text,
  descripcion text,
  precio numeric,
  foto_url text,
  categoria text,
  en_stock boolean,
  variante_id uuid,
  variante_label text,
  variante_precio numeric,
  variante_en_stock boolean
) as $$
  select
    p.id,
    p.nombre,
    p.descripcion,
    p.precio,
    p.foto_url,
    cat.nombre,
    case when p.tiene_variantes then null else p.stock > 0 end,
    v.id,
    nullif(concat_ws(' · ', v.atributo1_valor, v.atributo2_valor), ''),
    coalesce(v.precio_override, p.precio),
    case when v.id is not null then v.stock > 0 else null end
  from productos p
  left join categorias cat on cat.id = p.categoria_id
  left join variantes_producto v on v.producto_id = p.id and v.negocio_id = p.negocio_id and v.activo = true
  where p.negocio_id = p_negocio_id
    and p.activo = true
    and exists (
      select 1 from negocios n
      where n.id = p_negocio_id and 'ecommerce' = any(n.modulos_activos)
    )
  order by p.nombre;
$$ language sql stable security definer set search_path = public;

grant execute on function fn_catalogo_publico(uuid) to anon, authenticated;

comment on function fn_catalogo_publico is
  'Lectura pública del catálogo, para que un sitio de ecommerce externo muestre el mismo stock y precio que el panel, sin exponer nada del negocio que no sea el catálogo. Se apaga solo con sacar ''ecommerce'' de modulos_activos.';
