import { exerciseById } from "@belay/shared/exercises/catalog";
import { addSlot, replaceExercise } from "@belay/shared/training/program-edits";
import { type ProgramSlot, seedId } from "@belay/shared/training/stored-program";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { setHelp, setRestStyle } from "@/lib/editor-prefs";
import { openAccountDb, readOutbox, readPrograms, recordChanges } from "@/sync/db";
import { writeLastUser } from "@/sync/last-user";
import { fakeApi } from "@/test/fake-api";
import { renderRoute } from "@/test/render-route";
import { ADA } from "@/test/seed";

// A device that has synced before, so the page reads what it holds without waiting on a first
// sync.
beforeEach(async () => {
  indexedDB = new IDBFactory();
  const db = await openAccountDb(ADA.id);
  await db.put("meta", "1", "cursor");
  db.close();
  writeLastUser(ADA);
  fakeApi({ me: ADA });
  await i18n.changeLanguage("fr");
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

const A = seedId(1);
const BENCH = "ds:0025"; // 4 × 6–8, RIR 1–2, 2 min 30, 2 warm-ups, main
const PRESS = "ds:0405"; // 3 × 8–10, RIR 1–2, 2 min, 1 warm-up, main
const RAISE = "ds:0334"; // in a group, not its last: no rest of its own
const CALF = "ds:0605"; // the group's last, the session's last row
const PLANK = { id: "ds:2135", measure: "seconds" } as const;
const OLD = "2026-10-01T06:00:00.000Z";

const COLUMNS = { sets: 1, reps: 2, rir: 3, rest: 4, warmups: 5, main: 6 } as const;
type Column = keyof typeof COLUMNS;

const name = (exerciseId: string) => exerciseById(exerciseId)!.name;
const plain = (text: string | null | undefined) => (text ?? "").replace(/\s/g, " ");
const grid = () => screen.findByRole("grid");
const rowOf = (exerciseId: string) =>
  within(screen.getByRole("grid"))
    .getAllByRole("row")
    .find((r) => r.textContent?.includes(name(exerciseId)))!;
const cell = (exerciseId: string, column: Column) =>
  within(rowOf(exerciseId)).getAllByRole("gridcell")[COLUMNS[column]]!;
// What takes the focus in a cell: the cell itself, or Principal's checkbox.
const target = (exerciseId: string, column: Column) =>
  column === "main"
    ? within(cell(exerciseId, column)).getByRole("checkbox")
    : cell(exerciseId, column);
const shown = (exerciseId: string, column: Column) => plain(cell(exerciseId, column).textContent);
const field = () => within(screen.getByRole("grid")).getByRole("textbox") as HTMLInputElement;
const noField = () => within(screen.getByRole("grid")).queryByRole("textbox");
const key = (el: Element, k: string, init: Record<string, unknown> = {}) =>
  fireEvent.keyDown(el, { key: k, ...init });
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });

async function stored(exerciseId: string): Promise<ProgramSlot> {
  const db = await openAccountDb(ADA.id);
  const p = await readPrograms(db);
  db.close();
  return p.slots.find((s) => s.sessionId === A && s.exerciseId === exerciseId && !s.removed)!;
}
async function queued(): Promise<number> {
  const db = await openAccountDb(ADA.id);
  const n = (await readOutbox(db)).length;
  db.close();
  return n;
}
async function open() {
  renderRoute("/workouts/program");
  await grid();
}
// Long enough for a write that should not happen to land.
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
const onPlatform = (platform: string) =>
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);

