import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    hookTimeout: 120_000,
    // Database-backed tests run against Testcontainers; on a busy machine the 5 s default is too tight.
    testTimeout: 15_000,
  },
});
