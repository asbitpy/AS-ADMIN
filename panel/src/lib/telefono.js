// Los teléfonos llegan escritos de muchas formas ("0981 123 456",
// "+595 981 123456", "595981123456"): el bot los guarda como
// 595981123456 (así los manda WhatsApp) y en el panel se tipean con 0.
// Sin normalizar, la misma persona termina duplicada y el link wa.me
// queda roto.

/** Deja solo dígitos y con código de país de Paraguay: 595981123456. */
export function normalizarTelefono(raw) {
  const digitos = String(raw || '').replace(/\D/g, '');
  if (!digitos) return '';
  if (digitos.startsWith('595')) return digitos;
  if (digitos.startsWith('0')) return `595${digitos.slice(1)}`;
  if (digitos.length === 9 && digitos.startsWith('9')) return `595${digitos}`;
  return digitos;
}

/** Todas las formas en que ese mismo número pudo quedar guardado. */
export function variantesTelefono(raw) {
  const original = String(raw || '').trim();
  const normal = normalizarTelefono(original);
  if (!normal) return [];
  const local = normal.startsWith('595') ? `0${normal.slice(3)}` : normal;
  return [...new Set([original, normal, local, `+${normal}`])];
}
