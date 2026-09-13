import { supabase } from './supabase';

const BUCKET_PRODUCTOS = 'productos-fotos';
const BUCKET_COMPROBANTES = 'comprobantes-pago';

/** Sube una foto de producto y devuelve su URL pública. */
export async function subirFotoProducto({ negocioId, productoId, file }) {
  const extension = file.name.split('.').pop();
  const ruta = `${negocioId}/${productoId}.${extension}`;

  const { error } = await supabase.storage
    .from(BUCKET_PRODUCTOS)
    .upload(ruta, file, { upsert: true, cacheControl: '3600' });

  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET_PRODUCTOS).getPublicUrl(ruta);
  return data.publicUrl;
}

async function subirComprobanteEnRuta(ruta, file) {
  const { error } = await supabase.storage
    .from(BUCKET_COMPROBANTES)
    .upload(ruta, file, { upsert: true, cacheControl: '3600' });

  if (error) throw error;
  return ruta;
}

/** Sube el comprobante de una venta. Guarda la RUTA (no una URL pública
 *  — el bucket es privado) para poder pedir después una signed URL. */
export async function subirComprobante({ negocioId, ventaId, file }) {
  const extension = file.name.split('.').pop();
  return subirComprobanteEnRuta(`${negocioId}/${ventaId}.${extension}`, file);
}

/** Sube el comprobante de un movimiento financiero (gasto/ingreso
 *  manual). Mismo bucket privado, con el prefijo 'mov-' para no chocar
 *  con los ids de venta. */
export async function subirComprobanteMovimiento({ negocioId, movimientoId, file }) {
  const extension = file.name.split('.').pop();
  return subirComprobanteEnRuta(`${negocioId}/mov-${movimientoId}.${extension}`, file);
}

/** Devuelve una URL firmada de corta duración para ver un comprobante
 *  (el bucket es privado — no hay URL pública directa). */
export async function urlComprobante(ruta, segundosValidez = 300) {
  const { data, error } = await supabase.storage
    .from(BUCKET_COMPROBANTES)
    .createSignedUrl(ruta, segundosValidez);

  if (error) throw error;
  return data.signedUrl;
}
