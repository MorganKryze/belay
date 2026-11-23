import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Read only by `test:coverage` (CI); `pnpm test` stays uncovered and fast.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text-summary"],
      // Floors measured in CI, rounded down: raise them as coverage grows, never lower them to pass.
      thresholds: { statements: 98, branches: 96, functions: 99, lines: 99 },
    },
  },
});
