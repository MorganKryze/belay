import type { Change } from "@belay/shared/sync/schema";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readOutbox, recordChanges } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";
import { MONTH, id, marked, session } from "../test/workout-fixtures";

vi.mock("../sync/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../sync/db")>();
  return { ...real, recordChanges: vi.fn(real.recordChanges) };
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
  await i18n.changeLanguage("en");
});

// The strip under the title, as [label, figure] per column.
const strip = () =>
  [...screen.getByText(/^(Duration|Durée)$/).closest("dl")!.children].map((c) => [
    c.querySelector("dt")!.textContent,
    c.querySelector("dd")!.textContent,
  ]);

// The number drawn in a card's tile, hidden from screen readers as the heading says the name.
const tile = (card: HTMLElement) => card.querySelector("[aria-hidden]")?.textContent;

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
    expect(screen.getByText(/^Monday, October 5 · 6:00\sPM$/)).toBeTruthy();
    const squat = screen.getByRole("region", { name: "Barbell full squat" });
    expect(
      within(squat)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Warm-up60 kg × 5", "1100 kg × 5RIR 2", "2100 kg × 5RIR 4+"]);
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

  it("opens on its day and start time", async () => {
    await seed(ADA.id, MONTH);
    fakeApi({ me: ADA });
    renderRoute(`/workouts/${id(2)}`);
    await screen.findByRole("heading", { name: "Session B · Legs", level: 1 });
    const line = screen.getByText(/^Monday, October 5 · 6:00\sPM$/);
    // Right under the title, before the strip.
    const title = screen.getByRole("heading", { level: 1 });
    expect(line.previousElementSibling!.contains(title)).toBe(true);
    expect(line.compareDocumentPosition(screen.getByText("Duration").closest("dl")!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("the strip reads Duration 58 min, Sets 2, Volume 1,000 kg", async () => {
    await seed(ADA.id, MONTH);
    fakeApi({ me: ADA });
    renderRoute(`/workouts/${id(2)}`);
    await screen.findByRole("heading", { name: "Session B · Legs", level: 1 });
    // The warm-up at 60 kg × 5 is left out of the sets and the volume.
    expect(strip()).toEqual([
      ["Duration", "58 min"],
      ["Sets", "2"],
      ["Volume", "1,000 kg"],
    ]);
  });

  it("from an hour the duration stays whole", async () => {
    await seed(ADA.id, MONTH);
    fakeApi({ me: ADA });
    renderRoute(`/workouts/${id(1)}`);
    await screen.findByRole("heading", { name: "Session A · Push", level: 1 });
    expect(strip()[0]).toEqual(["Duration", "1 h 04"]);
  });

  it("with the volume hidden on this device the strip keeps Duration and Sets", async () => {
    localStorage.setItem("belay.sessionVolume", "hidden");
    await seed(ADA.id, MONTH);
    fakeApi({ me: ADA });
    renderRoute(`/workouts/${id(2)}`);
    await screen.findByRole("heading", { name: "Session B · Legs", level: 1 });
    expect(strip()).toEqual([
      ["Duration", "58 min"],
      ["Sets", "2"],
    ]);
    expect(screen.queryByText("Volume")).toBeNull();
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
    // Two cards, so two tiles: the replaced exercise reads as the second one.
    expect(tile(screen.getByRole("region", { name: "Barbell full squat" }))).toBe("1");
    expect(tile(screen.getByRole("region", { name: "Dumbbell goblet squat" }))).toBe("2");
  });

  it("each exercise is one card: its number, name and prescription, then its sets", async () => {
    await seed(ADA.id, MONTH);
    fakeApi({ me: ADA });
    renderRoute(`/workouts/${id(2)}`);
    const squat = await screen.findByRole("region", { name: "Barbell full squat" });
    expect(within(squat).getByRole("heading", { level: 3 }).textContent).toBe("Barbell full squat");
    // The session's own plan: four sets of 5 to 8 at RIR 2.
    expect(within(squat).getByText("4 × 5–8 · RIR 2")).toBeTruthy();
    expect(tile(squat)).toBe("1");
    expect(
      within(squat)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Warm-up60 kg × 5", "1100 kg × 5RIR 2", "2100 kg × 5RIR 4+"]);
  });

  it("a timed set reads 45 s, a loaded one 10 kg · 45 s", async () => {
    const base = session(7, "B", new Date(2026, 9, 5, 18, 0), 58);
    const timed: Change[] = [0, 10].map((weightKg, i) => ({
      kind: "set",
      id: id(70 + i),
      workoutId: id(7),
      field: "create",
      slotIndex: 0,
      position: 3 + i,
      exerciseId: "ds:0043",
      warmup: false,
      weightKg,
      reps: null,
      seconds: 45,
      rir: null,
      doneAt: "2026-10-05T16:30:00.000Z",
      at: "2026-10-05T16:30:00.000Z",
    }));
    await seed(ADA.id, [...base, ...timed]);
    fakeApi({ me: ADA });
    renderRoute(`/workouts/${id(7)}`);
    const squat = await screen.findByRole("region", { name: "Barbell full squat" });
    expect(
      within(squat)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["145 s", "210 kg · 45 s"]);
  });

  it("the note sits under the last card of its slot", async () => {
    const base = session(7, "B", new Date(2026, 9, 5, 18, 0), 58, [[0, 3, 100, 5, 2]]);
    const replaced: Change = {
      kind: "set",
      id: id(79),
      workoutId: id(7),
      field: "create",
      slotIndex: 0,
      position: 4,
      exerciseId: "ds:1760",
      warmup: false,
      weightKg: 24,
      reps: 10,
      rir: 2,
      doneAt: "2026-10-05T16:30:00.000Z",
      at: "2026-10-05T16:30:00.000Z",
    };
    const note: Change = {
      kind: "workout",
      id: id(7),
      field: "exerciseNotes",
      value: { "0": "Genou sensible" },
      at: "2026-10-05T17:00:00.000Z",
    };
    await seed(ADA.id, [...base, replaced, note]);
    fakeApi({ me: ADA });
    renderRoute(`/workouts/${id(7)}`);
    const goblet = await screen.findByRole("region", { name: "Dumbbell goblet squat" });
    const squat = screen.getByRole("region", { name: "Barbell full squat" });
    expect(within(squat).queryByText("Genou sensible")).toBeNull();
    const text = within(goblet).getByText("Genou sensible");
    // Under the sets, not between them.
    expect(goblet.lastElementChild).toBe(text);
    expect(within(goblet).getByRole("list").compareDocumentPosition(text)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("Exercises heads the cards", async () => {
    await seed(ADA.id, MONTH);
    fakeApi({ me: ADA });
    renderRoute(`/workouts/${id(2)}`);
    const squat = await screen.findByRole("region", { name: "Barbell full squat" });
    const header = screen.getByRole("heading", { name: "Exercises", level: 2 });
    expect(header.compareDocumentPosition(squat)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("Delete this session is a red row of its own at the page's end and still asks first", async () => {
    await seed(ADA.id, MONTH);
    fakeApi({ me: ADA });
    renderRoute(`/workouts/${id(2)}`);
    await screen.findByRole("region", { name: "Barbell full squat" });
    const remove = screen.getByRole("button", { name: "Delete this session" });
    const group = remove.closest("ul")!;
    expect(within(group).getAllByRole("listitem")).toHaveLength(1);
    expect(within(group).getAllByRole("button")).toEqual([remove]);
    // Its group is the page's last block.
    const block = group.closest("section")!;
    const page = block.parentElement!;
    expect(page.lastElementChild).toBe(block);
    expect(page.contains(screen.getByRole("heading", { level: 1 }))).toBe(true);
    fireEvent.click(remove);
    expect(await screen.findByRole("dialog", { name: "Delete this session?" })).toBeTruthy();
  });

  it("a failed removal says so under the row", async () => {
    await seed(ADA.id, MONTH);
    fakeApi({ me: ADA });
    renderRoute(`/workouts/${id(2)}`);
    await screen.findByRole("region", { name: "Barbell full squat" });
    vi.mocked(recordChanges).mockRejectedValueOnce(new DOMException("lost", "InvalidStateError"));
    const remove = screen.getByRole("button", { name: "Delete this session" });
    fireEvent.click(remove);
    const sheet = await screen.findByRole("dialog", { name: "Delete this session?" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Delete" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Couldn't save on this phone. Try again.");
    expect(remove.closest("section")!.nextElementSibling).toBe(alert);
    expect(screen.getByRole("heading", { name: "Session B · Legs", level: 1 })).toBeTruthy();
  });

  it("says it in French", async () => {
    await seed(ADA.id, MONTH);
    await i18n.changeLanguage("fr");
    fakeApi({ me: ADA });
    renderRoute(`/workouts/${id(2)}`);
    expect(await screen.findByRole("heading", { name: "Séance B · Legs", level: 1 })).toBeTruthy();
    expect(screen.getByText("Lundi 5 octobre · 18 h 00")).toBeTruthy();
    expect(strip()).toEqual([
      ["Durée", "58 min"],
      ["Séries", "2"],
      ["Volume", "1\u202f000 kg"],
    ]);
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
