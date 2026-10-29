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
      // The Xcode project holds a copy of the built web app and Swift package checkouts.
      "apps/mobile/ios/**",
      // The Gradle project holds a copy of the built web app and Gradle output.
      "apps/mobile/android/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  // Non-null assertions after a check the type system cannot follow (first row of an
  // INSERT … RETURNING, the #root element) read better than a runtime guard that never fires.
  { rules: { "@typescript-eslint/no-non-null-assertion": "off" } },
  // cn is the project's wrapper (it knows the --text-* steps); the bare package would drop them.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/lib/utils.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "cn", message: "use cn from @/lib/utils" }] },
      ],
    },
  },
);
