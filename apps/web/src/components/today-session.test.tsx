import type { Change } from "@belay/shared/sync/schema";
import {
  addSession,
  addSlot,
  chooseActive,
  createProgram,
  placeSession,
  setAside,
  setSchedule,
} from "@belay/shared/training/program-edits";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import {
  SEED_PROGRAM_ID,
  seedId,
  type StoredPrograms,
} from "@belay/shared/training/stored-program";
import { act, cleanup, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readHistory, readPrograms, recordChanges } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";

// Passes through, until a test holds the history's read; the programs' read is watched.
vi.mock("../sync/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../sync/db")>();
  return { ...real, readHistory: vi.fn(real.readHistory), readPrograms: vi.fn(real.readPrograms) };
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
  vi.mocked(readPrograms).mockClear();
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
    plan: [...sessionByCode("A", starterProgram)!.slots],
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
      plan: [...(sessionByCode(code, starterProgram) ?? sessionByCode("A", starterProgram)!).slots],
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
  it("the next session's card: title, Next up · 6 exercises · about 55 min, and See the session pushes its preview from Accueil", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Session A · Push$/);
    expect(within(region).getByRole("heading", { name: "Session A · Push" })).toBeTruthy();
    expect(region.textContent).toContain("Next up · 6 exercises · about 55 min");
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
    expect(region.textContent).toMatch(/Next up · 10 exercises · about \d+\u00A0min/);
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

  it("in French: « La prochaine · 6 exercices · environ 55 min », « En cours · 1 série sur 19 »", async () => {
    await i18n.changeLanguage("fr");
    fakeApi({ me: ADA });
    renderRoute("/");
    let region = await card(/^Séance A · Push$/);
    expect(region.textContent).toContain("La prochaine · 6 exercices · environ 55 min");
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

  it("done today: the check tile, Done today · 48 min · 11 sets, and Next up: Session B · Legs pushes B's preview from Accueil, with no filled button", async () => {
    await seed(ADA.id, DONE_A);
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Session A · Push$/);
    expect(region.textContent).toContain("Done today · 48 min · 11 sets");
    expect(region.querySelector("svg.lucide-check")).toBeTruthy();
    const next = within(region).getByRole("link", { name: "Next up: Session B · Legs" });
    expect(next.getAttribute("href")).toBe("/workouts/session/B?from=home");
    expect(within(region).getAllByRole("link")).toHaveLength(1);
    expect(region.querySelector(".bg-primary")).toBeNull();
  });

  it("an open session wins over one done today", async () => {
    await seed(ADA.id, [...DONE_A, ...OPEN_A]);
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Session A · Push$/);
    expect(region.textContent).toContain("In progress · 1 of 19 sets");
    expect(region.textContent).not.toContain("Done today");
  });

  it("in French: « Faite aujourd'hui · 48 min · 11 séries », « La prochaine : Séance B · Legs »", async () => {
    await i18n.changeLanguage("fr");
    await seed(ADA.id, DONE_A);
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Séance A · Push$/);
    expect(region.textContent).toContain("Faite aujourd'hui · 48 min · 11 séries");
    expect(
      within(region).getByRole("link", { name: "La prochaine\u202f: Séance B · Legs" }),
    ).toBeTruthy();
  });
});

// Session A done this morning, 6:00 to 6:48: a warm-up and 11 work sets.
const DONE = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e31";
const DONE_A: Change[] = [
  ...finished(DONE, "A", 7).map((c) => {
    const at = new Date(2026, 9, 7, 6, c.kind === "workout" && c.field === "ended" ? 48 : 0);
    return c.kind === "workout" && c.field === "ended"
      ? { ...c, value: at.toISOString(), at: at.toISOString() }
      : { ...c, startedAt: at.toISOString(), at: at.toISOString() };
  }),
  ...Array.from({ length: 12 }, (_, k): Change => ({
    kind: "set",
    id: `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e${40 + k}`,
    workoutId: DONE,
    field: "create",
    slotIndex: k === 0 ? 0 : (k - 1) % 6,
    position: k === 0 ? 1 : 3 + Math.floor((k - 1) / 6),
    exerciseId: "ds:0025",
    warmup: k === 0,
    weightKg: 60,
    reps: 8,
    rir: k === 0 ? null : 2,
    doneAt: new Date(2026, 9, 7, 6, 10 + k).toISOString(),
    at: new Date(2026, 9, 7, 6, 10 + k).toISOString(),
  })),
];

