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
      registerType: "autoUpdate",
      injectRegister: "script", // external registerSW.js: the CSP forbids inline scripts
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
        // ponytail: no skipWaiting, so a new SW waits and an update applies on the next full close
        // and relaunch, with no in-app "new version" prompt. Claiming a live page would let
        // cleanupOutdatedCaches delete the old lazy chunks (settings-OLD.js) under it. With
        // injectRegister "script" nothing reloads the page, so registerType "autoUpdate" is nominal
        // here. Upgrade path: import virtual:pwa-register, handle onNeedRefresh, show a prompt.
        clientsClaim: true,
        navigateFallback: "/index.html",
        // /auth, /api and /healthz must always reach the network: a cached shell there would fake
        // a login or a healthy server.
        navigateFallbackDenylist: [/^\/auth\//, /^\/api\//, /^\/healthz$/],
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
      },
    }),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { proxy: { "/api": backend, "/auth": backend } },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
});
