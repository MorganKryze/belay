import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readHistory } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";

// The real clock: the dates below are set from it.
beforeEach(() => {
  indexedDB = new IDBFactory();
  writeLastUser(ADA);
  fakeApi({ me: ADA });
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e${String(n).padStart(2, "0")}`;
const daysAgo = (days: number, hours = 18, minutes = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
};

type Logged = readonly [slotIndex: number, exerciseId: string, kg: number, reps: number];
// A session A of `days` ago, 48 minutes long, with its sets (and a warm-up when asked).
function session(n: number, days: number, sets: readonly Logged[], warmup = false): Change[] {
  const start = daysAgo(days);
  const end = daysAgo(days, 18, 48);
  let next = 0;
  return [
    {
      kind: "workout",
      id: id(n),
      field: "start",
      sessionCode: "A",
      plan: [...sessionByCode("A")!.slots],
      startedAt: start,
      at: start,
    },
    ...(warmup
      ? [
          {
            kind: "set",
            id: id(n * 20 + 19),
            workoutId: id(n),
            field: "create",
            slotIndex: 0,
            position: 0,
            exerciseId: "ds:0025",
            warmup: true,
            weightKg: 40,
            reps: 8,
            rir: null,
            doneAt: start,
            at: start,
          } satisfies Change,
        ]
      : []),
    ...sets.map(([slotIndex, exerciseId, weightKg, reps]): Change => ({
      kind: "set",
      id: id(n * 20 + next),
      workoutId: id(n),
      field: "create",
      slotIndex,
      position: 3 + next++,
      exerciseId,
      warmup: false,
      weightKg,
      reps,
      rir: 1,
      doneAt: start,
      at: start,
    })),
    { kind: "workout", id: id(n), field: "ended", value: end, at: end },
  ];
}

// 11 work sets, 5 870 kg: the bench press 4 sets, best 80 kg × 8; one lateral raise set.
const DONE = session(2, 1, [
  [0, "ds:0025", 80, 8],
  [0, "ds:0025", 80, 7],
  [0, "ds:0025", 80, 7],
  [0, "ds:0025", 77.5, 8],
  [1, "ds:0405", 30, 10],
  [1, "ds:0405", 30, 10],
  [1, "ds:0405", 30, 10],
  [2, "ds:0739", 120, 10],
  [2, "ds:0739", 120, 10],
  [3, "ds:0334", 10, 15],
  [5, "ds:0605", 20, 2],
]);
const URL = `/workout/summary/${id(2)}`;
const WEEKDAY = "(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)";

describe("the summary", () => {
  it("the summary reads as the session's own page", async () => {
    await seed(ADA.id, DONE);
    renderRoute(URL);
    expect(await screen.findByRole("heading", { level: 1, name: "Session A · Push" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    expect(screen.getByText(new RegExp(`^Session done · ${WEEKDAY}, \\S+ \\d+$`))).toBeTruthy();
    const figures = screen.getByText("Duration").closest("dl")!;
    expect(figures.textContent).toContain("Duration48 min");
    expect(figures.textContent).toContain("Sets11");
    expect(figures.textContent).toContain("Volume5,870 kg");
    const logged = screen.getByRole("region", { name: "What you logged" });
    const rows = within(logged).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(rows[0]!.textContent).toContain("Barbell bench press");
    expect(rows[0]!.textContent).toContain("4 sets · best 80 kg × 8");
    expect(rows[3]!.textContent).toContain("1 set · 10 kg × 15");
    expect(within(rows[3]!).getByText("4")).toBeTruthy();
  });

  it("reads in French with the narrow space of the volume", async () => {
    await seed(ADA.id, DONE);
    await i18n.changeLanguage("fr");
    renderRoute(URL);
    const logged = await screen.findByRole("region", { name: "Ce que tu as noté" });
    expect(screen.getByRole("button", { name: "Fermer" })).toBeTruthy();
    expect(screen.getByText(/^Séance terminée · /)).toBeTruthy();
    const figures = screen.getByText("Durée").closest("dl")!;
    expect(figures.textContent).toContain("Séries11");
    expect(figures.textContent).toContain("Volume5 870 kg");
    expect(logged.textContent).toContain("4 séries · meilleure 80 kg × 8");
    expect(logged.textContent).toContain("1 série · 10 kg × 15");
  });

  it("records, the warm-up count, the note and Save are still there", async () => {
    await seed(ADA.id, [
      ...session(1, 5, [[0, "ds:0025", 75, 8]]),
      ...session(3, 1, [[0, "ds:0025", 80, 8]], true),
    ]);
    renderRoute(`/workout/summary/${id(3)}`);
    expect(await screen.findByText("Record: Barbell bench press, 80 kg × 8")).toBeTruthy();
    expect(screen.getByText("Warm-ups left out · 1 set")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Session note (optional)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("Save keeps the note and goes Home", async () => {
    await seed(ADA.id, DONE);
    renderRoute(URL);
    fireEvent.change(await screen.findByRole("textbox", { name: "Session note (optional)" }), {
      target: { value: "Bonne énergie" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { name: "Hello, Ada", level: 1 })).toBeTruthy();
    await waitFor(async () => {
      const db = await openAccountDb(ADA.id);
      const { workouts } = await readHistory(db);
      db.close();
      expect(workouts.find((w) => w.id === id(2))?.note).toBe("Bonne énergie");
    });
  });
});
