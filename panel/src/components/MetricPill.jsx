export default function MetricPill({ label, value, tone = 'ink', onClick }) {
  const Component = onClick ? 'button' : 'div';
  const toneClass = { ink: 'text-ink', accent: 'text-accent', amber: 'text-amber', danger: 'text-danger' }[tone];

  return (
    <Component
      onClick={onClick}
      className={`flex-1 rounded-2xl bg-surface px-4 py-3 text-left shadow-card ${
        onClick ? 'active:scale-[0.98] transition-transform' : ''
      }`}
    >
      <div className={`font-display text-2xl font-semibold leading-none ${toneClass}`}>{value}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </Component>
  );
}
