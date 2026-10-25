import { expect, type Page, type Request, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { asIPhone, INSTANCE, routeInstance } from "./native";

test.use({ locale: "fr-FR" });

const LONG = "belay.une-association-sportive-de-quartier.example.org";

// The instance at https://belay.test: its probe answered as `probe` says, nobody signed in.
async function instance(page: Page, probe: "belay" | "html" | "down" = "belay") {
  await routeInstance(page, {
    "/api/instance":
      probe === "down"
        ? "abort"
        : probe === "html"
          ? { contentType: "text/html", body: "<!doctype html>" }
          : { json: { app: "belay", api: 1, origin: INSTANCE } },
    "/api/me": { status: 401 },
  });
}

// Every request that leaves the app for another machine.
function outside(page: Page): Request[] {
  const sent: Request[] = [];
  page.on("request", (r) => {
    if (/^https?:\/\/(?!localhost[:/])/.test(r.url())) sent.push(r);
  });
  return sent;
}

async function launch(page: Page) {
  // The first launch: no instance stored yet, no token kept.
  await asIPhone(page, { instance: null });
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Ton instance" })).toBeVisible();
}

const field = (page: Page) => page.getByRole("textbox", { name: "Adresse de l’instance" });
const continuer = (page: Page) => page.getByRole("button", { name: "Continuer" });

async function submit(page: Page, address: string) {
  await field(page).fill(address);
  await expect(field(page)).toHaveValue(address);
  await continuer(page).click();
}

async function expectFits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

test("the first launch asks for the instance and sends nothing before an address is checked", async ({
  page,
}) => {
  await instance(page);
  const sent = outside(page);
  await launch(page);
  await expect(continuer(page)).toBeDisabled();
  await expect(page.getByRole("link", { name: "Utiliser les outils sans compte" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Se connecter" })).toHaveCount(0);
  // Chromium takes "belay test" as a host name; every engine refuses a port that is no number.
  await submit(page, "belay:test");
  await expect(page.getByRole("alert")).toHaveText(
    "Cette adresse n’est pas valide. Exemple : belay.exemple.fr",
  );
  await expect(field(page)).toBeFocused();
  await submit(page, "http://belay.test");
  await expect(page.getByRole("alert")).toHaveText("L’adresse doit commencer par https://");
  await expect(field(page)).toBeFocused();
  expect(sent.map((r) => r.url())).toEqual([]);
});

test("offline, the first screen says it once, in its field, with no banner above", async ({
  page,
  context,
}) => {
  await instance(page);
  await launch(page);
  await context.setOffline(true);
  await submit(page, "belay.test");
  await expect(page.getByRole("alert")).toHaveText("Pas de connexion. Réessaie une fois en ligne.");
  await expect(page.getByText("Tu es hors ligne.")).toHaveCount(0);
  await context.setOffline(false);
});

test("an address where no Belay answers says so", async ({ page }) => {
  await instance(page, "html");
  await launch(page);
  await submit(page, "belay.test");
  await expect(page.getByRole("alert")).toHaveText(
    "Aucune instance Belay ne répond à cette adresse. Vérifie-la.",
  );
  await expect(field(page)).toBeFocused();
});

test("an address that does not answer is unreachable", async ({ page }) => {
  await instance(page, "down");
  await launch(page);
  await submit(page, "belay.test");
  await expect(page.getByRole("alert")).toHaveText(
    "Impossible de joindre cette adresse. Vérifie-la, ou vérifie que l’instance est à jour.",
  );
  await expect(continuer(page)).toBeEnabled();
});

test("a found instance is kept and asked who is signed in, without a cookie", async ({
  page,
  context,
}) => {
  // A cookie the instance once set in this web view: the app's requests must never carry it.
  await context.addCookies([
    { name: "belay_session", value: "web", domain: "belay.test", path: "/", secure: true },
  ]);
  await instance(page);
  await launch(page);
  const me = page.waitForRequest(`${INSTANCE}/api/me`);
  await submit(page, "belay.test");
  const request = await me;
  const headers = await request.allHeaders();
  expect(headers.cookie).toBeUndefined();
  expect(headers.authorization).toBeUndefined();
  expect(await page.evaluate(() => localStorage.getItem("belay.instance"))).toBe(INSTANCE);
  // The app started again on the stored instance: signed out, on the sign-in step.
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Ton instance" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Belay" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
  await expect(page.getByText(/^Sur /)).toHaveText("Sur belay.test");
});

test("a long address scrolls in its field and its error wraps at 360 px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await instance(page, "down");
  await launch(page);
  await submit(page, LONG);
  await expect(page.getByRole("alert")).toBeVisible();
  await expectFits(page);
  const [box, alert] = [
    (await field(page).boundingBox())!,
    (await page.getByRole("alert").boundingBox())!,
  ];
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  expect(alert.x + alert.width).toBeLessThanOrEqual(360);
});

test("the field is the kit's: 50 px tall, 16 px text, no zoom on focus", async ({ page }) => {
  await launch(page);
  const style = await field(page).evaluate((el) => {
    const s = getComputedStyle(el);
    return { height: el.getBoundingClientRect().height, size: s.fontSize };
  });
  expect(style).toEqual({ height: 50, size: "16px" });
});

for (const scheme of ["light", "dark"] as const) {
  for (const width of [360, 390]) {
    test(`the instance screen has no axe violation, empty, ${scheme}, ${width} px`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 780 });
      await launch(page);
      await expectNoAxeViolations(page);
      await expectFits(page);
    });

    test(`the instance screen has no axe violation, in error, ${scheme}, ${width} px`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 780 });
      await instance(page, "down");
      await launch(page);
      await submit(page, LONG);
      await expect(page.getByRole("alert")).toBeVisible();
      await expectNoAxeViolations(page);
      await expectFits(page);
    });
  }
}
