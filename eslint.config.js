import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "**/dist/**",
      "**/dev-dist/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "apps/server/drizzle/**",
      "apps/web/src/components/ui/**",
      "apps/web/public/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  // Non-null assertions after a check the type system cannot follow (first row of an
  // INSERT … RETURNING, the #root element) read better than a runtime guard that never fires.
  { rules: { "@typescript-eslint/no-non-null-assertion": "off" } },
);
