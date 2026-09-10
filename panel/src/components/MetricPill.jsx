export default function MetricPill({ label, value, tone = 'ink', onClick, compact = false }) {
  const Component = onClick ? 'button' : 'div';
  const toneClass = { ink: 'text-ink', accent: 'text-accent', amber: 'text-amber', danger: 'text-danger' }[tone];
  // Un monto en guaraníes ("Gs. 3.450.000") no entra a tamaño 2xl en un
  // tercio de columna angosto — 'compact' lo achica para que no se corte.
  const tamano = compact ? 'text-base' : 'text-2xl';

  return (
    <Component
      onClick={onClick}
      className={`min-w-0 flex-1 rounded-2xl bg-surface px-4 py-3 text-left shadow-card ${
        onClick ? 'active:scale-[0.98] transition-transform' : ''
      }`}
    >
      <div className={`truncate font-display font-semibold leading-none ${tamano} ${toneClass}`}>{value}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </Component>
  );
}
