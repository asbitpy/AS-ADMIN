import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Solo precachea el "app shell" (JS/CSS/HTML/íconos) para que abra
      // instalado al toque — a propósito NO cachea datos de Supabase ni
      // del backend, porque en un panel de ventas/agenda mostrar datos
      // viejos sin avisar es peor que no tener nada offline.
      manifest: {
        name: 'AS ADMIN',
        short_name: 'AS ADMIN',
        description: 'Panel de agenda y ventas por WhatsApp',
        lang: 'es-PY',
        start_url: '/',
        display: 'standalone',
        background_color: '#050816',
        theme_color: '#050816',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { port: 5173 },
});
