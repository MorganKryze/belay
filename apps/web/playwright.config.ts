import { defineConfig, devices } from "@playwright/test";

// Two checkouts can run their suites side by side, each on its own port.
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "e2e",
  // The default html reporter serves the report after a failure and never exits.
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: `http://localhost:${port}` },
  projects: [{ name: "chromium", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: `pnpm build && pnpm preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    // pnpm runs vite in its own process group: SIGKILL misses it and the run hangs at teardown.
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
  },
});
