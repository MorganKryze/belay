import { createHash } from "node:crypto";
import { expect, type Page, type Request, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { asIPhone, INSTANCE, routeInstance, sheetOpenedAt } from "./native";

test.use({ locale: "fr-FR" });

const TOKEN = "t".repeat(43);
const DENIED =
  "Ton compte n’a pas accès à Belay. Demande l’accès à la personne qui gère cette instance.";

async function launch(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Belay" })).toBeVisible();
}

const signIn = (page: Page) => page.getByRole("button", { name: "Se connecter" });
const change = (page: Page) => page.getByRole("button", { name: "Changer d’instance" });
const hostLine = (page: Page) => page.getByText(/^Sur /);
// Where the change's words start: its 44 px target reaches past them by its own padding.
const wordsX = (page: Page) =>
  change(page).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().x;
  });

async function expectFits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

test("the sign-in step names the instance and offers to sign in, change it, or use the tools", async ({
  page,
}) => {
  await asIPhone(page);
  await routeInstance(page, { "/api/me": { status: 401 } });
  await launch(page);
  await expect(signIn(page)).toBeEnabled();
  await expect(hostLine(page)).toHaveText("Sur belay.test");
  await expect(change(page)).toBeVisible();
  await expect(page.getByRole("link", { name: "Utiliser les outils sans compte" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Se connecter" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("signing in exchanges the code with the verifier of the challenge sent and reopens with the token", async ({
  page,
}) => {
  await asIPhone(page, { authenticate: { url: "belay://auth?code=c1" } });
  const exchanges: unknown[] = [];
  await routeInstance(page, {
    "/api/me": { status: 401 },
    "POST /auth/native/token": (request) => {
      exchanges.push(request.postDataJSON());
      return { json: { token: TOKEN } };
    },
  });
  await launch(page);
  const signedIn = page.waitForRequest(
    (r: Request) => r.url() === `${INSTANCE}/api/me` && r.headers().authorization !== undefined,
  );
  await signIn(page).click();
  const me = await signedIn;
  expect(me.headers().authorization).toBe(`Bearer ${TOKEN}`);
  expect(exchanges).toHaveLength(1);
  const { code, verifier } = exchanges[0] as { code: string; verifier: string };
  expect(code).toBe("c1");
  expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  // The sheet opened on the instance with the hash of that very verifier.
  const sheet = new URL((await sheetOpenedAt(page))!);
  expect(`${sheet.origin}${sheet.pathname}`).toBe(`${INSTANCE}/auth/native/start`);
  expect(sheet.searchParams.get("challenge")).toBe(
    createHash("sha256").update(verifier).digest("base64url"),
  );
});

test("closing the sheet leaves the step as it was, with no message", async ({ page }) => {
  await asIPhone(page);
  const exchanges: Request[] = [];
  await routeInstance(page, {
    "/api/me": { status: 401 },
    "POST /auth/native/token": (request) => {
      exchanges.push(request);
      return { status: 400 };
    },
  });
  await launch(page);
  await signIn(page).click();
  await expect.poll(() => sheetOpenedAt(page)).not.toBeNull();
  await expect(signIn(page)).not.toHaveAttribute("aria-busy");
  await expect(signIn(page)).toBeFocused();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(hostLine(page)).toHaveText("Sur belay.test");
  expect(exchanges).toEqual([]);
});

test("a refusal in the sheet's answer shows its line", async ({ page }) => {
  await asIPhone(page, { authenticate: { url: "belay://auth?error=denied" } });
  await routeInstance(page, { "/api/me": { status: 401 } });
  await launch(page);
  await signIn(page).click();
  await expect(page.getByRole("alert")).toHaveText(DENIED);
  await expect(signIn(page)).toBeEnabled();
});

test("an unreachable instance says so and still offers the sign-in", async ({ page }) => {
  await asIPhone(page);
  await routeInstance(page, { "/api/me": "abort" });
  await launch(page);
  await expect(page.getByText("Le serveur est injoignable pour le moment.")).toHaveAttribute(
    "role",
    "status",
  );
  await expect(signIn(page)).toBeEnabled();
});

test("Changer d’instance shows the kept address and Annuler comes back", async ({ page }) => {
  await asIPhone(page);
  await routeInstance(page, { "/api/me": { status: 401 } });
  await launch(page);
  await change(page).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ton instance" })).toBeVisible();
  // Shown as typed: the stored origin without its https://.
  await expect(page.getByRole("textbox", { name: "Adresse de l’instance" })).toHaveValue(
    "belay.test",
  );
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Belay" })).toBeVisible();
  await expect(change(page)).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("belay.instance"))).toBe(INSTANCE);
});

test("next to a short host the change sits on its line, a 44 px target", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await asIPhone(page);
  await routeInstance(page, { "/api/me": { status: 401 } });
  await launch(page);
  const [line, link] = [(await hostLine(page).boundingBox())!, (await change(page).boundingBox())!];
  expect(Math.abs(line.y + line.height / 2 - (link.y + link.height / 2))).toBeLessThanOrEqual(1);
  // The design's gap between the host and the change: 12 px and the target's 1 px border.
  const gap = (await wordsX(page)) - (line.x + line.width);
  expect(gap).toBeGreaterThanOrEqual(12);
  expect(gap).toBeLessThanOrEqual(14);
  expect(link.height).toBeGreaterThanOrEqual(44);
  expect(link.width).toBeGreaterThanOrEqual(44);
});

test("past a long host at 360 px the change drops to its own line, in line with the host", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await asIPhone(page, { instance: "https://belay.une-association-sportive.example.org" });
  await page.route("https://belay.une-association-sportive.example.org/**", (route) =>
    route.fulfill({ status: 401, headers: { "access-control-allow-origin": "*" } }),
  );
  await launch(page);
  const [line, link] = [(await hostLine(page).boundingBox())!, (await change(page).boundingBox())!];
  expect(link.y).toBeGreaterThanOrEqual(line.y + line.height - 1);
  // The words start where the host's do.
  expect(Math.abs((await wordsX(page)) - line.x)).toBeLessThanOrEqual(1);
  await expectFits(page);
});

for (const scheme of ["light", "dark"] as const) {
  for (const width of [360, 390]) {
    test(`the sign-in step has no axe violation, ${scheme}, ${width} px`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 780 });
      await asIPhone(page);
      await routeInstance(page, { "/api/me": { status: 401 } });
      await launch(page);
      await expectNoAxeViolations(page);
      await expectFits(page);
    });

    test(`the sign-in step has no axe violation with its lines, ${scheme}, ${width} px`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 780 });
      await asIPhone(page);
      await routeInstance(page, { "/api/me": "abort" });
      // The longest failure, brought back by a sign-in link, over an instance that does not answer.
      await launch(page, "/?signin=denied");
      await expect(page.getByRole("alert")).toHaveText(DENIED);
      await expect(page.getByText("Le serveur est injoignable pour le moment.")).toBeVisible();
      await expectNoAxeViolations(page);
      await expectFits(page);
    });
  }
}
