/**
 * Sistema de tokens de AS ADMIN — panel del dueño
 *
 * Paleta pensada para un consultorio/salón chico, no para un dashboard
 * corporativo: base en verde salvia pálido (calma, salud), acento en
 * verde bosque (acción/confianza), ámbar cálido para "necesita atención"
 * y un rojo ladrillo apagado para lo urgente/cancelado. Nada de
 * crema+terracota ni de negro+neón — se aleja a propósito de esos defaults.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#14213D', // texto principal — azul noche, transmite confianza clínica
        base: '#F1F4F1', // fondo general — verde salvia muy pálido
        surface: '#FFFFFF', // tarjetas sobre el fondo
        line: '#E1E6E1', // divisores sutiles
        accent: {
          DEFAULT: '#2D6A4F', // verde bosque — acción principal, confirmado
          soft: '#E4F0EA',
        },
        amber: {
          DEFAULT: '#DC8A3B', // atención / pendiente
          soft: '#FBEEDD',
        },
        danger: {
          DEFAULT: '#C2483D', // urgente / cancelado
          soft: '#F7E6E4',
        },
        muted: '#6B7280',
      },
      fontFamily: {
        display: ['"Fraunces"', 'serif'],
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(20, 33, 61, 0.06), 0 1px 12px rgba(20, 33, 61, 0.04)',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
    },
  },
  plugins: [],
};
