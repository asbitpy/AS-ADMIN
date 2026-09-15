import { Monitor, Smartphone } from 'lucide-react';

// Solo para desarrollo (ver useEsEscritorio.js): fuerza el layout de
// escritorio o celular sin depender del ancho real de la ventana, para
// poder revisar los dos mientras se construye la versión de escritorio.
// Nunca se renderiza en producción — import.meta.env.DEV es false en
// el build que se sube a Vercel.
export default function SelectorVistaDev({ esEscritorio, forzado, forzar }) {
  if (!import.meta.env.DEV) return null;

  function elegir(valor) {
    // Tocar la opción ya activa vuelve a "automático" (el ancho real decide).
    forzar(forzado === valor ? null : valor);
  }

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-0.5 rounded-full border border-line bg-surface p-1 shadow-card">
      <button
        onClick={() => elegir('celular')}
        title="Forzar vista celular"
        className={`rounded-full p-1.5 ${
          !esEscritorio ? 'bg-accent-soft text-accent' : 'text-muted'
        }`}
      >
        <Smartphone size={14} />
      </button>
      <button
        onClick={() => elegir('escritorio')}
        title="Forzar vista escritorio"
        className={`rounded-full p-1.5 ${
          esEscritorio ? 'bg-accent-soft text-accent' : 'text-muted'
        }`}
      >
        <Monitor size={14} />
      </button>
      {!forzado && <span className="pr-2 text-[9px] text-muted">auto</span>}
    </div>
  );
}
