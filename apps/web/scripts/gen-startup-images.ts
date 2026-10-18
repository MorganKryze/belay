// Renders the iOS launch images from the real launch screen of the built app, so they match it
// pixel for pixel. Run by hand after a change to the launch screen, the PNGs are committed:
//   pnpm --filter @belay/web build && pnpm exec tsx apps/web/scripts/gen-startup-images.ts
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LAUNCH_BACKGROUND } from "../src/lib/theme";
import { SCREENS, startupFile } from "../startup-images";

const web = resolve(fileURLToPath(import.meta.url), "../..");
const dist = resolve(web, "dist");
const origin = "http://startup.local";
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

const browser = await chromium.launch();
try {
  for (const screen of SCREENS)
    for (const theme of ["light", "dark"] as const) {
      const context = await browser.newContext({
        viewport: { width: screen.width, height: screen.height - screen.top },
        deviceScaleFactor: screen.ratio,
        colorScheme: theme,
        reducedMotion: "reduce",
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      // The account never answers: the launch screen stays for as long as the app waits on it.
      await page.route(`${origin}/api/**`, () => {});
      await page.route(`${origin}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        const file = path === "/" ? "index.html" : path.slice(1);
        try {
          const body = await readFile(resolve(dist, file));
          await route.fulfill({ body, contentType: TYPES[extname(file)] ?? "" });
        } catch {
          await route.fulfill({ status: 404 });
        }
      });
      await page.goto(`${origin}/`);
      await page.evaluate(() => document.fonts.ready);
      // Within the app's 4 s hold on the account, before it gives up and leaves the launch screen.
      await page.locator(".launch").waitFor();
      // iOS keeps vh at the full screen height under the status bar (the 390x844 recording moves
      // by top / 2, not by top / 2 plus 6% of top), so the lift is pinned to it here too.
      await page.addStyleTag({
        content: `.launch > div { transform: translateY(${-0.06 * screen.height}px) }`,
      });
      const shot = await page.screenshot();
      // The full-screen image: the launch screen below a status bar band of its background.
      await page.setViewportSize({ width: screen.width, height: screen.height });
      await page.unroute(`${origin}/**`);
      await page.setContent(
        `<body style="margin:0;background:${LAUNCH_BACKGROUND[theme]}">` +
          `<img style="display:block;margin-top:${screen.top}px;width:${screen.width}px" ` +
          `src="data:image/png;base64,${shot.toString("base64")}">`,
      );
      await page.locator("img").evaluate((img: HTMLImageElement) => img.decode());
      await page.screenshot({ path: resolve(web, "public", startupFile(theme, screen)) });
      await context.close();
    }
} finally {
  await browser.close();
}
