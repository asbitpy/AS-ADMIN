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
// Confirm User" a mano). Si quien la crea ya quiere ponerle una
// contraseña propia (por ejemplo, una que ya le dictó a la persona por
// teléfono) se puede mandar 'passwordElegida' — si no, se genera una
// temporal acá. Se devuelve la que se usó en los dos casos, así la
// pantalla de confirmación es siempre la misma.
async function crearCuentaAuth({ email, nombre, passwordElegida }) {
  if (passwordElegida && passwordElegida.length < 6) {
    const err = new Error('La contraseña tiene que tener al menos 6 caracteres.');
    err.status = 400;
    throw err;
  }

  const password = passwordElegida || generarPasswordTemporal();
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

// ¿Puede 'llamadorId' resetearle la contraseña a 'objetivoId'? A
// diferencia de crear-cuenta (donde la autorización real pasa después,
// por RLS, cuando el panel inserta en 'usuarios'/'negocios'), resetear
// una contraseña no toca ninguna fila — sin este chequeo, cualquiera
// logueado podría secuestrar la cuenta de cualquier otra persona con
// solo saber su UUID. Se permite: la propia cuenta, el dueño de un
// negocio sobre sus empleados, o alguien de staff_asbit sobre
// cualquiera (para resetear al dueño de un negocio cliente).
async function puedeResetear(llamadorId, objetivoId) {
  if (llamadorId === objetivoId) return true;

  const { data: filaEmpleado } = await supabase
    .from('usuarios')
    .select('negocio_id')
    .eq('auth_user_id', objetivoId)
    .maybeSingle();

  if (filaEmpleado) {
    const { data: negocioPropio } = await supabase
      .from('negocios')
      .select('id')
      .eq('id', filaEmpleado.negocio_id)
      .eq('auth_user_id', llamadorId)
      .maybeSingle();
    if (negocioPropio) return true;
  }

  const { data: esStaff } = await supabase
    .from('staff_asbit')
    .select('auth_user_id')
    .eq('auth_user_id', llamadorId)
    .maybeSingle();

  return !!esStaff;
}

// Para cuando alguien se olvida la contraseña: como quedó afuera del
// panel, no puede entrar a cambiársela sola — necesita que quien la
// dio de alta (el dueño, o AS BIT si es el dueño el que se olvidó) le
// genere una nueva.
async function resetearPassword({ llamadorId, authUserId, passwordElegida }) {
  const autorizado = await puedeResetear(llamadorId, authUserId);
  if (!autorizado) {
    const err = new Error('No tenés permiso para resetear esa contraseña.');
    err.status = 403;
    throw err;
  }

  if (passwordElegida && passwordElegida.length < 6) {
    const err = new Error('La contraseña tiene que tener al menos 6 caracteres.');
    err.status = 400;
    throw err;
  }

  const password = passwordElegida || generarPasswordTemporal();
  const { error } = await supabase.auth.admin.updateUserById(authUserId, { password });

  if (error) {
    const err = new Error('No se pudo resetear la contraseña.');
    err.status = 400;
    throw err;
  }

  return { password };
}

module.exports = { usuarioDesdeToken, crearCuentaAuth, resetearPassword };
