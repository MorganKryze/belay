import type { Change } from "@belay/shared/sync/schema";
import { nextSession, sessionByCode } from "@belay/shared/training/program";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readHistory, readOutbox } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";

// Wednesday 7 October 2026, 18:00 on the phone's clock.
beforeEach(() => {
  indexedDB = new IDBFactory();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 7, 18, 0));
  writeLastUser(ADA);
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d${String(n).padStart(2, "0")}`;
// A finished session started at `start` (local time), its sets, and its end `minutes` later.
function session(
  n: number,
  code: string,
  start: Date,
  minutes: number,
  sets: [slotIndex: number, position: number, kg: number, reps: number][] = [],
): Change[] {
  const startedAt = start.toISOString();
  const end = new Date(start.getTime() + minutes * 60_000).toISOString();
  const plan = [...sessionByCode(code)!.slots];
  return [
    {
      kind: "workout",
      id: id(n),
      field: "start",
      sessionCode: code,
      plan,
      startedAt,
      at: startedAt,
    },
    ...sets.map(([slotIndex, position, weightKg, reps], i): Change => ({
      kind: "set",
      id: id(n * 10 + i),
      workoutId: id(n),
      field: "create",
      slotIndex,
      position,
      exerciseId: plan[slotIndex]!.exerciseId,
      warmup: position < 3,
      weightKg,
      reps,
      seconds: null,
      rir: position < 3 ? null : 2,
      doneAt: startedAt,
      at: startedAt,
    })),
    { kind: "workout", id: id(n), field: "ended", value: end, at: end },
  ];
}
// B on Thursday the 1st (100 × 5), then B on Monday the 5th (100 × 5, 100 × 5).
const PAST: Change[] = [
  ...session(1, "B", new Date(2026, 9, 1, 18, 0), 60, [[0, 3, 100, 5]]),
  ...session(2, "B", new Date(2026, 9, 5, 18, 0), 58, [
    [0, 3, 100, 5],
    [0, 4, 100, 5],
  ]),
];
const climb: Change = {
  kind: "activity",
  id: id(80),
  field: "fields",
  date: "2026-10-03",
  type: "climbing",
  durationMin: 90,
  cardioType: null,
  climbStyle: "boulder",
  climbRuns: 14,
  climbGrade: "6b+",
  climbColor: null,
  at: "2026-10-03T18:00:00.000Z",
};
const stored = async () => {
  const db = await openAccountDb(ADA.id);
  const result = { history: await readHistory(db), outbox: await readOutbox(db) };
  db.close();
  return result;
};
const slot = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name}`) });
const cell = (scope: HTMLElement, name: string) =>
  within(scope).getByRole("textbox", { name }) as HTMLInputElement;

describe("History with activities (spec §4.4)", () => {
  it("circles the days with an activity, lists it with the sessions, and reopens it", async () => {
    await seed(ADA.id, [...PAST, climb]);
    fakeApi({ me: ADA });
    renderRoute("/workouts?tab=history");
    const calendar = await screen.findByRole("table", { name: "October 2026" });
    await waitFor(() => expect(within(calendar).getAllByText(", activity")).toHaveLength(1));
    expect(within(calendar).getByText(", activity").parentElement!.textContent).toBe("3, activity");
    expect(screen.getByText("● session · ○ activity")).toBeTruthy();
    const list = screen.getByRole("region", { name: "Recent" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      "Mon, Oct 5Session B · Legs58 min",
      "Sat, Oct 3Climbing · 1 h 30 · 6b+",
      "Thu, Oct 1Session B · Legs1 h 00",
    ]);
    fireEvent.click(within(list).getByRole("button", { name: /Climbing/ }));
    const sheet = await screen.findByRole("dialog", { name: "Activity" });
    expect((within(sheet).getByLabelText("Date of the activity") as HTMLInputElement).value).toBe(
      "2026-10-03",
    );
    expect(within(sheet).getByRole("radio", { name: "Climbing · 1 h 30 · 6b+" })).toBeTruthy();
  });
});