describe("the slot grid", () => {
  it("one Tab stop; arrows move the focused cell", async () => {
    await open();
    const focusable = [...screen.getByRole("grid").querySelectorAll<HTMLElement>("[tabindex]")];
    expect(focusable.filter((el) => el.tabIndex === 0)).toEqual([target(BENCH, "sets")]);
    expect(focusable.length).toBe(6 * 6);
    target(BENCH, "sets").focus();
    key(document.activeElement!, "ArrowRight");
    expect(document.activeElement).toBe(target(BENCH, "reps"));
    key(document.activeElement!, "ArrowDown");
    expect(document.activeElement).toBe(target(PRESS, "reps"));
    key(document.activeElement!, "End");
    expect(document.activeElement).toBe(target(PRESS, "main"));
    key(document.activeElement!, "ArrowRight");
    expect(document.activeElement).toBe(target(PRESS, "main"));
    key(document.activeElement!, "Home");
    expect(document.activeElement).toBe(target(PRESS, "sets"));
    key(document.activeElement!, "ArrowUp");
    key(document.activeElement!, "ArrowUp");
    expect(document.activeElement).toBe(target(BENCH, "sets"));
    key(document.activeElement!, "ArrowRight");
    // The focused cell is now the grid's one stop.
    await waitFor(() => expect(target(BENCH, "reps").tabIndex).toBe(0));
    expect(target(BENCH, "sets").tabIndex).toBe(-1);
  });

  it("Enter opens with the value selected, typing replaces, Tab saves and opens the next, Enter saves and stays, Escape restores", async () => {
    await open();
    target(PRESS, "sets").focus();
    key(target(PRESS, "sets"), "Enter");
    expect(field().value).toBe("3");
    expect(document.activeElement).toBe(field());
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, 1]);
    type("4");
    key(field(), "Tab");
    // The next cell opens with its value, as the person would type it.
    await waitFor(() => expect(field().value).toBe("8-10"));
    expect(cell(PRESS, "reps").contains(field())).toBe(true);
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, 4]);
    await waitFor(async () => expect((await stored(PRESS)).sets).toBe(4));
    type("12");
    key(field(), "Escape");
    expect(noField()).toBeNull();
    expect(document.activeElement).toBe(target(PRESS, "reps"));
    expect(shown(PRESS, "reps")).toBe("8–10");
    expect((await stored(PRESS)).repRange).toEqual([8, 10]);
    key(target(PRESS, "reps"), "Enter");
    type("9");
    key(field(), "Enter");
    expect(noField()).toBeNull();
    expect(document.activeElement).toBe(target(PRESS, "reps"));
    await waitFor(() => expect(shown(PRESS, "reps")).toBe("9"));
    expect((await stored(PRESS)).repRange).toEqual([9, 9]);
    expect(shown(PRESS, "sets")).toBe("4");
    // Shift+Tab goes back; a click opens a cell too.
    key(target(PRESS, "reps"), "Enter");
    key(field(), "Tab", { shiftKey: true });
    await waitFor(() => expect(cell(PRESS, "sets").contains(field())).toBe(true));
    key(field(), "Escape");
    fireEvent.click(cell(BENCH, "rir"));
    expect(field().value).toBe("1-2");
  });

  it("« 6-10 » is saved as [6, 10] and shown « 6–10 »", async () => {
    await open();
    for (const [typed, range] of [
      ["6-10", [6, 10]],
      ["12 7", [7, 12]],
    ] as const) {
      key(target(BENCH, "reps"), "Enter");
      type(typed);
      key(field(), "Enter");
      await waitFor(async () => expect((await stored(BENCH)).repRange).toEqual(range));
    }
    await waitFor(() => expect(shown(BENCH, "reps")).toBe("7–12"));
  });

  it("a timed target is edited in seconds", async () => {
    const db = await openAccountDb(ADA.id);
    await recordChanges(db, addSlot(await readPrograms(db), seedId(0x1ff), A, PLANK, OLD)!);
    db.close();
    await open();
    key(target(PLANK.id, "reps"), "Enter");
    expect(field().value).toBe("30-60");
    type("45 90");
    key(field(), "Enter");
    await waitFor(() => expect(shown(PLANK.id, "reps")).toBe("45–90 s"));
    expect((await stored(PLANK.id)).repRange).toEqual([45, 90]);
  });

  it("« 2:30 » is saved as 150", async () => {
    await open();
    key(target(PRESS, "rest"), "Enter");
    expect(field().value).toBe("2:00");
    type("2:30");
    key(field(), "Enter");
    await waitFor(() => expect(shown(PRESS, "rest")).toBe("2 min 30"));
    expect((await stored(PRESS)).restSec).toBe(150);
    cleanup();
    setRestStyle("clock");
    await open();
    expect(shown(PRESS, "rest")).toBe("2:30");
    key(target(PRESS, "rest"), "Enter");
    type("95");
    key(field(), "Enter");
    await waitFor(() => expect(shown(PRESS, "rest")).toBe("1:35"));
  });

  it("a value out of bounds keeps the cell open with its error and writes nothing", async () => {
    await open();
    const before = await queued();
    const cases: [string, Column, string, string][] = [
      [BENCH, "sets", "11", "Entre 1 et 10"],
      [BENCH, "reps", "6-101", "Entre 1 et 100, par exemple 6-10"],
      [BENCH, "rir", "5", "Entre 0 et 4, par exemple 1-2"],
      [BENCH, "rest", "16 min", "Jusqu'à 15 min, par exemple 2:30"],
      [BENCH, "warmups", "four", "Entre 0 et 3"],
    ];
    for (const [exercise, column, typed, error] of cases) {
      key(target(exercise, column), "Enter");
      type(typed);
      key(field(), "Enter");
      expect(field().value).toBe(typed);
      expect(cell(exercise, column).contains(field())).toBe(true);
      const alert = within(cell(exercise, column)).getByRole("alert");
      expect(plain(alert.textContent)).toBe(error);
      expect(field().getAttribute("aria-invalid")).toBe("true");
      expect(field().getAttribute("aria-describedby")).toBe(alert.id);
      key(field(), "Tab");
      expect(cell(exercise, column).contains(field())).toBe(true);
      key(field(), "Escape");
      expect(noField()).toBeNull();
    }
    expect(await queued()).toBe(before);
    expect((await stored(BENCH)).sets).toBe(4);
  });

  it("a timed exercise takes no warm-up", async () => {
    const db = await openAccountDb(ADA.id);
    await recordChanges(db, addSlot(await readPrograms(db), seedId(0x1ff), A, PLANK, OLD)!);
    db.close();
    await open();
    key(target(PLANK.id, "warmups"), "Enter");
    type("1");
    key(field(), "Enter");
    expect(plain(within(cell(PLANK.id, "warmups")).getByRole("alert").textContent)).toBe(
      "Pas de montée pour un exercice chronométré",
    );
    type("0");
    key(field(), "Enter");
    expect(noField()).toBeNull();
  });

  it("a grouped row's rest is not a field: only the group's last rests", async () => {
    await open();
    expect(shown(RAISE, "rest")).toBe("—");
    key(target(RAISE, "rest"), "Enter");
    expect(noField()).toBeNull();
    // Tab from the warm-ups goes to the next row's sets, past Principal and the rest dash.
    key(target(RAISE, "rir"), "Enter");
    key(field(), "Tab");
    await waitFor(() => expect(cell(RAISE, "warmups").contains(field())).toBe(true));
    key(field(), "Tab");
    await waitFor(() => expect(cell("ds:0201", "sets").contains(field())).toBe(true));
    key(field(), "Escape");
    key(target(CALF, "rest"), "Enter");
    expect(field().value).toBe("1:15");
  });

  it("Space toggles Principal", async () => {
    await open();
    const box = target(RAISE, "main");
    expect(box.getAttribute("aria-checked")).toBe("false");
    box.focus();
    key(box, " ");
    await waitFor(() => expect(target(RAISE, "main").getAttribute("aria-checked")).toBe("true"));
    expect((await stored(RAISE)).isMain).toBe(true);
    key(target(RAISE, "main"), "Enter");
    await waitFor(() => expect(target(RAISE, "main").getAttribute("aria-checked")).toBe("false"));
    expect((await stored(RAISE)).isMain).toBe(false);
    expect(noField()).toBeNull();
  });

  it("⌘ Z on macOS, Ctrl Z elsewhere undoes the last change; inside an open cell it does not", async () => {
    onPlatform("MacIntel");
    await open();
    key(target(PRESS, "sets"), "Enter");
    type("5");
    key(field(), "Enter");
    await waitFor(() => expect(shown(PRESS, "sets")).toBe("5"));
    await screen.findByText("Enregistré sur cet appareil");
    // Ctrl Z is not the Mac's undo.
    key(target(PRESS, "sets"), "z", { ctrlKey: true });
    await settle();
    expect((await stored(PRESS)).sets).toBe(5);
    key(target(PRESS, "sets"), "z", { metaKey: true });
    await waitFor(() => expect(shown(PRESS, "sets")).toBe("3"));
    expect((await stored(PRESS)).sets).toBe(3);
    cleanup();

    onPlatform("Linux x86_64");
    await open();
    key(target(PRESS, "sets"), "Enter");
    type("6");
    key(field(), "Enter");
    await waitFor(() => expect(shown(PRESS, "sets")).toBe("6"));
    await screen.findByText("Enregistré sur cet appareil");
    key(target(PRESS, "sets"), "Enter");
    type("7");
    key(field(), "z", { ctrlKey: true });
    await settle();
    // The field keeps its own undo: the cell stays open and nothing is undone.
    expect(field().value).toBe("7");
    expect((await stored(PRESS)).sets).toBe(6);
    key(field(), "Escape");
    key(target(PRESS, "sets"), "z", { metaKey: true });
    await settle();
    expect((await stored(PRESS)).sets).toBe(6);
    key(target(PRESS, "sets"), "z", { ctrlKey: true });
    await waitFor(() => expect(shown(PRESS, "sets")).toBe("3"));
  });

  it("the help line shows always, or only while a cell has focus with the focus preference", async () => {
    const help = () =>
      screen.queryByText(
        (_, el) => el?.tagName === "P" && plain(el.textContent).endsWith("annuler"),
      );
    onPlatform("MacIntel");
    await open();
    expect(plain(help()?.textContent)).toBe("↑↓←→ se déplacer · Entrée modifier · ⌘ Z annuler");
    cleanup();
    onPlatform("Win32");
    setHelp("focus");
    await open();
    expect(help()).toBeNull();
    target(BENCH, "sets").focus();
    await waitFor(() =>
      expect(plain(help()?.textContent)).toBe(
        "↑↓←→ se déplacer · Entrée modifier · Ctrl Z annuler",
      ),
    );
    key(target(BENCH, "sets"), "Enter");
    expect(help()).toBeTruthy();
    key(field(), "Escape");
    screen.getByRole("tab", { name: "A · Push" }).focus();
    await waitFor(() => expect(help()).toBeNull());
  });

  it("a stale change shows the stale toast", async () => {
    await open();
    // Another tab made the bench a timed exercise after this view was drawn.
    const db = await openAccountDb(ADA.id);
    await recordChanges(db, replaceExercise(await readPrograms(db), seedId(0x101), PLANK, OLD)!);
    db.close();
    const before = await queued();
    key(target(BENCH, "reps"), "Enter");
    type("10-12");
    key(field(), "Enter");
    expect(
      await screen.findByText(
        "Pas enregistré : ce programme a changé ailleurs entre-temps. Les valeurs à jour sont affichées.",
      ),
    ).toBeTruthy();
    expect(await queued()).toBe(before);
    expect(screen.queryByText("Enregistré sur cet appareil")).toBeNull();
  });
});
