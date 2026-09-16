import { supabase } from './supabase';

// Llama al backend (no a Supabase directo) para crear una cuenta de
// Auth nueva — eso necesita la service key, que nunca puede vivir acá.
// Usado por Equipo → Agregar y AdminNegocios → Nuevo negocio, para no
// pedirle a un usuario normal que vaya a crear la cuenta a mano en
// Supabase. Devuelve { auth_user_id, password } o tira un Error con un
// mensaje ya listo para mostrar.
export async function crearCuentaAuth({ email, nombre, password }) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const base = import.meta.env.VITE_BACKEND_URL;
  if (!base) {
    throw new Error('Falta configurar VITE_BACKEND_URL — no se sabe a qué backend llamar.');
  }

  const res = await fetch(`${base}/api/crear-cuenta`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || ''}`,
    },
    body: JSON.stringify({ email, nombre, password }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'No se pudo crear la cuenta. Probá de nuevo.');
  }
  return data;
}

// Para cuando alguien se olvida la contraseña — como queda afuera del
// panel, necesita que el dueño (o AS BIT, si es el dueño el que se
// olvidó) se la resetee. El backend decide si quien pide esto tiene
// permiso. Devuelve { password } o tira un Error con un mensaje listo
// para mostrar.
export async function resetearPassword({ authUserId, password }) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const base = import.meta.env.VITE_BACKEND_URL;
  if (!base) {
    throw new Error('Falta configurar VITE_BACKEND_URL — no se sabe a qué backend llamar.');
  }

  const res = await fetch(`${base}/api/resetear-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || ''}`,
    },
    body: JSON.stringify({ auth_user_id: authUserId, password }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'No se pudo resetear la contraseña. Probá de nuevo.');
  }
  return data;
}