describe("a session logged afterwards (spec D10)", () => {
  it("opens the editor for the day and session chosen, then files the session there", async () => {
    await seed(ADA.id, PAST);
    fakeApi({ me: ADA });
    renderRoute("/workouts?tab=history");
    fireEvent.click(await screen.findByRole("button", { name: "Log a session" }));
    const sheet = await screen.findByRole("dialog", { name: "Log a session" });
    // The next session of the program, and its estimated duration.
    expect(within(sheet).getByRole("radio", { name: "C" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    fireEvent.click(within(sheet).getByRole("radio", { name: "B" }));
    expect(within(sheet).getByText("Session B · Legs")).toBeTruthy();
    expect(within(sheet).getByRole("spinbutton", { name: "Duration" }).textContent).toBe("1 h");
    fireEvent.change(within(sheet).getByLabelText("Date of the session"), {
      target: { value: "2026-10-06" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Enter the sets" }));
    expect(await screen.findByRole("heading", { name: "Session B · Legs", level: 1 })).toBeTruthy();
    expect(screen.queryByRole("timer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Barbell full squat/ }));
    fireEvent.click(within(slot("Barbell full squat")).getByRole("button", { name: "+ Set" }));
    const squat = slot("Barbell full squat");
    // Prefilled from last time, then corrected.
    expect(cell(squat, "Load of set 1, kg").value).toBe("100");
    fireEvent.change(cell(squat, "Reps of set 1"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Tue, Oct 6 · 1 h 00 · 1 work set/)).toBeTruthy();
    expect(screen.getByText("Record: Barbell full squat, 100 kg × 6")).toBeTruthy();
    const logged = (await stored()).history.workouts.find(
      (w) => w.sessionCode === "B" && w.id !== id(1) && w.id !== id(2),
    )!;
    expect(logged).toMatchObject({
      startedAt: new Date(2026, 9, 6, 12, 0).toISOString(),
      endedAt: new Date(2026, 9, 6, 13, 0).toISOString(),
    });
  });

  it("files a second session on a day that already has one, without changing what comes next", async () => {
    await seed(ADA.id, PAST);
    fakeApi({ me: ADA });
    renderRoute("/workout/edit?code=A&date=2026-10-05&minutes=45");
    fireEvent.click(await screen.findByRole("button", { name: /^Barbell bench press/ }));
    fireEvent.click(within(slot("Barbell bench press")).getByRole("button", { name: "+ Set" }));
    const bench = slot("Barbell bench press");
    fireEvent.change(cell(bench, "Load of set 1, kg"), { target: { value: "60" } });
    fireEvent.change(cell(bench, "Reps of set 1"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Mon, Oct 5 · 45 min/);
    cleanup();
    renderRoute("/workouts?tab=history");
    const list = await screen.findByRole("region", { name: "Recent" });
    expect(
      within(list)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual([
      "Mon, Oct 5Session B · Legs58 min",
      "Mon, Oct 5Session A · Push45 min",
      "Thu, Oct 1Session B · Legs1 h 00",
    ]);
    // Begun at noon, before Monday's B at 18:00: B stays the last one, C comes next.
    expect(nextSession((await stored()).history.workouts)).toBe("C");
  });
});

describe("correcting a finished session (spec D9)", () => {
  it("corrects a set, removes one, adds one, and the record follows", async () => {
    await seed(ADA.id, PAST);
    fakeApi({ me: ADA });
    renderRoute(`/workouts/${id(2)}`);
    fireEvent.click(await screen.findByRole("link", { name: "Edit" }));
    expect(
      await screen.findByText(
        "Correcting changes only what you edit; the records are worked out again.",
      ),
    ).toBeTruthy();
    const squat = slot("Barbell full squat");
    fireEvent.change(cell(squat, "Load of set 1, kg"), { target: { value: "105" } });
    fireEvent.click(within(squat).getByRole("button", { name: "Delete set 2" }));
    fireEvent.click(within(squat).getByRole("button", { name: "+ Set" }));
    fireEvent.change(cell(slot("Barbell full squat"), "Reps of set 3"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Record: Barbell full squat, 105 kg × 5")).toBeTruthy();
    const sets = (await stored()).history.sets.filter((s) => s.workoutId === id(2));
    expect(sets.map((s) => [s.position, s.weightKg, s.reps, s.removed])).toEqual([
      [3, 105, 5, false],
      [4, 100, 5, true],
      [5, 105, 3, false],
    ]);
  });

  it("moves the session to another day, across a week, keeping its time and its plan", async () => {
    await seed(ADA.id, PAST);
    fakeApi({ me: ADA });
    renderRoute(`/workout/edit?id=${id(2)}`);
    fireEvent.change(await screen.findByLabelText("Date of the session"), {
      target: { value: "2026-09-28" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Mon, Sep 28 · 58 min/)).toBeTruthy();
    const moved = (await stored()).history.workouts.find((w) => w.id === id(2))!;
    expect(moved.startedAt).toBe(new Date(2026, 8, 28, 18, 0).toISOString());
    expect(moved.plan).toEqual(sessionByCode("B")!.slots);
    // Thursday's B is now the last one.
    expect(nextSession((await stored()).history.workouts)).toBe("C");
  });

  it("writes nothing when cancelled", async () => {
    await seed(ADA.id, PAST);
    fakeApi({ me: ADA, sync: () => new Response(null, { status: 500 }) });
    renderRoute(`/workout/edit?id=${id(2)}`);
    const squat = await waitFor(() => slot("Barbell full squat"));
    const before = (await stored()).outbox.length;
    fireEvent.change(cell(squat, "Load of set 1, kg"), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
    expect(await screen.findByRole("heading", { name: "Session B · Legs", level: 1 })).toBeTruthy();
    expect((await stored()).outbox.length).toBe(before);
    expect((await stored()).history.sets.find((s) => s.id === id(20))?.weightKg).toBe(100);
  });

  it("refuses to save an incomplete set", async () => {
    await seed(ADA.id, PAST);
    fakeApi({ me: ADA });
    renderRoute(`/workout/edit?id=${id(2)}`);
    const squat = await waitFor(() => slot("Barbell full squat"));
    fireEvent.change(cell(squat, "Reps of set 1"), { target: { value: "" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Fill in or remove the sets left incomplete.")).toBeTruthy();
  });

  it("says it in French", async () => {
    await seed(ADA.id, PAST);
    await i18n.changeLanguage("fr");
    fakeApi({ me: ADA });
    renderRoute(`/workout/edit?id=${id(2)}`);
    expect(await screen.findByRole("link", { name: "Annuler" })).toBeTruthy();
    expect(
      screen.getByText("Corriger ne change que ce que tu modifies ; les records se recalculent.", {
        normalizer: (s) => s,
      }),
    ).toBeTruthy();
    expect(
      within(slot("Barbell full squat")).getByRole("button", { name: "Supprimer la série 1" }),
    ).toBeTruthy();
  });
});