// Program edits as the editor queues them, built on what the phone holds.
async function edit(build: (p: StoredPrograms) => Change[] | null) {
  const db = await openAccountDb(ADA.id);
  await recordChanges(db, build(await readPrograms(db))!);
  db.close();
}
const EDIT_AT = "2026-10-01T06:00:00.000Z";
const D = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f0d";
const E = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f0e";
const BENCH = { id: "ds:0025", measure: "reps" as const };
// Sessions D and E at the end of the starting program's rotation, one bench press slot each.
async function addDAndE() {
  for (const [session, slot] of [
    [D, "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f1d"],
    [E, "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f1e"],
  ] as const) {
    await edit((p) => addSession(p, session, SEED_PROGRAM_ID, EDIT_AT));
    await edit((p) => addSlot(p, slot, session, BENCH, EDIT_AT));
  }
}
// A session finished on day `day` of October that recorded the session it came from.
const finishedFrom = (id: string, code: string, sessionId: string, day: number): Change[] =>
  finished(id, code, day).map((c) =>
    c.kind === "workout" && c.field === "start" ? { ...c, sessionId } : c,
  );
// Every read of the programs answered and the screen given its turn.
async function settled() {
  await vi.waitFor(() => expect(readPrograms).toHaveBeenCalled());
  await act(async () => {
    await Promise.all(vi.mocked(readPrograms).mock.results.map((r) => r.value));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe("Accueil reads the active program", () => {
  it("offers the session after the last one done in a rotation of five", async () => {
    await addDAndE();
    await seed(ADA.id, finishedFrom("0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e23", "D", D, 6));
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Session E/);
    expect(region.textContent).toMatch(/Next up · 1 exercise · about \d+\u00A0min/);
    expect(within(region).getByRole("link", { name: "See the session" }).getAttribute("href")).toBe(
      "/workouts/session/E?from=home",
    );
  });

  it("after the last session wraps to the first", async () => {
    await addDAndE();
    await seed(ADA.id, finishedFrom("0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e23", "E", E, 6));
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Session A · Push$/);
    expect(region.textContent).toContain("Next up · 6 exercises · about 55\u00A0min");
  });

  it("after a reorder follows the recorded session, not the letter", async () => {
    // A done on Tuesday, then moved to the end: Legs is now A, and comes after it.
    await seed(ADA.id, finishedFrom("0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e23", "A", seedId(1), 6));
    await edit((p) => placeSession(p, seedId(1), SEED_PROGRAM_ID, 2, EDIT_AT));
    fakeApi({ me: ADA });
    renderRoute("/");
    const see = await screen.findByRole("link", { name: "See the session" });
    expect(see.getAttribute("href")).toBe("/workouts/session/A?from=home");
    expect(see.closest("section")!.textContent).toContain(
      "Next up · 7 exercises · about 60\u00A0min",
    );
  });

  it("an empty rotation shows no card", async () => {
    await edit((p) => createProgram(p, "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f20", EDIT_AT));
    await edit((p) => chooseActive(p, "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f20", EDIT_AT));
    fakeApi({ me: ADA });
    renderRoute("/");
    await screen.findByRole("button", { name: /^Weigh-in/ });
    await settled();
    expect(screen.queryByRole("region", { name: /^Session / })).toBeNull();
    expect(screen.queryByRole("link", { name: "See the session" })).toBeNull();
  });

  it("an active program removed on another device: the session done today, with no next one", async () => {
    const other = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f20";
    await edit((p) => createProgram(p, other, EDIT_AT));
    await edit((p) => chooseActive(p, other, EDIT_AT));
    await edit(() => [{ kind: "program", id: other, field: "removed", value: true, at: EDIT_AT }]);
    await seed(ADA.id, DONE_A);
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Session A · Push$/);
    expect(region.textContent).toContain("Done today · 48\u00A0min · 11 sets");
    expect(within(region).queryByRole("link")).toBeNull();
  });

  it("an open session keeps its card when the rotation is empty", async () => {
    await edit((p) => createProgram(p, "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f20", EDIT_AT));
    await edit((p) => chooseActive(p, "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f20", EDIT_AT));
    await seed(ADA.id, OPEN_A);
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Session A · Push$/);
    expect(region.textContent).toContain("In progress · 1 of 19 sets");
  });
});

// The starting program on fixed days: Monday A, Wednesday B, Saturday C, unless a test gives its
// own week. October 2026: Monday 5, Wednesday 7, Saturday 10, Monday 12.
const [PUSH, LEGS, GLUTES] = [seedId(1), seedId(2), seedId(3)];
const WEEK = [PUSH, null, LEGS, null, null, GLUTES, null];
const fixedDays = (days: (string | null)[] = WEEK) =>
  edit(() => setSchedule(SEED_PROGRAM_ID, { mode: "fixed", days }, EDIT_AT));
