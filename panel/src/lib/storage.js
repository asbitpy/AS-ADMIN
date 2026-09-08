import { supabase } from './supabase';

const BUCKET = 'productos-fotos';

/** Sube una foto de producto y devuelve su URL pública. */
export async function subirFotoProducto({ negocioId, productoId, file }) {
  const extension = file.name.split('.').pop();
  const ruta = `${negocioId}/${productoId}.${extension}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(ruta, file, { upsert: true, cacheControl: '3600' });

  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(ruta);
  return data.publicUrl;
}
