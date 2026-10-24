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
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { setRestStyle, setThumbs } from "../lib/editor-prefs";
import { openAccountDb, readOutbox, readPrograms, recordChanges } from "../sync/db";
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
const PUSH = seedId(1);
const LEGS = seedId(2);
const GLUTES = seedId(3);

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
    // « + Séance » follows the rotation's chips, before the set-aside ones.
    const add = screen.getByRole("button", { name: "Ajouter une séance" });
    expect(add.textContent).toBe("Séance");
    const lastTab = within(await rotation())
      .getAllByRole("tab")
      .at(-1)!;
    expect(lastTab.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(add.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    expect(see.getAttribute("href")).toBe(`/workouts/session/${PUSH}`);
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

// Spaces as a reader sees them, in every live region and toast of the page.
const said = (text: string) =>
  waitFor(() =>
    expect(screen.getAllByRole("status").some((s) => plain(s.textContent).includes(text))).toBe(
      true,
    ),
  );
const stored = async () => {
  const db = await openAccountDb(ADA.id);
  const programs = await readPrograms(db);
  db.close();
  return programs;
};
const titleIs = (text: string) =>
  waitFor(() => expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(text));
const rotationIs = async (names: string[]) =>
  waitFor(async () => expect(tabNames(await rotation())).toEqual(names));
async function sessionMenu() {
  fireEvent.keyDown(await screen.findByRole("button", { name: "Autres actions sur la séance" }), {
    key: "Enter",
  });
  return screen.findByRole("menu");
}
const pick = async (label: string) => {
  const menu = await sessionMenu();
  await act(async () => fireEvent.click(within(menu).getByRole("menuitem", { name: label })));
};
const curl = { id: "ds:0294", measure: "reps" as const };
// Long enough for a write that should not happen to land.
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
const STARTER = ["A · Push", "B · Legs", "C · Fessiers + tirage léger"];

describe("the editor's sessions", () => {
  it("+ Séance adds D empty, shows it and focuses the search", async () => {
    renderRoute("/workouts/program");
    await rotationIs(STARTER);
    fireEvent.click(screen.getByRole("button", { name: "Ajouter une séance" }));
    await rotationIs([...STARTER, "D"]);
    await titleIs("Séance D");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("combobox", { name: "Ajouter un exercice" }),
      ),
    );
    await said("Séance D ajoutée");
    // The empty session as drawn: its size line, the sentence over the starts, and the search's
    // keys under the card while it is the session just added.
    expect(screen.getByText("Nouvelle séance · aucun exercice")).toBeTruthy();
    expect(screen.getByText("Aucun exercice pour l'instant.")).toBeTruthy();
    const help =
      "Séance D ajoutée en fin de rotation. Tape pour chercher · Entrée ajoute · Échap ferme · Ctrl Z annuler";
    const helpShown = () =>
      screen.queryAllByText((_, el) => el?.tagName === "P" && plain(el.textContent) === help);
    expect(helpShown()).toHaveLength(1);
    const added = (await stored()).sessions.filter(
      (s) => s.programId === SEED_PROGRAM_ID && !s.removed,
    );
    expect(added).toHaveLength(4);
    expect(added.at(-1)!.name).toBeNull();
    // No toast: the chip and the card say it.
    expect(screen.queryByRole("button", { name: "Annuler" })).toBeNull();
    // Another session shown, then D again: the line was for the moment of the add.
    fireEvent.click(within(await rotation()).getByRole("tab", { name: "A · Push" }));
    await titleIs("Séance A · Push");
    fireEvent.click(within(await rotation()).getByRole("tab", { name: "D" }));
    await titleIs("Séance D");
    expect(helpShown()).toHaveLength(0);
  });

  it("the pencil opens the name, Enter saves trimmed, Escape cancels, empty means no name", async () => {
    await edit((p) => addSession(p, id(1), SEED_PROGRAM_ID, AT));
    await edit(() => renameSession(id(1), "Bras", AT));
    renderRoute("/workouts/program");
    fireEvent.click(within(await rotation()).getByRole("tab", { name: "D · Bras" }));
    await titleIs("Séance D · Bras");
    const pencil = () => screen.getByRole("button", { name: "Renommer la séance" });
    const field = () => screen.findByRole("textbox", { name: "Nom de la séance" });

    fireEvent.click(pencil());
    expect((await field()) as HTMLInputElement).toHaveProperty("value", "Bras");
    expect(screen.getByText(/^Séance D ·/)).toBeTruthy();
    expect((await field()).getAttribute("maxlength")).toBe("40");
    fireEvent.change(await field(), { target: { value: "  Bras et épaules  " } });
    fireEvent.keyDown(await field(), { key: "Enter" });
    await rotationIs([...STARTER, "D · Bras et épaules"]);
    await titleIs("Séance D · Bras et épaules");
    expect((await stored()).sessions.find((s) => s.id === id(1))!.name).toBe("Bras et épaules");

    fireEvent.click(pencil());
    fireEvent.change(await field(), { target: { value: "Autre" } });
    fireEvent.keyDown(await field(), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Nom de la séance" })).toBeNull(),
    );
    expect(document.activeElement).toBe(pencil());
    expect((await stored()).sessions.find((s) => s.id === id(1))!.name).toBe("Bras et épaules");

    fireEvent.click(pencil());
    fireEvent.change(await field(), { target: { value: "   " } });
    fireEvent.keyDown(await field(), { key: "Enter" });
    await rotationIs([...STARTER, "D"]);
    await titleIs("Séance D");
    expect((await stored()).sessions.find((s) => s.id === id(1))!.name).toBeNull();
  });

  it("a click away saves the name; Enter then the click away writes it once; Escape still cancels", async () => {
    const api = fakeApi({ me: ADA });
    await edit((p) => addSession(p, id(1), SEED_PROGRAM_ID, AT));
    await edit(() => renameSession(id(1), "Bras", AT));
    renderRoute("/workouts/program");
    fireEvent.click(within(await rotation()).getByRole("tab", { name: "D · Bras" }));
    await titleIs("Séance D · Bras");
    const pencil = () => screen.getByRole("button", { name: "Renommer la séance" });
    const field = () => screen.findByRole("textbox", { name: "Nom de la séance" });
    // Each name written, sent already or still queued.
    const names = async () => {
      const db = await openAccountDb(ADA.id);
      const queued = (await readOutbox(db)).map((e) => e.change);
      db.close();
      return [...api.requests.flatMap((r) => r.changes), ...queued]
        .filter((c) => c.kind === "programSession" && c.id === id(1) && c.field === "name")
        .map((c) => (c as { value: unknown }).value);
    };
    const before = (await names()).length;

    fireEvent.click(pencil());
    fireEvent.change(await field(), { target: { value: "Bras et épaules" } });
    act(() => screen.getByRole("textbox", { name: "Nom de la séance" }).blur());
    await rotationIs([...STARTER, "D · Bras et épaules"]);
    expect(screen.queryByRole("textbox", { name: "Nom de la séance" })).toBeNull();

    fireEvent.click(pencil());
    const typed = await field();
    fireEvent.change(typed, { target: { value: "Jambes" } });
    act(() => {
      fireEvent.keyDown(typed, { key: "Enter" });
      typed.blur();
    });
    await rotationIs([...STARTER, "D · Jambes"]);
    await settle();
    expect((await names()).slice(before)).toEqual(["Bras et épaules", "Jambes"]);

    fireEvent.click(pencil());
    const kept = await field();
    fireEvent.change(kept, { target: { value: "Autre" } });
    act(() => {
      fireEvent.keyDown(kept, { key: "Escape" });
      kept.blur();
    });
    await settle();
    expect((await names()).slice(before)).toEqual(["Bras et épaules", "Jambes"]);
    expect((await stored()).sessions.find((s) => s.id === id(1))!.name).toBe("Jambes");
  });

  it("Space lifts a chip, → moves it, the lifted chip shows its future letter, Space drops and the letter changes are announced", async () => {
    renderRoute("/workouts/program");
    const list = await rotation();
    const push = within(list).getByRole("tab", { name: "A · Push" });
    push.focus();
    fireEvent.keyDown(push, { key: " " });
    await said("Push soulevée, position 1 sur 3.");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    // The chips read as they would after the drop, the lifted one already B.
    await rotationIs(["A · Legs", "B · Push", "C · Fessiers + tirage léger"]);
    expect(document.activeElement!.getAttribute("aria-label")).toBe("B · Push");
    await said("position 2 sur 3, Legs devient A ; Push devient B");
    // Nothing is written before the drop.
    expect((await stored()).sessions.find((s) => s.id === PUSH)!.position).toBe(0);
    fireEvent.keyDown(document.activeElement!, { key: " " });
    await waitFor(async () =>
      expect((await stored()).sessions.find((s) => s.id === PUSH)!.position).toBe(1),
    );
    await rotationIs(["A · Legs", "B · Push", "C · Fessiers + tirage léger"]);
    await said("Legs devient A ; Push devient B");

    // Escape puts a lifted chip back where it was, unwritten.
    const glutes = within(list).getByRole("tab", { name: "C · Fessiers + tirage léger" });
    glutes.focus();
    fireEvent.keyDown(glutes, { key: " " });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    await rotationIs(["A · Legs", "B · Fessiers + tirage léger", "C · Push"]);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await rotationIs(["A · Legs", "B · Push", "C · Fessiers + tirage léger"]);
    await said("Déplacement annulé");
    expect((await stored()).sessions.find((s) => s.id === GLUTES)!.position).toBe(2);
  });

  it("Dupliquer la séance adds « Push (copie) » last", async () => {
    renderRoute("/workouts/program");
    await rotationIs(STARTER);
    await pick("Dupliquer la séance");
    await rotationIs([...STARTER, "D · Push (copie)"]);
    await titleIs("Séance D · Push (copie)");
    await said("Push dupliquée en D.");
    const p = await stored();
    const copy = p.sessions.find((s) => s.name === "Push (copie)")!;
    const slots = (sessionId: string) =>
      p.slots.filter((s) => s.sessionId === sessionId && !s.removed);
    expect(slots(copy.id).map((s) => s.exerciseId)).toEqual(
      slots(PUSH)
        .sort((a, b) => a.position - b.position)
        .map((s) => s.exerciseId),
    );
  });

  it("Dupliquer la séance on a set-aside one says the copy's name, never a letter", async () => {
    await edit((p) => placeSession(p, LEGS, null, 0, AT));
    renderRoute("/workouts/program");
    fireEvent.click(await screen.findByRole("tab", { name: "Legs" }));
    await titleIs("Legs");
    await pick("Dupliquer la séance");
    await waitFor(async () =>
      expect(tabNames(await screen.findByRole("tablist", { name: "De côté" }))).toEqual([
        "Legs",
        "Legs (copie)",
      ]),
    );
    await said("Legs copiée en « Legs (copie) ».");
  });

  it("Mettre de côté closes the letters up and the toast says « D devient C »", async () => {
    await edit((p) => addSession(p, id(1), SEED_PROGRAM_ID, AT));
    await edit(() => renameSession(id(1), "Haut léger", AT));
    await edit((p) => placeSession(p, id(1), SEED_PROGRAM_ID, 2, AT));
    renderRoute("/workouts/program");
    fireEvent.click(within(await rotation()).getByRole("tab", { name: "C · Haut léger" }));
    await titleIs("Séance C · Haut léger");
    const menu = await sessionMenu();
    expect(within(menu).getByText("hors rotation, gardée telle quelle")).toBeTruthy();
    await act(async () =>
      fireEvent.click(within(menu).getByRole("menuitem", { name: /^Mettre de côté/ })),
    );
    await rotationIs(["A · Push", "B · Legs", "C · Fessiers + tirage léger"]);
    expect(tabNames(await screen.findByRole("tablist", { name: "De côté" }))).toEqual([
      "Haut léger",
    ]);
    await titleIs("Haut léger");
    await said("Haut léger mise de côté. D devient C.");
    // Annuler puts it back at its place.
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    await rotationIs(["A · Push", "B · Legs", "C · Haut léger", "D · Fessiers + tirage léger"]);
  });

  it("Remettre dans la rotation adds it last with the next letter", async () => {
    await edit((p) => addSession(p, id(1), null, AT));
    await edit(() => renameSession(id(1), "Haut léger", AT));
    await edit((p) => addSlot(p, id(9), id(1), curl, AT));
    renderRoute("/workouts/program");
    fireEvent.click(await screen.findByRole("tab", { name: "Haut léger" }));
    await titleIs("Haut léger");
    expect(screen.queryByRole("link", { name: "Voir la séance" })).toBeNull();
    // Voir la séance moves into its menu, to the preview by id.
    const menu = await sessionMenu();
    expect(
      within(menu).getByRole("menuitem", { name: "Voir la séance" }).getAttribute("href"),
    ).toBe(`/workouts/session/${id(1)}`);
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Remettre dans la rotation" }));
    await rotationIs([...STARTER, "D · Haut léger"]);
    await titleIs("Séance D · Haut léger");
    await said("Haut léger remise dans la rotation, en D.");
    expect(screen.queryByRole("tablist", { name: "De côté" })).toBeNull();
    expect(screen.getByRole("link", { name: "Voir la séance" }).getAttribute("href")).toBe(
      `/workouts/session/${id(1)}`,
    );
  });

  it("Supprimer shows the neighbour and the toast « Séance B · Legs supprimée. C devient B, D devient C. »; Annuler puts it back with its exercises", async () => {
    await edit((p) => addSession(p, id(1), SEED_PROGRAM_ID, AT));
    await edit(() => renameSession(id(1), "Bras", AT));
    renderRoute("/workouts/program");
    fireEvent.click(within(await rotation()).getByRole("tab", { name: "B · Legs" }));
    await titleIs("Séance B · Legs");
    const rows = within(await table()).getAllByRole("row").length;
    await pick("Supprimer la séance B");
    await rotationIs(["A · Push", "B · Fessiers + tirage léger", "C · Bras"]);
    await titleIs("Séance B · Fessiers + tirage léger");
    await said("Séance B · Legs supprimée. C devient B, D devient C.");
    expect((await stored()).sessions.find((s) => s.id === LEGS)!.removed).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    await rotationIs(["A · Push", "B · Legs", "C · Fessiers + tirage léger", "D · Bras"]);
    await titleIs("Séance B · Legs");
    expect(within(await table()).getAllByRole("row")).toHaveLength(rows);
  });

  it("the last session of a list shows the one before once removed", async () => {
    renderRoute("/workouts/program");
    fireEvent.click(
      within(await rotation()).getByRole("tab", { name: "C · Fessiers + tirage léger" }),
    );
    await pick("Supprimer la séance C");
    await rotationIs(["A · Push", "B · Legs"]);
    await titleIs("Séance B · Legs");
    await said("Séance C · Fessiers + tirage léger supprimée.");
  });

  it("with one session the menu shows the neutral line", async () => {
    await edit((p) => placeSession(p, LEGS, null, 0, AT));
    await edit((p) => placeSession(p, GLUTES, null, 1, AT));
    renderRoute("/workouts/program");
    await rotationIs(["A · Push"]);
    const menu = await sessionMenu();
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual(["Renommer", "Dupliquer la séance"]);
    expect(within(menu).getByText("Le programme garde au moins une séance.")).toBeTruthy();
    fireEvent.keyDown(menu, { key: "Escape" });
    // A set-aside session can always go.
    fireEvent.click(screen.getByRole("tab", { name: "Legs" }));
    await titleIs("Legs");
    const aside = await sessionMenu();
    expect(
      within(aside)
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual(["Renommer", "Dupliquer la séance", "Voir la séance", "Supprimer la séance"]);
  });

  it("an empty session offers one chip per other session and copies it", async () => {
    await edit((p) => addSession(p, id(1), SEED_PROGRAM_ID, AT));
    renderRoute("/workouts/program");
    fireEvent.click(within(await rotation()).getByRole("tab", { name: "D" }));
    await titleIs("Séance D");
    expect(screen.queryByRole("grid")).toBeNull();
    expect(
      screen.getByText(
        "Cherche dans la bibliothèque avec le champ ci-dessus, ou pars d'une séance existante :",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Ajouter un exercice" })).toBeTruthy();
    const from = screen.getAllByRole("button", { name: /^Partir de / });
    expect(from.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Partir de A · Push",
      "Partir de B · Legs",
      "Partir de C · Fessiers + tirage léger",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Partir de B · Legs" }));
    const grid = await table();
    const p = await stored();
    const count = (sessionId: string) =>
      p.slots.filter((s) => s.sessionId === sessionId && !s.removed).length;
    expect(count(id(1))).toBe(count(LEGS));
    expect(within(grid).getAllByRole("row").length).toBeGreaterThan(count(LEGS));
  });

  it("a 27th session is refused with the limit toast", async () => {
    for (let n = 1; n <= 23; n++) await edit((p) => addSession(p, id(n), SEED_PROGRAM_ID, AT));
    renderRoute("/workouts/program");
    await waitFor(async () =>
      expect(within(await rotation()).getAllByRole("tab")).toHaveLength(26),
    );
    fireEvent.click(screen.getByRole("button", { name: "Ajouter une séance" }));
    await said("Une rotation garde 26 séances au plus, une par lettre.");
    expect(within(await rotation()).getAllByRole("tab")).toHaveLength(26);
  });

  it("an open session's plan is untouched by an edit", async () => {
    const OPEN = id(0x40);
    const startedAt = new Date().toISOString();
    const plan = (await stored()).slots
      .filter((s) => s.sessionId === LEGS && !s.removed && s.rule === null)
      .sort((a, b) => a.position - b.position)
      .map(({ exerciseId, sets, repRange, rirTarget, restSec, warmupSets, isMain, groupKey }) => ({
        exerciseId,
        sets,
        repRange,
        rirTarget,
        restSec,
        warmupSets,
        isMain,
        groupKey,
      }));
    const db = await openAccountDb(ADA.id);
    await recordChanges(
      db,
      [
        {
          kind: "workout",
          id: OPEN,
          field: "start",
          sessionCode: "B",
          sessionId: LEGS,
          plan,
          startedAt,
          at: startedAt,
        },
      ],
      { active: { workoutId: OPEN, slotIndex: 0, restEndsAt: null } },
    );
    const before = await db.get("workouts", OPEN);
    db.close();
    renderRoute("/workouts/program");
    fireEvent.click(within(await rotation()).getByRole("tab", { name: "B · Legs" }));
    fireEvent.click(screen.getByRole("button", { name: "Renommer la séance" }));
    const field = await screen.findByRole("textbox", { name: "Nom de la séance" });
    fireEvent.change(field, { target: { value: "Jambes" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await rotationIs(["A · Push", "B · Jambes", "C · Fessiers + tirage léger"]);
    await pick("Dupliquer la séance");
    await rotationIs([
      "A · Push",
      "B · Jambes",
      "C · Fessiers + tirage léger",
      "D · Jambes (copie)",
    ]);
    fireEvent.click(within(await rotation()).getByRole("tab", { name: "B · Jambes" }));
    await pick("Supprimer la séance B");
    await rotationIs(["A · Push", "B · Fessiers + tirage léger", "C · Jambes (copie)"]);
    const after = await openAccountDb(ADA.id);
    expect(await after.get("workouts", OPEN)).toEqual(before);
    expect((await after.get("activeSession", "current"))?.workoutId).toBe(OPEN);
    after.close();
  });

  it("a refused change shows the refused-entries banner on the editor", async () => {
    const db = await openAccountDb(ADA.id);
    await db.add("rejected", { change: renameSession(LEGS, "Jambes", AT)[0]!, reason: "refused" });
    db.close();
    renderRoute("/workouts/program");
    await rotationIs(STARTER);
    expect(await screen.findByText("Une saisie a été refusée.")).toBeTruthy();
  });
});
