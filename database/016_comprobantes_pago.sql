-- ============================================================
-- AS ADMIN — Migración 016: comprobante de pago adjunto a la venta
-- Correr DESPUÉS de 015_reposicion_stock.sql
--
-- El cajero puede adjuntar la captura de la transferencia/QR a la
-- venta, para que quede como respaldo y alguien (el dueño, o quien
-- corresponda) la revise después. El bot NUNCA verifica ni confirma un
-- pago mirando esta imagen — eso lo sigue haciendo una persona, mirando
-- su propia app del banco. Ver la discusión de diseño en el chat:
-- ninguna IA puede confirmar que la plata realmente entró con solo leer
-- una captura, así que esto es un respaldo, no una verificación.
-- ============================================================

alter table ventas add column if not exists comprobante_url text;

comment on column ventas.comprobante_url is
  'Ruta del archivo en el bucket comprobantes-pago (no una URL pública — el bucket es privado). Solo respaldo/auditoría, nunca confirma por sí solo que el pago es válido.';

-- ------------------------------------------------------------
-- Bucket "comprobantes-pago" (Supabase Storage)
-- ------------------------------------------------------------
-- Paso manual en el dashboard de Supabase (Storage → New bucket):
--   nombre: "comprobantes-pago"
--   público: NO — a diferencia de las fotos de producto, estas
--   capturas pueden mostrar número de cuenta, nombre del titular, etc.
--   Se accede siempre con una signed URL de corta duración, nunca con
--   una URL pública directa.
--
-- Convención de ruta: {negocio_id}/{venta_id}.jpg — mismo patrón que
-- productos-fotos, así estas políticas validan el negocio mirando la
-- primera carpeta del path.

drop policy if exists "equipo ve comprobantes de su negocio" on storage.objects;
create policy "equipo ve comprobantes de su negocio" on storage.objects
  for select using (
    bucket_id = 'comprobantes-pago'
    and (storage.foldername(name))[1]::uuid in (select fn_negocios_accesibles())
  );

drop policy if exists "equipo sube comprobantes de su negocio" on storage.objects;
create policy "equipo sube comprobantes de su negocio" on storage.objects
  for insert with check (
    bucket_id = 'comprobantes-pago'
    and (storage.foldername(name))[1]::uuid in (select fn_negocios_accesibles())
  );

drop policy if exists "equipo borra comprobantes de su negocio" on storage.objects;
create policy "equipo borra comprobantes de su negocio" on storage.objects
  for delete using (
    bucket_id = 'comprobantes-pago'
    and (storage.foldername(name))[1]::uuid in (select fn_negocios_accesibles())
  );
