import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { ADA, fakeServer } from "./fake-server";
import { readMotion, recordMotion } from "./motion";

// The real clock throughout: the rest's line is read against the time that passes.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

const OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const POP = "linear(0 0%, 0.5 18%, 0.9 35%, 1.06 52%, 1.02 70%, 1 100%)";

// Session A three days ago, the bench press at 80 kg × 8, 8, 7, 6: every set comes prefilled.
const DAY = new Date(Date.now() - 3 * 86_400_000);
const at = (minutes: number) => new Date(DAY.getTime() + minutes * 60_000).toISOString();
const LAST = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e01";
const LAST_A: Change[] = [
  {
    kind: "workout",
    id: LAST,
    field: "start",
    sessionCode: "A",
    plan: [...sessionByCode("A")!.slots],
    startedAt: at(0),
    at: at(0),
  },
  ...[8, 8, 7, 6].map((reps, k): Change => ({
    kind: "set",
    id: `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e1${k}`,
    workoutId: LAST,
    field: "create",
    slotIndex: 0,
    position: 3 + k,
    exerciseId: "ds:0025",
    warmup: false,
    weightKg: 80,
    reps,
    rir: 1,
    doneAt: at(5 + k * 3),
    at: at(5 + k * 3),
  })),
  { kind: "workout", id: LAST, field: "ended", value: at(60), at: at(60) },
];

const bench = (page: Page) => page.getByRole("region", { name: /^Barbell bench press/ });
const load = (page: Page, n: number) =>
  bench(page).getByRole("textbox", { name: `Load of set ${n}, kg` });
const reps = (page: Page, n: number) =>
  bench(page).getByRole("textbox", { name: `Reps of set ${n}` });

// Session A started on this device, its cells prefilled from last time.
async function start(page: Page) {
  const server = await fakeServer(page, { changes: LAST_A });
  await page.goto("/workout?start=A");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(load(page, 1)).toHaveValue("80");
  await expect(reps(page, 1)).toHaveValue("8");
  return server;
}

async function log(page: Page, n: number) {
  await expect(reps(page, n)).toHaveValue(/\d/);
  await bench(page)
    .getByRole("button", { name: `Log set ${n}` })
    .click();
  await expect(bench(page).getByRole("img", { name: `Set ${n} logged` })).toBeVisible();
}

// The rest bar's line along its bottom, and the width it is drawn at.
const line = (page: Page) =>
  page.locator("div:has(> div > [role=timer]) > span[aria-hidden]").first();
const scaleOf = (el: Locator) =>
  el.evaluate((node) => {
    const m = /matrix\(([^,]+)/.exec(getComputedStyle(node).transform);
    return m ? Number(m[1]) : 1;
  });

const isPop = (m: { duration: number; easing: string }) => m.duration === 180 && m.easing === POP;

// What the device sent and what it still holds to send, each change once.
async function changes(page: Page, server: Awaited<ReturnType<typeof fakeServer>>) {
  const queued = await page.evaluate(
    (id) =>
      new Promise<Change[]>((resolve, reject) => {
        const open = indexedDB.open(`belay.${id}`);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction("outbox").objectStore("outbox").getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            db.close();
            resolve((all.result as { change: Change }[]).map((e) => e.change));
          };
        };
      }),
    ADA.id,
  );
  const all = [...server.requests.flatMap((r) => r.changes), ...queued];
  return all.filter((c, i) => all.findIndex((d) => JSON.stringify(d) === JSON.stringify(c)) === i);
}

for (const viewport of [
  { width: 360, height: 780 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test.describe(`at ${viewport.width} px`, () => {
    test.use({ viewport });
    test("every set cell, tick, RIR choice and Note is at least 44 × 44", async ({ page }) => {
      await start(page);
      await log(page, 1);
      const targets = [
        ...(await bench(page).getByRole("textbox").all()),
        ...(await bench(page).getByRole("button", { name: /^Log / }).all()),
        bench(page).getByRole("img", { name: "Set 1 logged" }),
        ...(await bench(page).getByRole("radio").all()),
        bench(page).getByRole("button", { name: "Note" }),
      ];
      expect(targets.length).toBeGreaterThan(12);
      for (const target of targets) {
        const box = (await target.boundingBox())!;
        expect
          .soft(box.width, await target.evaluate((el) => el.outerHTML))
          .toBeGreaterThanOrEqual(44);
        expect
          .soft(box.height, await target.evaluate((el) => el.outerHTML))
          .toBeGreaterThanOrEqual(44);
      }
    });
  });
}

test("a done row has no cell boxes, its values in the reference ink, split by a hairline", async ({
  page,
}) => {
  await start(page);
  await log(page, 1);
  await log(page, 2);
  const colours = await page.evaluate(() => {
    const probe = document.createElement("i");
    document.body.append(probe);
    const read = (value: string) => {
      probe.style.color = value;
      return getComputedStyle(probe).color;
    };
    const ink = read("var(--reference-ink)");
    const hairline = [
      read("color-mix(in srgb, var(--reference-ink) 12%, transparent)"),
      read("color-mix(in oklab, var(--reference-ink) 12%, transparent)"),
    ];
    probe.remove();
    return { ink, hairline };
  });
  for (const cell of [load(page, 1), reps(page, 1), load(page, 2), reps(page, 2)]) {
    const style = await cell.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        borders: [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth],
        background: s.backgroundColor,
        color: s.color,
        weight: s.fontWeight,
      };
    });
    expect(style.borders).toEqual(["0px", "0px", "0px", "0px"]);
    expect(style.background).toBe("rgba(0, 0, 0, 0)");
    expect(style.color).toBe(colours.ink);
    expect(Number(style.weight)).toBeGreaterThanOrEqual(700);
  }
  // The second done row draws the hairline above it, once its tint has faded in.
  const split = () =>
    load(page, 2)
      .locator("..")
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { width: s.borderTopWidth, colour: s.borderTopColor, shadow: s.boxShadow };
      });
  await expect
    .poll(async () => {
      const { width, colour, shadow } = await split();
      return colours.hairline.some((c) => (width === "1px" && colour === c) || shadow.includes(c));
    })
    .toBe(true);
});

