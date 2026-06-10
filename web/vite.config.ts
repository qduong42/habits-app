import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Hand-written SW (src/sw.ts): the same app-shell precaching the old
      // generateSW config produced PLUS push/notificationclick handlers for
      // the daily nudge — generateSW can't carry custom handlers and one
      // scope allows only one service worker.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      manifest: {
        name: 'Habits',
        short_name: 'Habits',
        description: 'Gamified habit tracker',
        display: 'standalone',
        theme_color: '#5e35b1',
        background_color: '#fafafa',
        start_url: '/',
        icons: [
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // The /api network-only rule (navigateFallbackDenylist equivalent)
      // lives in src/sw.ts now: NavigationRoute denylist + no runtime caching.
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
