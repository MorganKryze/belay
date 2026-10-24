import { exerciseById } from "@belay/shared/exercises/catalog";
import type { Change } from "@belay/shared/sync/schema";
import {
  addSession,
  addSlot,
  chooseActive,
  createProgram,
  placeSession,
  renameSession,
} from "@belay/shared/training/program-edits";
import {
  SEED_PROGRAM_ID,
  seedId,
  type StoredPrograms,
} from "@belay/shared/training/stored-program";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { setRestStyle, setThumbs } from "../lib/editor-prefs";
import { openAccountDb, readPrograms, recordChanges } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA } from "../test/seed";
import { ProgramEditor } from "./program-editor";

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
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

// Program edits as the editor queues them, built on what the phone holds.
async function edit(build: (p: StoredPrograms) => Change[] | null) {
  const db = await openAccountDb(ADA.id);
  await recordChanges(db, build(await readPrograms(db))!);
  db.close();
}
const AT = "2026-10-01T06:00:00.000Z";
const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f${n.toString(16).padStart(2, "0")}`;
const LEGS = seedId(2);

const rotation = () => screen.findByRole("tablist", { name: "Séances du programme" });
const tabNames = (list: HTMLElement) =>
  within(list)
    .getAllByRole("tab")
    .map((tab) => tab.getAttribute("aria-label") ?? tab.textContent);
const cardTitle = () => screen.findByRole("heading", { level: 2 });
const table = () => screen.findByRole("grid");
const name = (exerciseId: string) => exerciseById(exerciseId)!.name;
// A row of the table by its exercise, and the text of each of its cells.
const row = (within_: HTMLElement, exerciseId: string) =>
  within(within_)
    .getAllByRole("row")
    .find((r) => r.textContent?.includes(name(exerciseId)))!;
// Spaces as a reader sees them: the no-break ones read as plain spaces.
const plain = (text: string | null) => (text ?? "").replace(/\s/g, " ");
const cells = (r: HTMLElement) =>
  within(r)
    .getAllByRole("gridcell")
    .map((c) => plain(c.textContent));
// Principal is a box, ticked or not.
const main = (r: HTMLElement) => within(r).getByRole("checkbox").getAttribute("aria-checked");
const HINT = "Repère : 3 à 4 séances par semaine conviennent à la plupart";

describe("the program editor", () => {
  it("is its own page, the shell widened for it, its back chevron to Programme", async () => {
    renderRoute("/workouts/program");
    expect(await screen.findByRole("heading", { level: 1, name: "Programme" })).toBeTruthy();
    const back = within(screen.getByRole("main"))
      .getAllByRole("link", { name: "Programme" })
      .find((a) => a.closest("nav") === null)!;
    expect(back.getAttribute("href")).toBe("/workouts?tab=program");
    expect(await screen.findByText("Programme de départ")).toBeTruthy();
    const shell = screen.getByRole("main").parentElement!;
    expect(shell.getAttribute("class")!.split(/\s+/)).toContain("lg:max-w-5xl");
    cleanup();
    renderRoute("/workouts/session/A");
    await screen.findByRole("heading", { level: 1, name: "Séance A · Push" });
    const other = screen.getByRole("main").parentElement!;
    expect(other.getAttribute("class")!.split(/\s+/)).not.toContain("lg:max-w-5xl");
  });

  it("the route's code is a lazy chunk", async () => {
    const router = renderRoute("/workouts/program");
    await screen.findByRole("heading", { level: 1, name: "Programme" });
    // The router's lazy wrapper, which fetches the page's own chunk on first render.
    const component = router.routesByPath["/workouts/program"].options.component!;
    expect(component.name).toBe("Lazy");
    expect(component).not.toBe(ProgramEditor);
  });

  it("shows the active program's chips A, B, C with names, then the set-aside chips without letter", async () => {
    // Legs set aside, a session with no name added at the end, one named in the collection.
    await edit((p) => placeSession(p, LEGS, null, 0, AT));
    await edit((p) => addSession(p, id(1), SEED_PROGRAM_ID, AT));
    await edit((p) => addSession(p, id(2), null, AT));
    await edit(() => renameSession(id(2), "Haut léger", AT));
    renderRoute("/workouts/program");
    expect(tabNames(await rotation())).toEqual(["A · Push", "B · Fessiers + tirage léger", "C"]);
    const aside = await screen.findByRole("tablist", { name: "De côté" });
    expect(tabNames(aside)).toEqual(["Legs", "Haut léger"]);
    expect(screen.getByText("De côté")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Séance/ })).toBeNull();
  });

  it("clicking or focusing a chip shows its card", async () => {
    await edit((p) => placeSession(p, LEGS, null, 0, AT));
    renderRoute("/workouts/program");
    const list = await rotation();
    expect((await cardTitle()).textContent).toBe("Séance A · Push");
    expect(within(list).getByRole("tab", { name: "A · Push" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.click(within(list).getByRole("tab", { name: "B · Fessiers + tirage léger" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
        "Séance B · Fessiers + tirage léger",
      ),
    );
    fireEvent.focus(screen.getByRole("tab", { name: "Legs" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Legs"));
    expect(screen.getByRole("tab", { name: "Legs" }).getAttribute("aria-selected")).toBe("true");
  });

  it("← → move between chips", async () => {
    renderRoute("/workouts/program");
    const list = await rotation();
    const tab = (n: string) => within(list).getByRole("tab", { name: n });
    tab("A · Push").focus();
    fireEvent.keyDown(tab("A · Push"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab("B · Legs"));
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Séance B · Legs"),
    );
    fireEvent.keyDown(tab("B · Legs"), { key: "ArrowLeft" });
    fireEvent.keyDown(tab("A · Push"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tab("C · Fessiers + tirage léger"));
    // One stop for the list: the shown chip.
    expect(
      within(list)
        .getAllByRole("tab")
        .map((t) => t.tabIndex),
    ).toEqual([-1, -1, 0]);
  });

  it("the hint reads the same for 2 and 9 sessions", async () => {
    await edit((p) => placeSession(p, LEGS, null, 0, AT));
    renderRoute("/workouts/program");
    expect(within(await rotation()).getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByText(HINT)).toBeTruthy();
    cleanup();
    await edit((p) => placeSession(p, LEGS, SEED_PROGRAM_ID, 1, AT));
    for (let n = 1; n <= 6; n++) await edit((p) => addSession(p, id(n), SEED_PROGRAM_ID, AT));
    renderRoute("/workouts/program");
    expect(within(await rotation()).getAllByRole("tab")).toHaveLength(9);
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it("the card shows the title, the size line and Voir la séance to the preview", async () => {
    // An empty session first: it takes A in the editor, but the rotation that starts sessions
    // leaves it out, so Push is still A there.
    await edit((p) => addSession(p, id(1), SEED_PROGRAM_ID, AT));
    await edit((p) => placeSession(p, id(1), SEED_PROGRAM_ID, 0, AT));
    await edit((p) => placeSession(p, LEGS, null, 0, AT));
    renderRoute("/workouts/program");
    const list = await rotation();
    expect(tabNames(list)).toEqual(["A", "B · Push", "C · Fessiers + tirage léger"]);
    expect((await cardTitle()).textContent).toBe("Séance A");
    expect(screen.queryByRole("link", { name: "Voir la séance" })).toBeNull();
    fireEvent.click(within(list).getByRole("tab", { name: "B · Push" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Séance B · Push"),
    );
    expect(screen.getByText("6 exercices · 19 séries · environ 55 min")).toBeTruthy();
    const see = screen.getByRole("link", { name: "Voir la séance" });
    expect(see.getAttribute("href")).toBe("/workouts/session/A");
    fireEvent.click(screen.getByRole("tab", { name: "Legs" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Legs"));
    expect(screen.queryByRole("link", { name: "Voir la séance" })).toBeNull();
  });

  it("the table has the eight columns, a thumbnail and muscle · equipment per row, a timed target in seconds", async () => {
    await edit((p) => addSlot(p, id(9), seedId(1), { id: "ds:2135", measure: "seconds" }, AT));
    renderRoute("/workouts/program");
    const grid = await table();
    expect(grid.getAttribute("aria-label")).toBe("Exercices de Séance A · Push");
    expect(
      within(grid)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Exercice", "Séries", "Reps", "RIR", "Repos", "Montée", "Principal", "Actions"]);
    const bench = row(grid, "ds:0025");
    expect(cells(bench)).toEqual([
      `${name("ds:0025")}Pectoraux · Barre`,
      "4",
      "6–8",
      "1–2",
      "2 min 30",
      "2",
      "",
      "",
    ]);
    expect(main(bench)).toBe("true");
    expect(bench.querySelector("img")).toBeTruthy();
    expect(cells(row(grid, "ds:2135"))[2]).toBe("30–60 s");
  });

  it("a group shows its line and « — » for every rest but the last", async () => {
    renderRoute("/workouts/program");
    const grid = await table();
    expect(within(grid).getAllByText("Enchaînés · repos après le dernier")).toHaveLength(1);
    expect(cells(row(grid, "ds:0334"))[4]).toBe("—");
    expect(cells(row(grid, "ds:0201"))[4]).toBe("—");
    expect(cells(row(grid, "ds:0605"))[4]).toBe("1 min 15");
    expect(main(row(grid, "ds:0334"))).toBe("false");
  });

  it("the no-climbing rows sit in their own section", async () => {
    renderRoute("/workouts/program");
    fireEvent.click(
      within(await rotation()).getByRole("tab", { name: "C · Fessiers + tirage léger" }),
    );
    const section = await screen.findByRole("rowgroup", { name: "Semaine sans escalade" });
    expect(within(section).getByText(name("ds:2330"))).toBeTruthy();
    expect(within(section).getByText(name("ds:0294"))).toBeTruthy();
    expect(within(section).queryByText(name("ds:0327"))).toBeNull();
    // Session A holds none: no section.
    fireEvent.click(screen.getByRole("tab", { name: "A · Push" }));
    await waitFor(() =>
      expect(screen.queryByRole("rowgroup", { name: "Semaine sans escalade" })).toBeNull(),
    );
  });

  it("rest reads « 2 min 30 », or « 2:30 » with the clock preference", async () => {
    renderRoute("/workouts/program");
    expect(cells(row(await table(), "ds:0025"))[4]).toBe("2 min 30");
    cleanup();
    setRestStyle("clock");
    renderRoute("/workouts/program");
    const grid = await table();
    expect(cells(row(grid, "ds:0025"))[4]).toBe("2:30");
    expect(cells(row(grid, "ds:0405"))[4]).toBe("2:00");
    expect(cells(row(grid, "ds:0334"))[4]).toBe("—");
  });

  it("no thumbnails with the hidden preference", async () => {
    setThumbs("hidden");
    renderRoute("/workouts/program");
    const grid = await table();
    expect(within(grid).getAllByRole("row").length).toBeGreaterThan(1);
    expect(grid.querySelector("img, video")).toBeNull();
  });

  it("no active program shows the sentence and no crash", async () => {
    const OTHER = id(0x20);
    await edit((p) => createProgram(p, OTHER, AT));
    await edit((p) => chooseActive(p, OTHER, AT));
    await edit(() => [{ kind: "program", id: OTHER, field: "removed", value: true, at: AT }]);
    renderRoute("/workouts/program");
    expect(
      await screen.findByText("Aucun programme actif : choisis-en un ou crée-le."),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Programme" })).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "Séances du programme" })).toBeNull();
    expect(screen.queryByRole("grid")).toBeNull();
  });
});
