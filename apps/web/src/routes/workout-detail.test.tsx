import type { Change } from "@belay/shared/sync/schema";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readOutbox } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";
import { MONTH, id, marked, session } from "../test/workout-fixtures";

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

  it("numbers the work sets from 1 for each exercise, one replaced mid-session included", async () => {
    const base = session(7, "B", new Date(2026, 9, 5, 18, 0), 58, [[0, 3, 100, 5, 2]]);
    const replaced: Change[] = [4, 5].map((position, i) => ({
      kind: "set",
      id: id(79 + i),
      workoutId: id(7),
      field: "create",
      slotIndex: 0,
      position,
      exerciseId: "ds:1760",
      warmup: false,
      weightKg: 24,
      reps: 10,
      rir: 2,
      doneAt: "2026-10-05T16:30:00.000Z",
      at: "2026-10-05T16:30:00.000Z",
    }));
    await seed(ADA.id, [...base, ...replaced]);
    fakeApi({ me: ADA });
    renderRoute("/workouts?tab=history");
    fireEvent.click(await screen.findByRole("link", { name: /Session B · Legs/ }));
    const numbers = async (name: string) =>
      within(await screen.findByRole("region", { name }))
        .getAllByRole("listitem")
        .map((li) => li.firstElementChild!.textContent);
    expect(await numbers("Barbell full squat")).toEqual(["1"]);
    expect(await numbers("Dumbbell goblet squat")).toEqual(["1", "2"]);
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

  it("Edit sits in the bar and opens the editor", async () => {
    await seed(ADA.id, MONTH);
    fakeApi({ me: ADA });
    renderRoute(`/workouts/${id(2)}`);
    await screen.findByRole("heading", { name: "Session B · Legs", level: 1 });
    const edit = screen.getByRole("link", { name: "Edit" });
    const bar = document.querySelector("[data-compact-title]")!.parentElement!;
    expect(bar.contains(edit)).toBe(true);
    expect(edit.getAttribute("href")).toBe(`/workout/edit?id=${id(2)}`);
    fireEvent.click(edit);
    expect(
      await screen.findByText(
        "Correcting changes only what you edit; the records are worked out again.",
      ),
    ).toBeTruthy();
  });

  it("the back link says History and opens the history segment", async () => {
    await seed(ADA.id, MONTH);
    fakeApi({ me: ADA });
    renderRoute(`/workouts/${id(2)}`);
    await screen.findByRole("heading", { name: "Session B · Legs", level: 1 });
    fireEvent.click(screen.getByRole("link", { name: "History" }));
    expect(await screen.findByRole("table", { name: "October 2026" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "History", checked: true })).toBeTruthy();
  });
});