// The phone's clock at 7:30 on a day of October 2026.
const morningOf = (day: number) => vi.setSystemTime(new Date(2026, 9, day, 7, 30));
const uid = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-${n.toString(16).padStart(12, "0")}`;
// A session done on a day of October from 6:00, `minutes` long, with `sets` work sets after a
// warm-up, recorded with the session it came from.
const doneOn = (
  n: number,
  code: string,
  sessionId: string,
  day: number,
  minutes = 52,
  sets = 19,
) => {
  const id = uid(n);
  const from = new Date(2026, 9, day, 6, 0).toISOString();
  const to = new Date(2026, 9, day, 6, minutes).toISOString();
  return [
    {
      kind: "workout",
      id,
      field: "start",
      sessionCode: code,
      sessionId,
      plan: [...sessionByCode(code, starterProgram)!.slots],
      startedAt: from,
      at: from,
    },
    ...Array.from({ length: sets + 1 }, (_, k): Change => ({
      kind: "set",
      id: uid(n * 0x100 + k),
      workoutId: id,
      field: "create",
      slotIndex: k === 0 ? 0 : (k - 1) % 6,
      position: k === 0 ? 1 : 3 + Math.floor((k - 1) / 6),
      exerciseId: "ds:0025",
      warmup: k === 0,
      weightKg: 60,
      reps: 8,
      rir: k === 0 ? null : 2,
      doneAt: from,
      at: from,
    })),
    { kind: "workout", id, field: "ended", value: to, at: to },
  ] satisfies Change[];
};

describe("Accueil on fixed days", () => {
  beforeEach(() => i18n.changeLanguage("fr"));

  it("a rest day shows Jour de repos, Prévu par ton programme and Demain : Séance B · Legs to B's preview from Accueil", async () => {
    morningOf(6);
    await fixedDays();
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Jour de repos$/);
    expect(within(region).getByRole("heading", { name: "Jour de repos" })).toBeTruthy();
    expect(region.textContent).toContain("Prévu par ton programme");
    expect(region.querySelector("svg.lucide-leaf")!.getAttribute("aria-hidden")).toBe("true");
    const next = within(region).getByRole("link", { name: "Demain\u202f: Séance B · Legs" });
    expect(next.getAttribute("href")).toBe("/workouts/session/B?from=home");
    expect(within(region).getAllByRole("link")).toHaveLength(1);
    expect(within(region).queryByRole("link", { name: "Voir la séance" })).toBeNull();
  });

  it("the link says Samedi 2 to 6 days on, Lundi 2 novembre 7 days on", async () => {
    morningOf(8);
    await fixedDays();
    fakeApi({ me: ADA });
    renderRoute("/");
    let region = await card(/^Jour de repos$/);
    expect(
      within(region).getByRole("link", {
        name: "Samedi\u202f: Séance C · Fessiers + tirage léger",
      }),
    ).toBeTruthy();
    cleanup();
    // Monday only, A done this morning: the next Monday is a week on.
    morningOf(26);
    await fixedDays([PUSH, null, null, null, null, null, null]);
    await seed(ADA.id, doneOn(0x50, "A", PUSH, 26));
    renderRoute("/");
    region = await card(/^Séance A · Push$/);
    expect(
      within(region).getByRole("link", { name: "Lundi 2 novembre\u202f: Séance A · Push" }),
    ).toBeTruthy();
  });

  it("a session day shows Prévue ce mercredi with Voir la séance", async () => {
    morningOf(7);
    await fixedDays();
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Séance B · Legs$/);
    expect(region.textContent).toContain("Prévue ce mercredi · 7 exercices · environ 60\u00A0min");
    expect(region.textContent).not.toContain("La prochaine");
    const see = within(region).getByRole("link", { name: "Voir la séance" });
    expect(see.getAttribute("href")).toBe("/workouts/session/B?from=home");
    expect(within(region).getAllByRole("link")).toHaveLength(1);
  });

  it("today's session done yesterday shows the check, Faite hier · 52 min · 19 séries and the next day's link", async () => {
    morningOf(12);
    await fixedDays();
    await seed(ADA.id, doneOn(0x51, "A", PUSH, 11));
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Séance A · Push$/);
    expect(region.querySelector("svg.lucide-check")).toBeTruthy();
    expect(region.textContent).toContain("Faite hier · 52\u00A0min · 19 séries");
    const next = within(region).getByRole("link", { name: "Mercredi\u202f: Séance B · Legs" });
    expect(next.getAttribute("href")).toBe("/workouts/session/B?from=home");
    expect(within(region).getAllByRole("link")).toHaveLength(1);
    expect(region.querySelector(".bg-primary")).toBeNull();
  });

  it("done two days before: Faite jeudi", async () => {
    morningOf(10);
    await fixedDays();
    await seed(ADA.id, doneOn(0x52, "C", GLUTES, 8, 40, 12));
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Séance C · /);
    expect(region.textContent).toContain("Faite jeudi · 40\u00A0min · 12 séries");
    expect(within(region).getByRole("link", { name: "Lundi\u202f: Séance A · Push" })).toBeTruthy();
  });

  it("done today on fixed days: the shipped card, its link Mercredi : Séance B · Legs", async () => {
    morningOf(12);
    await fixedDays();
    await seed(ADA.id, doneOn(0x53, "A", PUSH, 12, 48, 11));
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Séance A · Push$/);
    expect(region.textContent).toContain("Faite aujourd'hui · 48\u00A0min · 11 séries");
    expect(region.querySelector("svg.lucide-check")).toBeTruthy();
    const next = within(region).getByRole("link", { name: "Mercredi\u202f: Séance B · Legs" });
    expect(next.getAttribute("href")).toBe("/workouts/session/B?from=home");
    expect(region.textContent).not.toContain("La prochaine");
  });

  it("another session done on a session day: today's session stays next, and the link says so", async () => {
    morningOf(7);
    await fixedDays();
    await seed(ADA.id, doneOn(0x54, "A", PUSH, 7, 48, 11));
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Séance A · Push$/);
    expect(region.textContent).toContain("Faite aujourd'hui");
    expect(
      within(region).getByRole("link", { name: "Aujourd'hui\u202f: Séance B · Legs" }),
    ).toBeTruthy();
  });

  it("an open session wins on a rest day", async () => {
    // Monday A, Tuesday B, Saturday C: Wednesday 7 is a rest day, with A open this morning.
    await fixedDays([PUSH, LEGS, null, null, null, GLUTES, null]);
    await seed(ADA.id, OPEN_A);
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Séance A · Push$/);
    expect(region.textContent).toContain("En cours · 1 série sur 19");
    expect(screen.queryByRole("region", { name: "Jour de repos" })).toBeNull();
  });

  it("the day after a missed session day shows the same as any day", async () => {
    // B was not done on Wednesday: Thursday reads as it would had it been.
    morningOf(8);
    await fixedDays();
    fakeApi({ me: ADA });
    renderRoute("/");
    const missed = (await card(/^Jour de repos$/)).textContent;
    cleanup();
    await seed(ADA.id, doneOn(0x55, "B", LEGS, 7));
    renderRoute("/");
    const kept = (await card(/^Jour de repos$/)).textContent;
    expect(missed).toBe(kept);
    expect(missed).toBe(
      "Jour de repos Prévu par ton programmeSamedi\u202f: Séance C · Fessiers + tirage léger",
    );
    expect(missed).not.toMatch(/retard|manqu|Séance B/);
  });

  it("a set-aside session's day is a rest day", async () => {
    morningOf(7);
    await fixedDays();
    await edit((p) => setAside(p, LEGS, EDIT_AT));
    fakeApi({ me: ADA });
    renderRoute("/");
    const region = await card(/^Jour de repos$/);
    // C is lettered B once Legs leaves the rotation; its day stays Saturday.
    expect(
      within(region).getByRole("link", {
        name: "Samedi\u202f: Séance B · Fessiers + tirage léger",
      }),
    ).toBeTruthy();
  });

  it("in English: Rest day, Planned for Wednesday, Done yesterday, Tomorrow: Session B · Legs", async () => {
    await i18n.changeLanguage("en");
    morningOf(6);
    await fixedDays();
    fakeApi({ me: ADA });
    renderRoute("/");
    let region = await card(/^Rest day$/);
    expect(region.textContent).toContain("Planned by your program");
    expect(within(region).getByRole("link", { name: "Tomorrow: Session B · Legs" })).toBeTruthy();
    cleanup();
    morningOf(7);
    renderRoute("/");
    region = await card(/^Session B · Legs$/);
    expect(region.textContent).toContain("Planned for Wednesday · 7 exercises");
    cleanup();
    morningOf(12);
    await seed(ADA.id, doneOn(0x56, "A", PUSH, 11));
    renderRoute("/");
    region = await card(/^Session A · Push$/);
    expect(region.textContent).toContain("Done yesterday · 52\u00A0min · 19 sets");
    expect(within(region).getByRole("link", { name: "Wednesday: Session B · Legs" })).toBeTruthy();
  });
});
