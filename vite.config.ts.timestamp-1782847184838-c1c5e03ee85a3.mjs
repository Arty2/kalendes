// vite.config.ts
import { defineConfig } from "file:///home/user/almanacs/node_modules/vitest/dist/config.js";
import { svelte } from "file:///home/user/almanacs/node_modules/@sveltejs/vite-plugin-svelte/src/index.js";
import { svelteTesting } from "file:///home/user/almanacs/node_modules/@testing-library/svelte/src/vite.js";
import { VitePWA } from "file:///home/user/almanacs/node_modules/vite-plugin-pwa/dist/index.js";

// package.json
var package_default = {
  name: "calendar-timeline",
  private: true,
  version: "0.0.37",
  type: "module",
  engines: {
    node: "20.x"
  },
  scripts: {
    dev: "vite",
    build: "vite build",
    preview: "vite preview",
    test: "vitest",
    "test:watch": "vitest --watch",
    typecheck: "svelte-check --tsconfig ./tsconfig.json",
    icons: "node scripts/generate-icons.mjs"
  },
  dependencies: {
    "fuse.js": "^7.0.0",
    "ical-expander": "^3.1.0",
    "ical.js": "^2.0.1"
  },
  devDependencies: {
    "@sveltejs/vite-plugin-svelte": "^4.0.0",
    "@testing-library/svelte": "^5.2.4",
    "@tsconfig/svelte": "^5.0.4",
    "@vercel/node": "^3.2.0",
    jsdom: "^25.0.1",
    svelte: "^5.1.0",
    "svelte-check": "^4.0.5",
    typescript: "^5.6.3",
    vite: "^5.4.10",
    "vite-plugin-pwa": "^1.3.0",
    vitest: "^2.1.4"
  }
};

