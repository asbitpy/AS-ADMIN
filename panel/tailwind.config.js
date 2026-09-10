/**
 * Sistema de tokens de AS ADMIN — panel del dueño
 *
 * Identidad de AS BIT (no la del producto original): fondo azul noche
 * casi negro, celeste eléctrico como acento de acción, morado reservado
 * a propósito para UNA sola acción por pantalla (Cobrar, Entrar,
 * Agregar...), nunca como color repetido. Valores sacados del código
 * real de asbit.com.py — verde/ámbar/rojo de estado también existen ahí
 * (badge-green/amber/red), no son inventados para este panel.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#F8FAFC', // texto principal — casi blanco sobre el fondo oscuro
        base: '#050816', // fondo general
        surface: '#080E2A', // tarjetas
        surface2: '#0A1035', // variante: insets, steppers, filas dentro de una tarjeta
        line: 'rgba(255, 255, 255, 0.08)', // divisores sutiles
        accent: {
          DEFAULT: '#00B8FF', // celeste — acción principal, links, precios
          soft: 'rgba(0, 184, 255, 0.1)',
          hover: '#19C4FF', // hover real de asbit.com.py
          ink: '#040B1E', // texto oscuro para usar SOBRE fondo celeste (blanco no contrasta ahí)
        },
        brand: {
          DEFAULT: '#7F3AEF', // morado — puntual, una sola acción por pantalla
          soft: 'rgba(127, 58, 239, 0.12)',
        },
        amber: {
          DEFAULT: '#fbbf24', // atención / pendiente
          soft: 'rgba(251, 191, 36, 0.1)',
        },
        danger: {
          DEFAULT: '#f87171', // urgente / cancelado / anulado
          soft: 'rgba(248, 113, 113, 0.1)',
        },
        success: {
          DEFAULT: '#4ade80', // confirmado / caja abierta
          soft: 'rgba(74, 222, 128, 0.12)',
        },
        muted: 'rgba(248, 250, 252, 0.55)',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
        // Ya no hay una mono dedicada (antes IBM Plex Mono) — Inter con
        // tabular-nums (ver index.css) alcanza para alinear números.
        mono: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0, 0, 0, 0.2), 0 1px 12px rgba(0, 0, 0, 0.15)',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
    },
  },
  plugins: [],
};
