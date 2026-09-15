import { useEffect, useState } from 'react';

// Mismo punto de quiebre que documenta AS_ADMIN_pantallas_y_escritorio_v1.md:
// desde 1280px se considera "escritorio" (barra lateral, más detalle).
const CONSULTA = '(min-width: 1280px)';
const CLAVE_FORZADO = 'as_admin_vista_forzada'; // 'escritorio' | 'celular' | null

function leerForzado() {
  // El forzado manual (el selector de la esquina) solo existe en
  // desarrollo — nunca debe decidir el layout real de un negocio.
  if (!import.meta.env.DEV) return null;
  try {
    return localStorage.getItem(CLAVE_FORZADO);
  } catch {
    return null;
  }
}

// Decide si el panel se muestra en modo escritorio (barra lateral) o
// celular (navegación abajo). Por defecto sigue el ancho real de la
// ventana; en desarrollo se puede forzar uno u otro para probar los
// dos layouts sin tener que achicar la ventana cada vez (ver
// SelectorVistaDev.jsx).
export function useEsEscritorio() {
  const [anchoEscritorio, setAnchoEscritorio] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(CONSULTA).matches
  );
  const [forzado, setForzadoState] = useState(leerForzado);

  useEffect(() => {
    const mq = window.matchMedia(CONSULTA);
    const onChange = (e) => setAnchoEscritorio(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  function forzar(valor) {
    if (!import.meta.env.DEV) return;
    setForzadoState(valor);
    try {
      if (valor) localStorage.setItem(CLAVE_FORZADO, valor);
      else localStorage.removeItem(CLAVE_FORZADO);
    } catch {
      // Storage no disponible (privado/bloqueado): el forzado no
      // persiste entre recargas, pero no rompe nada.
    }
  }

  const esEscritorio = forzado ? forzado === 'escritorio' : anchoEscritorio;

  return { esEscritorio, forzado, forzar };
}