// The set row's background in the frame after its tick is tapped, against the reference tint.
async function tintAfterTap(page: Page) {
  await start(page);
  await expect(reps(page, 1)).toHaveValue(/\d/);
  await load(page, 1)
    .locator("..")
    .evaluate((row) => {
      const probe = document.createElement("i");
      document.body.append(probe);
      probe.style.backgroundColor = "var(--reference)";
      const reference = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const before = getComputedStyle(row).backgroundColor;
      const seen: { reference: string; background: string; running: string[] }[] = [];
      (window as unknown as { tint: typeof seen }).tint = seen;
      // Frame by frame from the tap, the first frame whose background has left the old one.
      const frame = () => {
        const background = getComputedStyle(row).backgroundColor;
        if (background === before) return requestAnimationFrame(frame);
        seen.push({
          reference,
          background,
          running: row
            .getAnimations()
            .filter((a) => (a as CSSTransition).transitionProperty === "background-color")
            .map((a) => a.playState),
        });
      };
      document.addEventListener("click", () => requestAnimationFrame(frame), { once: true });
    });
  await bench(page).getByRole("button", { name: "Log set 1" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { tint: unknown[] }).tint.length))
    .toBe(1);
  const [seen] = await page.evaluate(
    () =>
      (
        window as unknown as {
          tint: { reference: string; background: string; running: string[] }[];
        }
      ).tint,
  );
  expect(seen!.background).toBe(seen!.reference);
  expect(seen!.running).toEqual([]);
}

test("a checked set's row is green in the frame after the tap", async ({ page }) => {
  await tintAfterTap(page);
});

test("the tick pops once when tapped, never after a reload", async ({ page }) => {
  await recordMotion(page);
  await start(page);
  await log(page, 1);
  await expect
    .poll(async () => (await readMotion(page)).filter(isPop))
    .toContainEqual(expect.objectContaining({ target: "svg", scales: true, kind: "animation" }));
  await page.reload();
  await expect(page.locator(".launch")).toBeHidden();
  await expect(bench(page).getByRole("img", { name: "Set 1 logged" })).toBeVisible();
  await page.waitForTimeout(1000);
  expect((await readMotion(page)).filter(isPop)).toEqual([]);
});

test("the rest bar rises in 220 ms and its line shrinks from the set to the end of the rest", async ({
  page,
}) => {
  await recordMotion(page);
  await start(page);
  await log(page, 1);
  await expect(page.getByRole("timer")).toBeVisible();
  await expect
    .poll(() => readMotion(page))
    .toContainEqual(
      expect.objectContaining({
        target: "div",
        duration: 220,
        easing: OUT,
        transforms: true,
        properties: ["opacity", "transform"],
        kind: "animation",
      }),
    );
  const first = await scaleOf(line(page));
  expect(first).toBeGreaterThan(0.9);
  expect(first).toBeLessThanOrEqual(1);
  await page.waitForTimeout(1500);
  const later = await scaleOf(line(page));
  expect(later).toBeLessThan(first);
  await page.getByRole("button", { name: /^\+30/ }).click();
  await expect.poll(() => scaleOf(line(page))).toBeGreaterThan(later);
});

test("logging a set still takes 2 taps", async ({ page }) => {
  const server = await start(page);
  // ✓, then the RIR under the next set: the RIR writes nothing on the set just logged.
  await log(page, 1);
  const rir = bench(page).getByRole("radiogroup", { name: "RIR, reps in reserve" });
  // RIR 1 is already chosen there (the low end of 1–2), and a tap on it would clear it.
  await expect(rir.getByRole("radio", { name: "1", exact: true })).toBeChecked();
  await rir.getByRole("radio", { name: "2", exact: true }).click();
  await expect(rir.getByRole("radio", { name: "2", exact: true })).toBeChecked();
  const sets = async () => (await changes(page, server)).filter((c) => c.kind === "set");
  await expect.poll(async () => (await sets()).length).toBe(1);
  // Set 2 carries the RIR chosen before its ✓.
  await log(page, 2);
  await expect
    .poll(async () =>
      (await sets()).map((c) => ({
        position: "position" in c && c.position,
        rir: "rir" in c && c.rir,
      })),
    )
    .toEqual([
      { position: 3, rir: null },
      { position: 4, rir: 2 },
    ]);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("with reduced motion a checked set's row is green in the frame after the tap", async ({
    page,
  }) => {
    await tintAfterTap(page);
  });

  test("with reduced motion the tick does not grow and the rest bar fades in 120 ms", async ({
    page,
  }) => {
    await recordMotion(page);
    await start(page);
    await log(page, 1);
    await expect(page.getByRole("timer")).toBeVisible();
    await expect
      .poll(() => readMotion(page))
      .toContainEqual(
        expect.objectContaining({
          target: "div",
          duration: 120,
          easing: OUT,
          transforms: false,
          properties: ["opacity"],
          kind: "animation",
        }),
      );
    expect((await readMotion(page)).filter((m) => m.scales)).toEqual([]);
  });
});

test.describe("accessibility", () => {
  // No transition in flight when axe measures a colour.
  test.use({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"] as const) {
    test(`the session screen has no axe violation, ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
      await start(page);
      await log(page, 1);
      await expect(page.getByRole("timer")).toBeVisible();
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      await expectNoAxeViolations(page);
    });
  }
});
