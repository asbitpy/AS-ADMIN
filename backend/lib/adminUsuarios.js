const supabase = require('./supabase');

// Antes, la única forma de crear una cuenta de Supabase Auth para un
// empleado nuevo (o el dueño de un negocio nuevo) era entrar a mano al
// panel de Supabase — un paso que un usuario normal del panel no sabe
// hacer. Esto lo reemplaza: lo hace el backend (que ya corre con la
// service key, nunca expuesta al navegador) y devuelve una contraseña
// temporal para pasarle a la persona. Todavía no hay pantalla de
// "cambiar mi contraseña" en el panel — queda para más adelante.

const CARACTERES_PASSWORD = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/l/I, se prestan a confusión al dictarla

function generarPasswordTemporal(longitud = 10) {
  let resultado = '';
  for (let i = 0; i < longitud; i++) {
    resultado += CARACTERES_PASSWORD[Math.floor(Math.random() * CARACTERES_PASSWORD.length)];
  }
  return resultado;
}

// Verifica el token de sesión que manda el panel (Authorization: Bearer
// ...) y devuelve el usuario de Supabase Auth al que pertenece, o null
// si no es válido. No decide permisos acá — la autorización real sigue
// pasando por RLS cuando el panel inserta en 'usuarios' o 'negocios'
// con el UUID que este endpoint devuelve.
async function usuarioDesdeToken(authHeader) {
  const token = (authHeader || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

// Crea la cuenta de Auth ya confirmada (mismo efecto que tildar "Auto
// Confirm User" a mano) con una contraseña temporal generada acá.
async function crearCuentaAuth({ email, nombre }) {
  const password = generarPasswordTemporal();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: nombre ? { nombre } : undefined,
  });

  if (error) {
    const yaExiste = /already|existe|registered/i.test(error.message || '');
    const err = new Error(yaExiste ? 'Ya existe una cuenta con ese email.' : 'No se pudo crear la cuenta.');
    err.status = 400;
    throw err;
  }

  return { auth_user_id: data.user.id, password };
}

module.exports = { usuarioDesdeToken, crearCuentaAuth };
