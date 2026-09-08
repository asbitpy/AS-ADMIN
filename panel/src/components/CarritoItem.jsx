import { Minus, Plus, X } from 'lucide-react';

export default function CarritoItem({ item, onCambiarCantidad, onQuitar }) {
  const totalLinea = item.cantidad * item.precio_unitario - (item.descuento || 0);

  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface p-3 shadow-card">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{item.nombre}</p>
        {item.variante_label && <p className="text-xs text-muted">{item.variante_label}</p>}
        <p className="font-mono text-xs text-muted">Gs. {item.precio_unitario.toLocaleString('es-PY')} c/u</p>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onCambiarCantidad(Math.max(0, item.cantidad - 1))}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-base text-ink active:scale-95"
        >
          <Minus size={14} />
        </button>
        <span className="w-6 text-center font-mono text-sm">{item.cantidad}</span>
        <button
          onClick={() => onCambiarCantidad(Math.min(item.stock_disponible, item.cantidad + 1))}
          disabled={item.cantidad >= item.stock_disponible}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-base text-ink active:scale-95 disabled:opacity-40"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="w-20 text-right">
        <p className="font-mono text-sm text-ink">Gs. {totalLinea.toLocaleString('es-PY')}</p>
      </div>

      <button onClick={onQuitar} className="text-muted active:text-danger">
        <X size={16} />
      </button>
    </div>
  );
}
