import { Trash2 } from 'lucide-react';

export default function VarianteRow({ variante, onChange, onQuitar, soloStock = false }) {
  function set(campo, valor) {
    onChange({ ...variante, [campo]: valor });
  }

  if (soloStock) {
    // Variante ya guardada: solo se puede ajustar el stock (evita romper
    // el historial de ventas si esa variante ya se vendió alguna vez).
    return (
      <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
        <div className="text-sm text-ink">
          {variante.atributo1_valor}
          {variante.atributo2_valor ? ` · ${variante.atributo2_valor}` : ''}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={variante.stock}
            onChange={(e) => set('stock', e.target.value)}
            className="w-16 rounded-lg border border-line px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <button type="button" onClick={onQuitar} className="text-muted active:text-danger">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[1fr_1fr_70px_auto] gap-2">
      <input
        placeholder="Talle (M)"
        value={variante.talle}
        onChange={(e) => set('talle', e.target.value)}
        className="rounded-lg border border-line px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
      />
      <input
        placeholder="Color"
        value={variante.color}
        onChange={(e) => set('color', e.target.value)}
        className="rounded-lg border border-line px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
      />
      <input
        type="number"
        placeholder="Stock"
        value={variante.stock}
        onChange={(e) => set('stock', e.target.value)}
        className="rounded-lg border border-line px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
      />
      <button type="button" onClick={onQuitar} className="text-muted active:text-danger">
        <Trash2 size={16} />
      </button>
    </div>
  );
}
