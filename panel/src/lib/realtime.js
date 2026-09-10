import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/**
 * Se incrementa cada vez que algo cambia en `tabla` para este negocio
 * (requiere que 012_realtime.sql haya habilitado la réplica de esa
 * tabla). No intenta fusionar el cambio a mano — la pantalla que lo usa
 * lo agrega a su propio useEffect de carga, y vuelve a pedir los datos
 * con su cargar() de siempre. Más simple y más seguro que mantener dos
 * copias de la misma lógica (una para la carga inicial, otra para
 * "parchear" el cambio que llegó).
 *
 * Uso:
 *   const tick = useRealtimeTick('turnos', negocio?.id);
 *   useEffect(() => { if (negocio) cargarDatos(); }, [negocio, tick]);
 */
export function useRealtimeTick(tabla, negocioId) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!negocioId) return;

    const canal = supabase
      .channel(`${tabla}-${negocioId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tabla, filter: `negocio_id=eq.${negocioId}` },
        () => setTick((t) => t + 1)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [tabla, negocioId]);

  return tick;
}
