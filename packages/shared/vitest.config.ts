import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Read only by `test:coverage` (CI); `pnpm test` stays uncovered and fast.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text-summary"],
    },
  },
});
