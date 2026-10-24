import type { Change } from "@belay/shared/sync/schema";
import {
  addSession,
  addSlot,
  chooseActive,
  createProgram,
  placeSession,
} from "@belay/shared/training/program-edits";
import { sessionByCode } from "@belay/shared/training/program";
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
      plan: [...(sessionByCode(code) ?? sessionByCode("A")!).slots],
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
