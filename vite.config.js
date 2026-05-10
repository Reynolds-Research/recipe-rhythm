import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',

      // Risk-aware fallback: if the service worker causes test failures or build
      // errors, change `injectRegister` to null and add `selfDestroying: true` here
      // for manifest-only mode (install prompt + icons still work, offline doesn't).

      manifest: {
        name: 'For My Wife',
        short_name: 'For My Wife',
        description: 'A meal-planning and recipe app, made with love.',
        theme_color: '#D74520',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: '/icons/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icons/pwa-512x512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        navigateFallback: '/index.html',
        runtimeCaching: [
          // NetworkFirst for HTML navigation so new builds reach users promptly.
          {
            urlPattern: ({ request }) => request.destination === 'document',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'documents',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 5, maxAgeSeconds: 60 },
            },
          },
          // NetworkFirst for API GET requests with a short TTL.
          // Non-GET methods are not intercepted (workbox only handles GET by default).
          // Supabase auth and realtime URLs are explicitly excluded.
          {
            urlPattern: ({ request, url }) =>
              request.method === 'GET' &&
              url.pathname.startsWith('/api/') &&
              !url.href.includes('auth/v1') &&
              !url.href.includes('realtime'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
    include: ['src/**/*.test.js', 'src/**/*.test.jsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      exclude: [
        '**/*.test.{js,jsx,ts,tsx}',
        '**/*.config.{js,ts}',
        'dist/',
        'node_modules/',
        'coverage/',
      ],
      // Target thresholds (warn-only while exploring; not enforced yet):
      //   lines: 70, statements: 70, functions: 60, branches: 60
      // To enforce, move these into a `thresholds: { ... }` block.
    },
  },
})
