import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [
    svelte({ compilerOptions: { hmr: !process.env.VITEST } }),
    // Resolves Svelte to its client build under Vitest so component tests
    // (@testing-library/svelte) can mount. Test-only; no effect on the build.
    svelteTesting(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'pwa-512-maskable.png',
      ],
      manifest: {
        id: '/',
        name: '/kalendes',
        short_name: 'kalendes',
        description: 'A timeline view for your iCal feeds.',
        // Black install-splash to match the black-plate app icon (favicon.svg is
        // <rect fill="#000">). App.svelte swaps the live theme-color to the
        // active flavor's --paper once mounted; this only governs the pre-JS
        // launch moment.
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        lang: 'en',
        categories: ['productivity', 'utilities'],
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
        shortcuts: [
          { name: 'Month view', short_name: 'Month', url: '/?z=1m' },
          { name: 'Year view', short_name: 'Year', url: '/?z=1y' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico,webmanifest}'],
        // Drop precaches left by a previous service-worker version so a new
        // deploy can't serve a stale mix of old + new shell assets.
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /\/api\/ics(\?.*)?$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'ics-feeds',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 24 * 60 * 60,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_HOMEPAGE__: JSON.stringify('https://heracl.es/kalendes'),
  },
  build: {
    // Emit source maps so production stack traces (e.g. Svelte runtime errors)
    // map back to the real source in the browser devtools.
    sourcemap: true,
    rollupOptions: {
      output: {
        // Keep the heavy parser/search libs in their own chunks (loaded on
        // demand via the ICS worker / lazy search) and shared between the
        // worker and the main-thread fallback rather than duplicated.
        manualChunks: {
          ical: ['ical.js', 'ical-expander'],
          fuse: ['fuse.js'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
  server: {
    port: 5173,
  },
});
