import { expect, test } from "@playwright/test";
import { fakeServer } from "./fake-server";

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
      "#151412",
    );
  });
});
