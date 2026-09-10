import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [negocio, setNegocio] = useState(null);
  // null = el usuario logueado ES el dueño (negocios.auth_user_id).
  // Si no, acá va su fila de 'usuarios': { id, nombre, rol }.
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setCargando(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nuevaSesion) => {
      setSession(nuevaSesion);
      if (!nuevaSesion) {
        setNegocio(null);
        setUsuario(null);
        setCargando(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;

    let activo = true;
    setCargando(true);

    async function cargarAcceso() {
      // Primero: ¿es el dueño de algún negocio? (siempre tiene acceso total)
      const { data: negocioPropio } = await supabase
        .from('negocios')
        .select('*')
        .eq('auth_user_id', session.user.id)
        .maybeSingle();

      if (!activo) return;

      if (negocioPropio) {
        setNegocio(negocioPropio);
        setUsuario(null);
        setCargando(false);
        return;
      }

      // No es dueño de ningún negocio: ¿es un empleado activo de alguno?
      const { data: fila } = await supabase
        .from('usuarios')
        .select('id, nombre, rol, negocio:negocios(*)')
        .eq('auth_user_id', session.user.id)
        .eq('activo', true)
        .maybeSingle();

      if (!activo) return;

      setNegocio(fila?.negocio || null);
      setUsuario(fila ? { id: fila.id, nombre: fila.nombre, rol: fila.rol } : null);
      setCargando(false);
    }

    cargarAcceso();

    return () => {
      activo = false;
    };
  }, [session]);

  const signIn = (email, password) =>
    supabase.auth.signInWithPassword({ email, password });

  const signOut = () => supabase.auth.signOut();

  // 'dueno' cuando usuario es null (es el dueño real), si no el rol
  // que tenga su fila en 'usuarios'.
  const rol = usuario?.rol || 'dueno';
  const esDueno = rol === 'dueno';

  return (
    <AuthContext.Provider value={{ session, negocio, usuario, rol, esDueno, cargando, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
