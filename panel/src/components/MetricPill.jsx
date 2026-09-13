export default function MetricPill({ label, value, tone = 'ink', onClick, compact = false }) {
  const Component = onClick ? 'button' : 'div';
  // El número siempre en 'ink' (blanco): un celeste saturado sobre un
  // fondo tan oscuro pasa el contraste "en el papel" pero el ojo lo
  // percibe turbio — mala idea para un número que hay que leer de un
  // vistazo. El color de marca queda en la etiqueta de abajo, que no
  // necesita esa misma legibilidad inmediata. 'danger' es la excepción:
  // un rojo/coral cálido sí se lee bien incluso saturado.
  const valorToneClass = tone === 'danger' ? 'text-danger' : 'text-ink';
  const labelToneClass = { ink: 'text-muted', accent: 'text-accent', amber: 'text-amber', danger: 'text-danger' }[tone];
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
      <div className={`truncate font-display font-semibold leading-none ${tamano} ${valorToneClass}`}>{value}</div>
      <div className={`mt-1 text-xs ${labelToneClass}`}>{label}</div>
    </Component>
  );
}
