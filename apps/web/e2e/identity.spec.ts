import { expect, test } from "@playwright/test";
import { fakeServer } from "./fake-server";

// The mark's geometry, as the icons have always drawn it: only colours and grounds change.
const MARK =
  "M86 160L86 266A120 120 0 0 0 326 266L326 246A20 20 0 0 0 286 246L286 266A80 80 0 0 1 126 266L126 160A20 20 0 0 0 86 160ZM426 352L426 246A120 120 0 0 0 186 246L186 266A20 20 0 0 0 226 266L226 246A80 80 0 0 1 386 246L386 352A20 20 0 0 0 426 352Z";

test("the page declares 22 launch images, half of them dark, and lets iOS use them", async ({
  page,
}) => {
  await fakeServer(page);
  await page.goto("/");
  const links = page.locator('link[rel="apple-touch-startup-image"]');
  await expect(links).toHaveCount(22);
  await expect(page.locator('link[rel="apple-touch-startup-image"][media*="dark"]')).toHaveCount(
    11,
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
    "content",
    "yes",
  );
  const first = await links.first().getAttribute("href");
  expect((await page.request.get(first!)).headers()["content-type"]).toBe("image/png");
});

test("the launch images stay out of the offline precache", async ({ page }) => {
  const sw = await (await page.request.get("/sw.js")).text();
  expect(sw).toContain("index.html");
  expect(sw).not.toContain("startup/");
});

test.describe("on a light phone", () => {
  test.use({ colorScheme: "light" });

  test("a dark theme chosen on a light phone colours the browser bar dark from the first paint", async ({
    page,
  }) => {
    await fakeServer(page);
    await page.addInitScript(() => {
      localStorage.setItem("belay.theme", "dark");
      document.addEventListener("DOMContentLoaded", () => {
        (window as unknown as { barAtLoad: string | null }).barAtLoad = document
          .querySelector('meta[name="theme-color"][media*="light"]')!
          .getAttribute("content");
      });
    });
    await page.goto("/");
    await page.waitForFunction(() => "barAtLoad" in window);
    expect(await page.evaluate(() => (window as unknown as { barAtLoad: string }).barAtLoad)).toBe(
      "#10151A",
    );
  });
});

test("the browser bar is paper in light and dark paper in dark before any script runs", async ({
  request,
}) => {
  const html = await (await request.get("/")).text();
  expect(html).toMatch(
    /<meta name="theme-color" content="#F3F5F5" media="\(prefers-color-scheme: light\)"/,
  );
  expect(html).toMatch(
    /<meta name="theme-color" content="#10151A" media="\(prefers-color-scheme: dark\)"/,
  );
});

test("the favicon is the mark alone, blue in light and light blue in dark", async ({ request }) => {
  const svg = await (await request.get("/logo.svg")).text();
  expect(svg).toContain(`d="${MARK}"`);
  expect(svg).toContain('fill="#1F4E8C"');
  expect(svg).toMatch(/prefers-color-scheme: dark\)\{path\{fill:#8DB6EE\}/);
});

test("the launch mark's outline is the icons' outline", async ({ page }) => {
  await fakeServer(page);
  await page.goto("/");
  const hooks = await page
    .locator(".launch path[data-hook]")
    .evaluateAll((paths) => paths.map((p) => p.getAttribute("d")));
  expect(hooks.join("")).toBe(MARK);
});

test("the maskable icon keeps its mark inside the safe zone", async ({ page, request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  const icon = manifest.icons.find((i: { purpose?: string }) => i.purpose === "maskable");
  const png = Buffer.from(await (await request.get(`/${icon.src}`)).body());
  await page.setContent(`<img src="data:image/png;base64,${png.toString("base64")}">`);
  // The safe zone is the circle of 40 % of the side; the mark's pixels (those unlike the corner's
  // background) must all lie in it.
  const outside = await page.locator("img").evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const side = img.naturalWidth;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = side;
    const context = canvas.getContext("2d")!;
    context.drawImage(img, 0, 0);
    const { data } = context.getImageData(0, 0, side, side);
    const ground = [data[0]!, data[1]!, data[2]!];
    let count = 0;
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++) {
        const at = (y * side + x) * 4;
        const differs = [0, 1, 2].some((c) => Math.abs(data[at + c]! - ground[c]!) > 24);
        if (differs && Math.hypot(x + 0.5 - side / 2, y + 0.5 - side / 2) > 0.4 * side) count++;
      }
    return count;
  });
  expect(outside).toBe(0);
});
