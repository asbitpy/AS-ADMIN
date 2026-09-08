import { Package } from 'lucide-react';

export default function ProductoCard({ producto, onClick }) {
  const stockBajo = producto.stock_total <= producto.stock_minimo;

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl bg-surface p-3 text-left shadow-card active:scale-[0.99]"
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-base">
        {producto.foto_url ? (
          <img src={producto.foto_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <Package size={20} className="text-muted" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{producto.nombre}</p>
        <p className="text-xs text-muted">
          Gs. {Number(producto.precio).toLocaleString('es-PY')}
          {producto.tiene_variantes ? ` · ${producto.variantes_count} variantes` : ''}
        </p>
      </div>

      <div className="text-right">
        <p className={`font-mono text-sm ${stockBajo ? 'text-danger' : 'text-ink'}`}>{producto.stock_total}</p>
        <p className="text-[10px] text-muted">en stock</p>
      </div>
    </button>
  );
}
