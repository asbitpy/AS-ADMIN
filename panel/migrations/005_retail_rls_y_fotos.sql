-- ============================================================
-- AS ADMIN — Migración 005: RLS del núcleo retail + fotos de producto
-- Correr DESPUÉS de 004_retail_core.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. RLS en las tablas nuevas de la migración 004
--    (mismo patrón que 003_panel_auth_rls.sql: acceso solo si
--    negocio_id pertenece a un negocio del usuario logueado)
-- ------------------------------------------------------------

alter table categorias enable row level security;
alter table variantes_producto enable row level security;
alter table movimientos_inventario enable row level security;
alter table caja_sesiones enable row level security;
alter table ventas enable row level security;
alter table venta_items enable row level security;
alter table proveedores enable row level security;
alter table ordenes_compra enable row level security;
alter table orden_compra_items enable row level security;
alter table creditos_clientes enable row level security;

do $$
declare
  tabla text;
begin
  foreach tabla in array array[
    'categorias', 'variantes_producto', 'movimientos_inventario', 'caja_sesiones',
    'ventas', 'proveedores', 'ordenes_compra', 'creditos_clientes'
  ]
  loop
    execute format('drop policy if exists "dueño ve su data" on %I;', tabla);
    execute format(
      'create policy "dueño ve su data" on %I for all using (
        negocio_id in (select id from negocios where auth_user_id = auth.uid())
      );', tabla
    );
  end loop;
end $$;

-- venta_items y orden_compra_items no tienen negocio_id directo:
-- se valida a través de la venta / orden de compra a la que pertenecen.
drop policy if exists "dueño ve sus items de venta" on venta_items;
create policy "dueño ve sus items de venta" on venta_items
  for all using (
    venta_id in (
      select id from ventas where negocio_id in (
        select id from negocios where auth_user_id = auth.uid()
      )
    )
  );

drop policy if exists "dueño ve sus items de compra" on orden_compra_items;
create policy "dueño ve sus items de compra" on orden_compra_items
  for all using (
    orden_compra_id in (
      select id from ordenes_compra where negocio_id in (
        select id from negocios where auth_user_id = auth.uid()
      )
    )
  );

-- ------------------------------------------------------------
-- 2. Fotos de producto (Supabase Storage)
-- ------------------------------------------------------------
-- Paso manual en el dashboard de Supabase (Storage → New bucket):
--   nombre: "productos-fotos"
--   público: sí (para que las fotos se puedan mostrar en el catálogo
--             de WhatsApp/ecommerce más adelante sin firmar URLs)
--
-- Convención de ruta: {negocio_id}/{producto_id}.jpg
-- Así estas políticas pueden validar el dueño mirando la primera
-- carpeta del path, con storage.foldername(name).

drop policy if exists "cualquiera puede ver fotos de producto" on storage.objects;
create policy "cualquiera puede ver fotos de producto" on storage.objects
  for select using (bucket_id = 'productos-fotos');

drop policy if exists "dueño sube fotos de su negocio" on storage.objects;
create policy "dueño sube fotos de su negocio" on storage.objects
  for insert with check (
    bucket_id = 'productos-fotos'
    and (storage.foldername(name))[1]::uuid in (
      select id from negocios where auth_user_id = auth.uid()
    )
  );

drop policy if exists "dueño borra fotos de su negocio" on storage.objects;
create policy "dueño borra fotos de su negocio" on storage.objects
  for delete using (
    bucket_id = 'productos-fotos'
    and (storage.foldername(name))[1]::uuid in (
      select id from negocios where auth_user_id = auth.uid()
    )
  );
