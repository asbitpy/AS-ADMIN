// Color de acento del panel, elegible por negocio (Configuración →
// Apariencia). A propósito NO es un selector de color libre: cada
// opción ya trae su propio tono de hover y su color de texto pensado
// para leerse bien encima — la lección de MetricPill fue que un color
// "matemáticamente válido" puede igual verse turbio si no se elige con
// cuidado, así que acá se cuida antes de mostrarlo, no después.
export const PALETA_ACCENT = [
  { id: 'celeste', nombre: 'Celeste', rgb: '0 184 255', hover: '#19C4FF', ink: '#040B1E' },
  { id: 'turquesa', nombre: 'Turquesa', rgb: '45 212 191', hover: '#5EEAD4', ink: '#042F2A' },
  { id: 'indigo', nombre: 'Índigo', rgb: '129 140 248', hover: '#A5B4FC', ink: '#1E1B4B' },
  { id: 'violeta', nombre: 'Violeta', rgb: '192 132 252', hover: '#D8B4FE', ink: '#2E1065' },
  { id: 'rosa', nombre: 'Rosa', rgb: '244 114 182', hover: '#F9A8D4', ink: '#500724' },
];

export const ACCENT_POR_DEFECTO = 'celeste';

export function obtenerAccent(id) {
  return PALETA_ACCENT.find((c) => c.id === id) || PALETA_ACCENT[0];
}

// Pisa las variables CSS que lee tailwind.config.js — bg-accent,
// text-accent-ink, bg-accent-soft, etc. siguen siendo las mismas clases
// en todo el panel, solo cambia el valor detrás.
export function aplicarAccent(id) {
  const c = obtenerAccent(id);
  const raiz = document.documentElement.style;
  raiz.setProperty('--accent-rgb', c.rgb);
  raiz.setProperty('--accent-soft', `rgba(${c.rgb.split(' ').join(', ')}, 0.1)`);
  raiz.setProperty('--accent-hover', c.hover);
  raiz.setProperty('--accent-ink', c.ink);
}
