-- ============================================================
-- AS ADMIN — Migración 032: corrige un efecto de la 031 en las fotos
-- Correr DESPUÉS de 031_endurecimiento_seguridad.sql (SQL Editor de
-- Supabase). Es re-ejecutable.
--
-- La 031 (sección 8) sacó la política pública de lectura del bucket
-- 'productos-fotos' para que nadie pudiera LISTAR las carpetas de todos
-- los negocios. Efecto no previsto: subir una foto con "upsert" (así lo
-- hace ProductoForm) necesita poder leer/actualizar la fila del objeto,
-- y desde entonces fallaba con "violates row-level security policy".
--
-- Las URLs públicas de las fotos siguen funcionando sin política (el
-- bucket es público). Acá se le da al EQUIPO de cada negocio permiso de
-- leer y actualizar SOLO las fotos de su propia carpeta.
-- ============================================================

drop policy if exists "equipo ve fotos de su negocio" on storage.objects;
create policy "equipo ve fotos de su negocio" on storage.objects
  for select using (
    bucket_id = 'productos-fotos'
    and (storage.foldername(name))[1]::uuid in (select fn_negocios_accesibles())
  );

drop policy if exists "equipo actualiza fotos de su negocio" on storage.objects;
create policy "equipo actualiza fotos de su negocio" on storage.objects
  for update using (
    bucket_id = 'productos-fotos'
    and (storage.foldername(name))[1]::uuid in (select fn_negocios_accesibles())
  )
  with check (
    bucket_id = 'productos-fotos'
    and (storage.foldername(name))[1]::uuid in (select fn_negocios_accesibles())
  );
