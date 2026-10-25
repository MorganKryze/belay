import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";
import { contentSecurityPolicy } from "./content-security-policy";
import { mediaRuntimeCaching } from "./src/lib/media-cache";
import { SCREENS, startupFile, startupMedia } from "./startup-images";

const backend = "http://localhost:3000";

// iOS ignores the manifest's splash: it wants one link per exact screen and scheme, and only
// uses them once the page declares itself web-app capable.
const startupImages: Plugin = {
  name: "startup-images",
  transformIndexHtml: () => [
    {
      tag: "meta",
      attrs: { name: "apple-mobile-web-app-capable", content: "yes" },
      injectTo: "head",
    },
    ...SCREENS.flatMap((screen) =>
      (["light", "dark"] as const).map((theme) => ({
        tag: "link",
        attrs: {
          rel: "apple-touch-startup-image",
          href: `/${startupFile(theme, screen)}`,
          media: startupMedia(theme, screen),
        },
        injectTo: "head" as const,
      })),
    ),
  ],
};

export default defineConfig({
  plugins: [
    react(),
    startupImages,
    contentSecurityPolicy(process.env.BELAY_LOOPBACK === "1"),
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
        background_color: "#FAFAF7",
        theme_color: "#FAFAF7",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-512x512.png",
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
        // a login or a healthy server. A loop opened on its own is a video, never the shell.
        navigateFallbackDenylist: [/^\/auth\//, /^\/api\//, /^\/healthz$/, /^\/media\//],
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // 22 full-screen PNGs, one of which a phone ever reads, and only at install.
        globIgnores: ["startup/**"],
        // Exercise loops are kept once seen, in a capped cache of their own.
        runtimeCaching: [mediaRuntimeCaching],
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
  server: { host: "127.0.0.1", proxy: { "/api": backend, "/auth": backend, "/media": backend } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    // Route tests render the whole app in jsdom; on a busy machine the 5 s default is too tight.
    testTimeout: 15_000,
  },
});
