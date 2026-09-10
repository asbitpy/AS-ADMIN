export default function SelectorVariante({ producto, onElegir, onCerrar }) {
  const variantes = (producto.variantes_producto || []).filter((v) => v.activo && v.stock > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onCerrar}>
      <div
        className="mx-auto w-full max-w-md rounded-t-2xl bg-surface p-4 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-sm font-medium text-ink">{producto.nombre} — elegí la variante</p>

        {variantes.length === 0 && <p className="text-sm text-muted">Sin stock disponible en ninguna variante.</p>}

        <div className="max-h-72 space-y-2 overflow-y-auto">
          {variantes.map((v) => (
            <button
              key={v.id}
              onClick={() => onElegir(v)}
              className="flex w-full items-center justify-between rounded-xl bg-base px-4 py-3 text-left active:scale-[0.99]"
            >
              <span className="text-sm text-ink">
                {v.atributo1_valor}
                {v.atributo2_valor ? ` · ${v.atributo2_valor}` : ''}
              </span>
              <span className="font-mono text-xs text-muted">{v.stock} en stock</span>
            </button>
          ))}
        </div>

        <button onClick={onCerrar} className="mt-3 w-full py-2 text-center text-sm text-muted">
          Cancelar
        </button>
      </div>
    </div>
  );
}
