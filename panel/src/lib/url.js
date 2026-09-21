// Deja una dirección web lista para guardar: agrega https:// si falta y
// rechaza cualquier cosa que no sea un sitio http(s) con dominio. Devuelve
// { url } o { error }. Vacío es válido (significa "sin sitio").
export function normalizarSitioWeb(texto) {
  const crudo = String(texto || '').trim();
  if (!crudo) return { url: null };

  const conProtocolo = /^[a-z][a-z0-9+.-]*:\/\//i.test(crudo) ? crudo : `https://${crudo}`;
  let u;
  try {
    u = new URL(conProtocolo);
  } catch {
    return { error: 'Esa dirección no parece válida. Ejemplo: tutienda.com.py' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { error: 'Solo se aceptan direcciones que empiecen con http:// o https://' };
  }
  if (!u.hostname.includes('.')) {
    return { error: 'Falta el dominio completo. Ejemplo: tutienda.com.py' };
  }
  return { url: u.toString().replace(/\/$/, '') };
}
