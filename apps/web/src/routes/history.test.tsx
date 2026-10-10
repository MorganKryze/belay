import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readOutbox } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";

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
  await i18n.changeLanguage("en");
});

const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d${String(n).padStart(2, "0")}`;
// A session started at `start` (the phone's local time), its sets, and its end `minutes` later.
function session(
  n: number,
  code: string,
  start: Date,
  minutes: number | null,
  sets: [slotIndex: number, position: number, kg: number, reps: number, rir: number | null][] = [],
): Change[] {
  const startedAt = start.toISOString();
  const end = minutes === null ? null : new Date(start.getTime() + minutes * 60_000).toISOString();
  const at = end ?? startedAt;
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
    ...sets.map(([slotIndex, position, weightKg, reps, rir], i): Change => ({
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
      rir,
      doneAt: startedAt,
      at: startedAt,
    })),
    ...(end ? [{ kind: "workout", id: id(n), field: "ended", value: end, at } as Change] : []),
  ];
}

const MONTH: Change[] = [
  ...session(1, "A", new Date(2026, 9, 2, 18, 0), 64),
  ...session(2, "B", new Date(2026, 9, 5, 18, 0), 58, [
    [0, 0, 60, 5, null],
    [0, 3, 100, 5, 2],
    [0, 4, 100, 5, 4],
  ]),
  // Begun at 23:30 on the 6th, finished at 00:40 on the 7th: it stays on the 6th.
  ...session(3, "C", new Date(2026, 9, 6, 23, 30), 70),
  ...session(4, "A", new Date(2026, 9, 3, 18, 0), 50),
  { kind: "workout", id: id(4), field: "removed", value: true, at: "2026-10-04T08:00:00.000Z" },
  ...session(5, "A", new Date(2026, 9, 7, 7, 0), null), // in progress
];

const marked = (calendar: HTMLElement) =>
  within(calendar)
    .getAllByText(", session")
    .map((s) => s.parentElement!.textContent!.replace(", session", ""));

describe("the History segment", () => {
  it("asks to sign in when there is no account", async () => {
    fakeApi({ me: null });
    localStorage.clear();
    renderRoute("/workouts?tab=history");
    expect(await screen.findByText(/Your sessions are kept with an account/)).toBeTruthy();
  });

  it("marks the days with a finished session, and lists the month newest first", async () => {
    await seed(ADA.id, MONTH);
    fakeApi({ me: ADA });
    renderRoute("/workouts?tab=history");
    const calendar = await screen.findByRole("table", { name: "October 2026" });
    await waitFor(() => expect(marked(calendar)).toEqual(["2", "5", "6"]));
    const list = screen.getByRole("region", { name: "Recent" });
    expect(
      within(list)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual([
      "Tue, Oct 6Session C · Glutes + light pull1 h 10",
      "Mon, Oct 5Session B · Legs58 min",
      "Fri, Oct 2Session A · Push1 h 04",
    ]);
  });

  it("goes back a month, never past the current one", async () => {
    await seed(ADA.id, [...MONTH, ...session(6, "C", new Date(2026, 8, 28, 18, 0), 45)]);
    fakeApi({ me: ADA });
    renderRoute("/workouts?tab=history");
    await screen.findByRole("table", { name: "October 2026" });
    expect((screen.getByRole("button", { name: "Next month" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    const calendar = await screen.findByRole("table", { name: "September 2026" });
    expect(marked(calendar)).toEqual(["28"]);
    const list = screen.getByRole("region", { name: "September 2026" });
    expect(within(list).getByRole("link").textContent).toContain("45 min");
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(await screen.findByText("No session this month.")).toBeTruthy();
  });

  it("says where the first session will be", async () => {
    fakeApi({ me: ADA });
    renderRoute("/workouts?tab=history");
    expect(await screen.findByText("Your first session will show here.")).toBeTruthy();
  });
});

describe("a session's detail", () => {
  it("shows its sets as done, and deletes it whole after asking", async () => {
    const notes: Change[] = [
      {
        kind: "workout",
        id: id(2),
        field: "note",
        value: "Bonne énergie",
        at: "2026-10-05T17:00:00.000Z",
      },
      {
        kind: "workout",
        id: id(2),
        field: "exerciseNotes",
        value: { "0": "Talons surélevés" },
        at: "2026-10-05T17:00:00.000Z",
      },
    ];
    await seed(ADA.id, [...MONTH, ...notes]);
    const api = fakeApi({ me: ADA });
    renderRoute("/workouts?tab=history");
    fireEvent.click(await screen.findByRole("link", { name: /Session B · Legs/ }));
    expect(await screen.findByRole("heading", { name: "Session B · Legs", level: 1 })).toBeTruthy();
    expect(screen.getByText(/Mon, Oct 5 · 58 min · 2 work sets · 1,000 kg/)).toBeTruthy();
    const squat = screen.getByRole("region", { name: "Barbell full squat" });
    expect(
      within(squat)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Warm-up60 kg × 5", "1100 kg × 5 · RIR 2", "2100 kg × 5 · RIR 4+"]);
    expect(within(squat).getByText("Talons surélevés")).toBeTruthy();
    expect(screen.getByText("Bonne énergie")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete this session" }));
    const sheet = await screen.findByRole("dialog", { name: "Delete this session?" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Delete" }));
    const calendar = await screen.findByRole("table", { name: "October 2026" });
    await waitFor(() => expect(marked(calendar)).toEqual(["2", "6"]));
    // Still queued, or already sent: the opening sync, if still going, takes it along.
    const db = await openAccountDb(ADA.id);
    const recorded = [
      ...api.requests.flatMap((r) => r.changes),
      ...(await readOutbox(db)).map((e) => e.change),
    ];
    expect(recorded.at(-1)).toMatchObject({
      kind: "workout",
      id: id(2),
      field: "removed",
      value: true,
    });
    db.close();
  });

  it("says it in French", async () => {
    await seed(ADA.id, MONTH);
    await i18n.changeLanguage("fr");
    fakeApi({ me: ADA });
    renderRoute(`/workouts/${id(2)}`);
    expect(await screen.findByRole("heading", { name: "Séance B · Legs", level: 1 })).toBeTruthy();
    expect(
      screen.getByText(/Lun\. 5 oct\. · 58 min · 2 séries de travail · 1\s000 kg/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Supprimer cette séance" }));
    expect(await screen.findByRole("dialog", { name: "Supprimer cette séance ?" })).toBeTruthy();
  });

  it("is not found for a session removed or still in progress", async () => {
    await seed(ADA.id, MONTH);
    fakeApi({ me: ADA });
    renderRoute(`/workouts/${id(4)}`);
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeTruthy();
    cleanup();
    renderRoute(`/workouts/${id(5)}`);
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeTruthy();
  });
});
