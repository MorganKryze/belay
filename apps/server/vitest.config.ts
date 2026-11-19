import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    hookTimeout: 120_000,
    // Database-backed tests run against Testcontainers; on a busy machine the 5 s default is too tight.
    testTimeout: 15_000,
    // Read only by `test:coverage` (CI); `pnpm test` stays uncovered and fast.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text-summary"],
      // Floors measured in CI, rounded down: raise them as coverage grows, never lower them to pass.
      thresholds: { statements: 95, branches: 94, functions: 91, lines: 96 },
    },
  },
});
