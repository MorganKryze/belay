import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { cleanup, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readHistory, recordChanges } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";

// Passes through, until a test holds the history's read.
vi.mock("../sync/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../sync/db")>();
  return { ...real, readHistory: vi.fn(real.readHistory) };
});

// Wednesday 7 October 2026, 7:30 in the morning, on the phone's clock.
beforeEach(() => {
  indexedDB = new IDBFactory();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 7, 7, 30));
  writeLastUser(ADA);
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(readHistory).mockReset(); // back to the real read
  await i18n.changeLanguage("en");
});

const OPEN = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e01";
const start = new Date(2026, 9, 7, 7, 0).toISOString();
const firstSet = new Date(2026, 9, 7, 7, 10).toISOString();
// Session A started this morning, its first bench press set logged after two warm-ups.
const OPEN_A: Change[] = [
  {
    kind: "workout",
    id: OPEN,
    field: "start",
    sessionCode: "A",
    plan: [...sessionByCode("A")!.slots],
    startedAt: start,
    at: start,
  },
  ...[true, true, false].map((warmup, k): Change => ({
    kind: "set",
    id: `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e1${k}`,
    workoutId: OPEN,
    field: "create",
    slotIndex: 0,
    position: k + 1,
    exerciseId: "ds:0025",
    warmup,
    weightKg: warmup ? 40 : 60,
    reps: 8,
    rir: warmup ? null : 2,
    doneAt: firstSet,
    at: firstSet,
  })),
];

// A ended on Monday, B on Tuesday: C is next, in a week with no climbing so far.
const finished = (id: string, code: string, day: number): Change[] => {
  const from = new Date(2026, 9, day, 18, 0).toISOString();
  const to = new Date(2026, 9, day, 19, 0).toISOString();
  return [
    {
      kind: "workout",
      id,
      field: "start",
      sessionCode: code,
      plan: [...sessionByCode(code)!.slots],
      startedAt: from,
      at: from,
    },
    { kind: "workout", id, field: "ended", value: to, at: to },
  ];
};
const A_THEN_B = [
  ...finished("0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e21", "A", 5),
  ...finished("0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e22", "B", 6),
];

const card = (name: RegExp) => screen.findByRole("region", { name });

describe("Accueil's session card", () => {
  it("the next session's card: title, Next up · 6 exercises · about 55 min, and See the session pushes its preview from Accueil", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Session A · Push$/);
    expect(within(region).getByRole("heading", { name: "Session A · Push" })).toBeTruthy();
    expect(region.textContent).toContain("Next up · 6 exercises · about 55 min");
    const see = within(region).getByRole("link", { name: "See the session" });
    expect(see.getAttribute("href")).toBe("/workouts/session/A?from=home");
    expect(within(region).getAllByRole("link")).toHaveLength(1);
  });

  it("with A open the card says In progress · 1 of 19 sets and Resume raises it", async () => {
    await seed(ADA.id, OPEN_A);
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Session A · Push$/);
    expect(region.textContent).toContain("In progress · 1 of 19 sets");
    const resume = within(region).getByRole("link", { name: "Resume" });
    expect(resume.getAttribute("href")).toBe("/workout?start=A");
    expect(within(region).queryByRole("link", { name: "See the session" })).toBeNull();
  });

  it("paused, the card still says In progress", async () => {
    await seed(ADA.id, OPEN_A);
    const db = await openAccountDb(ADA.id);
    await recordChanges(db, [], {
      active: { workoutId: OPEN, slotIndex: 0, restEndsAt: null, pausedAt: firstSet },
    });
    db.close();
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Session A · Push$/);
    expect(region.textContent).toContain("In progress · 1 of 19 sets");
    expect(within(region).getByRole("link", { name: "Resume" })).toBeTruthy();
  });

  it("session C in a week with no climbing counts the slots its rule adds", async () => {
    await seed(ADA.id, A_THEN_B);
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Session C · /);
    expect(region.textContent).toMatch(/Next up · 10 exercises · about \d+ min/);
  });

  it("no card before the history is read", async () => {
    vi.mocked(readHistory).mockImplementation(() => new Promise(() => {}));
    fakeApi({ me: ADA });
    renderRoute("/");
    await screen.findByRole("button", { name: /^Weigh-in/ });
    expect(readHistory).toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: /^Session / })).toBeNull();
    expect(screen.queryByRole("link", { name: "See the session" })).toBeNull();
  });

  it("in French: « La prochaine · 6 exercices · environ 55 min », « En cours · 1 série sur 19 »", async () => {
    await i18n.changeLanguage("fr");
    fakeApi({ me: ADA });
    renderRoute("/");
    let region = await card(/^Séance A · Push$/);
    expect(region.textContent).toContain("La prochaine · 6 exercices · environ 55 min");
    expect(within(region).getByRole("link", { name: "Voir la séance" })).toBeTruthy();
    cleanup();
    await seed(ADA.id, OPEN_A);
    renderRoute("/");
    region = await card(/^Séance A · Push$/);
    expect(region.textContent).toContain("En cours · 1 série sur 19");
    expect(within(region).getByRole("link", { name: "Reprendre" })).toBeTruthy();
  });

  it("the card opens the preview when no session is open, and resumes the session when one is", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    let region = await card(/^Session A · Push$/);
    expect(within(region).getByRole("link").getAttribute("href")).toBe(
      "/workouts/session/A?from=home",
    );
    cleanup();
    await seed(ADA.id, OPEN_A);
    renderRoute("/");
    region = await card(/^Session A · Push$/);
    expect(within(region).getByRole("link").getAttribute("href")).toBe("/workout?start=A");
  });
});
