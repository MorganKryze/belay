import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

const backend = "http://localhost:3000";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false, // registered from src/lib/update.ts: the CSP forbids an inline script
      includeAssets: ["favicon.ico", "logo.svg", "apple-touch-icon-180x180.png", "theme-init.js"],
      manifest: {
        name: "Belay",
        short_name: "Belay",
        description: "Fat-loss and training tracker for people who spot each other.",
        start_url: "/",
        display: "standalone",
        background_color: "#0f172a",
        theme_color: "#0f172a",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // No skipWaiting: a new service worker waits, and the app offers a "Reload" button
        // (UpdateBanner) that skips the wait and reloads. Activating it under a live page on its own
        // would let its precache (stale entries are deleted when a worker activates) drop the
        // old lazy chunks (settings-OLD.js) under it; the tap activates it right before the reload.
        clientsClaim: true,
        navigateFallback: "/index.html",
        // /auth, /api and /healthz must always reach the network: a cached shell there would fake
        // a login or a healthy server.
        navigateFallbackDenylist: [/^\/auth\//, /^\/api\//, /^\/healthz$/],
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
      },
    }),
  ],
  // The release tag, stamped by the image build; "dev" everywhere else.
  define: { __BELAY_VERSION__: JSON.stringify(process.env.BELAY_VERSION || "dev") },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Lazy chunks get their own prefix so the bundle budget's index-*.js glob only ever matches
  // the entry: a shared chunk named after some index.js would otherwise be counted as initial.
  build: { rolldownOptions: { output: { chunkFileNames: "assets/chunk-[name]-[hash].js" } } },
  // 127.0.0.1, not localhost: on macOS Vite would bind IPv6 only and IPv4 browsers miss it.
  server: { host: "127.0.0.1", proxy: { "/api": backend, "/auth": backend } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
