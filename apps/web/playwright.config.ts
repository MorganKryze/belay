import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // The default html reporter serves the report after a failure and never exits.
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://localhost:4173" },
  projects: [{ name: "chromium", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "pnpm build && pnpm preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    // pnpm runs vite in its own process group: SIGKILL misses it and the run hangs at teardown.
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
  },
});