// vite.config.ts
var vite_config_default = defineConfig({
  plugins: [
    svelte({ compilerOptions: { hmr: !process.env.VITEST } }),
    // Resolves Svelte to its client build under Vitest so component tests
    // (@testing-library/svelte) can mount. Test-only; no effect on the build.
    svelteTesting(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.svg",
        "apple-touch-icon.png",
        "pwa-192x192.png",
        "pwa-512x512.png",
        "pwa-512-maskable.png"
      ],
      manifest: {
        id: "/",
        name: "/almanacs",
        short_name: "almanacs",
        description: "A timeline view for your iCal feeds.",
        theme_color: "#ffffff",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        scope: "/",
        lang: "en",
        categories: ["productivity", "utilities"],
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "/pwa-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          },
          {
            src: "/favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any"
          }
        ],
        shortcuts: [
          { name: "Month view", short_name: "Month", url: "/?z=1m" },
          { name: "Year view", short_name: "Year", url: "/?z=1y" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,ico,webmanifest}"],
        runtimeCaching: [
          {
            urlPattern: /\/api\/ics(\?.*)?$/,
            handler: "NetworkFirst",
            options: {
              cacheName: "ics-feeds",
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 24 * 60 * 60
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  define: {
    __APP_VERSION__: JSON.stringify(package_default.version),
    __APP_HOMEPAGE__: JSON.stringify("https://heracl.es/almanacs")
  },
  build: {
    rollupOptions: {
      output: {
        // Keep the heavy parser/search libs in their own chunks (loaded on
        // demand via the ICS worker / lazy search) and shared between the
        // worker and the main-thread fallback rather than duplicated.
        manualChunks: {
          ical: ["ical.js", "ical-expander"],
          fuse: ["fuse.js"]
        }
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"]
  },
  server: {
    port: 5173
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiLCAicGFja2FnZS5qc29uIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiL2hvbWUvdXNlci9hbG1hbmFjc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL2hvbWUvdXNlci9hbG1hbmFjcy92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vaG9tZS91c2VyL2FsbWFuYWNzL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZXN0L2NvbmZpZyc7XG5pbXBvcnQgeyBzdmVsdGUgfSBmcm9tICdAc3ZlbHRlanMvdml0ZS1wbHVnaW4tc3ZlbHRlJztcbmltcG9ydCB7IHN2ZWx0ZVRlc3RpbmcgfSBmcm9tICdAdGVzdGluZy1saWJyYXJ5L3N2ZWx0ZS92aXRlJztcbmltcG9ydCB7IFZpdGVQV0EgfSBmcm9tICd2aXRlLXBsdWdpbi1wd2EnO1xuaW1wb3J0IHBrZyBmcm9tICcuL3BhY2thZ2UuanNvbicgd2l0aCB7IHR5cGU6ICdqc29uJyB9O1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbXG4gICAgc3ZlbHRlKHsgY29tcGlsZXJPcHRpb25zOiB7IGhtcjogIXByb2Nlc3MuZW52LlZJVEVTVCB9IH0pLFxuICAgIC8vIFJlc29sdmVzIFN2ZWx0ZSB0byBpdHMgY2xpZW50IGJ1aWxkIHVuZGVyIFZpdGVzdCBzbyBjb21wb25lbnQgdGVzdHNcbiAgICAvLyAoQHRlc3RpbmctbGlicmFyeS9zdmVsdGUpIGNhbiBtb3VudC4gVGVzdC1vbmx5OyBubyBlZmZlY3Qgb24gdGhlIGJ1aWxkLlxuICAgIHN2ZWx0ZVRlc3RpbmcoKSxcbiAgICBWaXRlUFdBKHtcbiAgICAgIHJlZ2lzdGVyVHlwZTogJ2F1dG9VcGRhdGUnLFxuICAgICAgaW5jbHVkZUFzc2V0czogW1xuICAgICAgICAnZmF2aWNvbi5zdmcnLFxuICAgICAgICAnYXBwbGUtdG91Y2gtaWNvbi5wbmcnLFxuICAgICAgICAncHdhLTE5MngxOTIucG5nJyxcbiAgICAgICAgJ3B3YS01MTJ4NTEyLnBuZycsXG4gICAgICAgICdwd2EtNTEyLW1hc2thYmxlLnBuZycsXG4gICAgICBdLFxuICAgICAgbWFuaWZlc3Q6IHtcbiAgICAgICAgaWQ6ICcvJyxcbiAgICAgICAgbmFtZTogJy9hbG1hbmFjcycsXG4gICAgICAgIHNob3J0X25hbWU6ICdhbG1hbmFjcycsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnQSB0aW1lbGluZSB2aWV3IGZvciB5b3VyIGlDYWwgZmVlZHMuJyxcbiAgICAgICAgdGhlbWVfY29sb3I6ICcjZmZmZmZmJyxcbiAgICAgICAgYmFja2dyb3VuZF9jb2xvcjogJyNmZmZmZmYnLFxuICAgICAgICBkaXNwbGF5OiAnc3RhbmRhbG9uZScsXG4gICAgICAgIG9yaWVudGF0aW9uOiAnYW55JyxcbiAgICAgICAgc3RhcnRfdXJsOiAnLycsXG4gICAgICAgIHNjb3BlOiAnLycsXG4gICAgICAgIGxhbmc6ICdlbicsXG4gICAgICAgIGNhdGVnb3JpZXM6IFsncHJvZHVjdGl2aXR5JywgJ3V0aWxpdGllcyddLFxuICAgICAgICBpY29uczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIHNyYzogJy9wd2EtMTkyeDE5Mi5wbmcnLFxuICAgICAgICAgICAgc2l6ZXM6ICcxOTJ4MTkyJyxcbiAgICAgICAgICAgIHR5cGU6ICdpbWFnZS9wbmcnLFxuICAgICAgICAgICAgcHVycG9zZTogJ2FueScsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBzcmM6ICcvcHdhLTUxMng1MTIucG5nJyxcbiAgICAgICAgICAgIHNpemVzOiAnNTEyeDUxMicsXG4gICAgICAgICAgICB0eXBlOiAnaW1hZ2UvcG5nJyxcbiAgICAgICAgICAgIHB1cnBvc2U6ICdhbnknLFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgc3JjOiAnL3B3YS01MTItbWFza2FibGUucG5nJyxcbiAgICAgICAgICAgIHNpemVzOiAnNTEyeDUxMicsXG4gICAgICAgICAgICB0eXBlOiAnaW1hZ2UvcG5nJyxcbiAgICAgICAgICAgIHB1cnBvc2U6ICdtYXNrYWJsZScsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBzcmM6ICcvZmF2aWNvbi5zdmcnLFxuICAgICAgICAgICAgc2l6ZXM6ICdhbnknLFxuICAgICAgICAgICAgdHlwZTogJ2ltYWdlL3N2Zyt4bWwnLFxuICAgICAgICAgICAgcHVycG9zZTogJ2FueScsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgICAgc2hvcnRjdXRzOiBbXG4gICAgICAgICAgeyBuYW1lOiAnTW9udGggdmlldycsIHNob3J0X25hbWU6ICdNb250aCcsIHVybDogJy8/ej0xbScgfSxcbiAgICAgICAgICB7IG5hbWU6ICdZZWFyIHZpZXcnLCBzaG9ydF9uYW1lOiAnWWVhcicsIHVybDogJy8/ej0xeScgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgICB3b3JrYm94OiB7XG4gICAgICAgIGdsb2JQYXR0ZXJuczogWycqKi8qLntqcyxjc3MsaHRtbCxzdmcsaWNvLHdlYm1hbmlmZXN0fSddLFxuICAgICAgICBydW50aW1lQ2FjaGluZzogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIHVybFBhdHRlcm46IC9cXC9hcGlcXC9pY3MoXFw/LiopPyQvLFxuICAgICAgICAgICAgaGFuZGxlcjogJ05ldHdvcmtGaXJzdCcsXG4gICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgIGNhY2hlTmFtZTogJ2ljcy1mZWVkcycsXG4gICAgICAgICAgICAgIG5ldHdvcmtUaW1lb3V0U2Vjb25kczogNSxcbiAgICAgICAgICAgICAgZXhwaXJhdGlvbjoge1xuICAgICAgICAgICAgICAgIG1heEVudHJpZXM6IDUwLFxuICAgICAgICAgICAgICAgIG1heEFnZVNlY29uZHM6IDI0ICogNjAgKiA2MCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgY2FjaGVhYmxlUmVzcG9uc2U6IHtcbiAgICAgICAgICAgICAgICBzdGF0dXNlczogWzAsIDIwMF0sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH0pLFxuICBdLFxuICBkZWZpbmU6IHtcbiAgICBfX0FQUF9WRVJTSU9OX186IEpTT04uc3RyaW5naWZ5KHBrZy52ZXJzaW9uKSxcbiAgICBfX0FQUF9IT01FUEFHRV9fOiBKU09OLnN0cmluZ2lmeSgnaHR0cHM6Ly9oZXJhY2wuZXMvYWxtYW5hY3MnKSxcbiAgfSxcbiAgYnVpbGQ6IHtcbiAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICBvdXRwdXQ6IHtcbiAgICAgICAgLy8gS2VlcCB0aGUgaGVhdnkgcGFyc2VyL3NlYXJjaCBsaWJzIGluIHRoZWlyIG93biBjaHVua3MgKGxvYWRlZCBvblxuICAgICAgICAvLyBkZW1hbmQgdmlhIHRoZSBJQ1Mgd29ya2VyIC8gbGF6eSBzZWFyY2gpIGFuZCBzaGFyZWQgYmV0d2VlbiB0aGVcbiAgICAgICAgLy8gd29ya2VyIGFuZCB0aGUgbWFpbi10aHJlYWQgZmFsbGJhY2sgcmF0aGVyIHRoYW4gZHVwbGljYXRlZC5cbiAgICAgICAgbWFudWFsQ2h1bmtzOiB7XG4gICAgICAgICAgaWNhbDogWydpY2FsLmpzJywgJ2ljYWwtZXhwYW5kZXInXSxcbiAgICAgICAgICBmdXNlOiBbJ2Z1c2UuanMnXSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgdGVzdDoge1xuICAgIGVudmlyb25tZW50OiAnanNkb20nLFxuICAgIGdsb2JhbHM6IHRydWUsXG4gICAgc2V0dXBGaWxlczogWycuL3Rlc3RzL3NldHVwLnRzJ10sXG4gIH0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDUxNzMsXG4gIH0sXG59KTtcbiIsICJ7XG4gIFwibmFtZVwiOiBcImNhbGVuZGFyLXRpbWVsaW5lXCIsXG4gIFwicHJpdmF0ZVwiOiB0cnVlLFxuICBcInZlcnNpb25cIjogXCIwLjAuMzdcIixcbiAgXCJ0eXBlXCI6IFwibW9kdWxlXCIsXG4gIFwiZW5naW5lc1wiOiB7XG4gICAgXCJub2RlXCI6IFwiMjAueFwiXG4gIH0sXG4gIFwic2NyaXB0c1wiOiB7XG4gICAgXCJkZXZcIjogXCJ2aXRlXCIsXG4gICAgXCJidWlsZFwiOiBcInZpdGUgYnVpbGRcIixcbiAgICBcInByZXZpZXdcIjogXCJ2aXRlIHByZXZpZXdcIixcbiAgICBcInRlc3RcIjogXCJ2aXRlc3RcIixcbiAgICBcInRlc3Q6d2F0Y2hcIjogXCJ2aXRlc3QgLS13YXRjaFwiLFxuICAgIFwidHlwZWNoZWNrXCI6IFwic3ZlbHRlLWNoZWNrIC0tdHNjb25maWcgLi90c2NvbmZpZy5qc29uXCIsXG4gICAgXCJpY29uc1wiOiBcIm5vZGUgc2NyaXB0cy9nZW5lcmF0ZS1pY29ucy5tanNcIlxuICB9LFxuICBcImRlcGVuZGVuY2llc1wiOiB7XG4gICAgXCJmdXNlLmpzXCI6IFwiXjcuMC4wXCIsXG4gICAgXCJpY2FsLWV4cGFuZGVyXCI6IFwiXjMuMS4wXCIsXG4gICAgXCJpY2FsLmpzXCI6IFwiXjIuMC4xXCJcbiAgfSxcbiAgXCJkZXZEZXBlbmRlbmNpZXNcIjoge1xuICAgIFwiQHN2ZWx0ZWpzL3ZpdGUtcGx1Z2luLXN2ZWx0ZVwiOiBcIl40LjAuMFwiLFxuICAgIFwiQHRlc3RpbmctbGlicmFyeS9zdmVsdGVcIjogXCJeNS4yLjRcIixcbiAgICBcIkB0c2NvbmZpZy9zdmVsdGVcIjogXCJeNS4wLjRcIixcbiAgICBcIkB2ZXJjZWwvbm9kZVwiOiBcIl4zLjIuMFwiLFxuICAgIFwianNkb21cIjogXCJeMjUuMC4xXCIsXG4gICAgXCJzdmVsdGVcIjogXCJeNS4xLjBcIixcbiAgICBcInN2ZWx0ZS1jaGVja1wiOiBcIl40LjAuNVwiLFxuICAgIFwidHlwZXNjcmlwdFwiOiBcIl41LjYuM1wiLFxuICAgIFwidml0ZVwiOiBcIl41LjQuMTBcIixcbiAgICBcInZpdGUtcGx1Z2luLXB3YVwiOiBcIl4xLjMuMFwiLFxuICAgIFwidml0ZXN0XCI6IFwiXjIuMS40XCJcbiAgfVxufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUEyTyxTQUFTLG9CQUFvQjtBQUN4USxTQUFTLGNBQWM7QUFDdkIsU0FBUyxxQkFBcUI7QUFDOUIsU0FBUyxlQUFlOzs7QUNIeEI7QUFBQSxFQUNFLE1BQVE7QUFBQSxFQUNSLFNBQVc7QUFBQSxFQUNYLFNBQVc7QUFBQSxFQUNYLE1BQVE7QUFBQSxFQUNSLFNBQVc7QUFBQSxJQUNULE1BQVE7QUFBQSxFQUNWO0FBQUEsRUFDQSxTQUFXO0FBQUEsSUFDVCxLQUFPO0FBQUEsSUFDUCxPQUFTO0FBQUEsSUFDVCxTQUFXO0FBQUEsSUFDWCxNQUFRO0FBQUEsSUFDUixjQUFjO0FBQUEsSUFDZCxXQUFhO0FBQUEsSUFDYixPQUFTO0FBQUEsRUFDWDtBQUFBLEVBQ0EsY0FBZ0I7QUFBQSxJQUNkLFdBQVc7QUFBQSxJQUNYLGlCQUFpQjtBQUFBLElBQ2pCLFdBQVc7QUFBQSxFQUNiO0FBQUEsRUFDQSxpQkFBbUI7QUFBQSxJQUNqQixnQ0FBZ0M7QUFBQSxJQUNoQywyQkFBMkI7QUFBQSxJQUMzQixvQkFBb0I7QUFBQSxJQUNwQixnQkFBZ0I7QUFBQSxJQUNoQixPQUFTO0FBQUEsSUFDVCxRQUFVO0FBQUEsSUFDVixnQkFBZ0I7QUFBQSxJQUNoQixZQUFjO0FBQUEsSUFDZCxNQUFRO0FBQUEsSUFDUixtQkFBbUI7QUFBQSxJQUNuQixRQUFVO0FBQUEsRUFDWjtBQUNGOzs7QUQ3QkEsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUztBQUFBLElBQ1AsT0FBTyxFQUFFLGlCQUFpQixFQUFFLEtBQUssQ0FBQyxRQUFRLElBQUksT0FB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
