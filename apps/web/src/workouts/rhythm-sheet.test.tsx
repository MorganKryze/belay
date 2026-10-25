import type { Change } from "@belay/shared/sync/schema";
import { isValidChange } from "@belay/shared/sync/valid";
import {
  addSession,
  addSlot,
  chooseActive,
  createProgram,
  placeSession,
  renameSession,
  setSchedule,
} from "@belay/shared/training/program-edits";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import {
  SEED_PROGRAM_ID,
  seedId,
  type Schedule,
  type StoredPrograms,
} from "@belay/shared/training/stored-program";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readOutbox, readPrograms, recordChanges } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { expectTokensOnly } from "../test/design-rules";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";

// Radix Select calls pointer-capture and scrolling APIs jsdom does not implement.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

// Sunday 25 October 2026, 8:00 on the phone's clock.
const NOW = new Date(2026, 9, 25, 8, 0);
let api: ReturnType<typeof fakeApi>;
beforeEach(async () => {
  indexedDB = new IDBFactory();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  writeLastUser(ADA);
  api = fakeApi({ me: ADA });
  await i18n.changeLanguage("fr");
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

const [PUSH, LEGS, GLUTES] = [seedId(1), seedId(2), seedId(3)];
const EDIT_AT = "2026-10-01T06:00:00.000Z";
const OTHER = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f20";
const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e${String(n).padStart(2, "0")}`;

// A finished session of `code` begun on the given day of 2026 at 18:00, from its session.
const done = (n: number, code: string, month: number, day: number, sessionId: string): Change[] => {
  const start = new Date(2026, month - 1, day, 18, 0).toISOString();
  const end = new Date(2026, month - 1, day, 19, 0).toISOString();
  return [
    {
      kind: "workout",
      id: id(n),
      field: "start",
      sessionCode: code,
      sessionId,
      plan: [...sessionByCode(code, starterProgram)!.slots],
      startedAt: start,
      at: start,
    },
    { kind: "workout", id: id(n), field: "ended", value: end, at: end },
  ];
};
// Four weeks of A on Mondays, B on Wednesdays, C on Fridays.
const FOUR_WEEKS: Change[] = [
  [9, 28],
  [10, 5],
  [10, 12],
  [10, 19],
].flatMap(([month, monday], w) => {
  const at = (k: number) => new Date(2026, month! - 1, monday! + k);
  return [
    [0, "A", PUSH],
    [2, "B", LEGS],
    [4, "C", GLUTES],
  ].flatMap(([k, code, session], i) => {
    const day = at(k as number);
    return done(
      w * 3 + i + 1,
      code as string,
      day.getMonth() + 1,
      day.getDate(),
      session as string,
    );
  });
});

// Program edits as the editor queues them, built on what the phone holds.
async function edit(build: (p: StoredPrograms) => Change[] | null) {
  const db = await openAccountDb(ADA.id);
  await recordChanges(db, build(await readPrograms(db))!);
  db.close();
}
const fixed = (days: (string | null)[]): Schedule => ({ mode: "fixed", days });
const stored = async () => {
  const db = await openAccountDb(ADA.id);
  const p = await readPrograms(db);
  db.close();
  return p.programs.find((x) => x.id === SEED_PROGRAM_ID)!.schedule;
};
// The schedule changes this screen wrote (at the frozen time), already sent or still queued.
async function written(): Promise<Change[]> {
  const db = await openAccountDb(ADA.id);
  const queued = (await readOutbox(db)).map((e) => e.change);
  db.close();
  const all = [...api.requests.flatMap((r) => r.changes), ...queued];
  const unique = [...new Map(all.map((c) => [JSON.stringify(c), c])).values()];
  return unique.filter(
    (c) => c.kind === "program" && c.field === "schedule" && c.at === NOW.toISOString(),
  );
}

const row = () => screen.findByRole("button", { name: /^Rythme / });
async function openSheet() {
  fireEvent.click(await row());
  return screen.findByRole("dialog", { name: "Rythme du programme" });
}
const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
// Each day's chosen chip, Monday first.
const chosen = (sheet: HTMLElement) =>
  DAYS.map(
    (day) =>
      within(within(sheet).getByRole("radiogroup", { name: day }))
        .getAllByRole("radio")
        .find((r) => r.getAttribute("aria-checked") === "true")?.textContent,
  );
const chip = (sheet: HTMLElement, day: string, name: string) =>
  within(within(sheet).getByRole("radiogroup", { name: day })).getByRole("radio", { name });
// A change from another device lands: queued here, then a sync round re-reads the screen.
async function lands(build: (p: StoredPrograms) => Change[] | null) {
  await edit(build);
  window.dispatchEvent(new Event("online"));
}
const rowText = () => screen.getByRole("button", { name: /^Rythme /, hidden: true }).textContent;
const gone = () => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
// Every write and the screen's reads given their turn.
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

describe("the « Rythme » row", () => {
  it("the row says En rotation and A, B, C à la suite", async () => {
    renderRoute("/workouts?tab=program");
    const r = await row();
    expect(r.textContent).toBe("Rythme A, B, C à la suite En rotation");
    expect(r.querySelector("[data-slot=row-icon]")).not.toBeNull();
    expect(r.querySelector("[data-slot=row-chevron]")).not.toBeNull();
  });

  it("with fixed days it says Jours fixes and 3 séances par semaine", async () => {
    await edit(() =>
      setSchedule(SEED_PROGRAM_ID, fixed([PUSH, null, LEGS, null, null, GLUTES, null]), EDIT_AT),
    );
    renderRoute("/workouts?tab=program");
    expect((await row()).textContent).toBe("Rythme 3 séances par semaine Jours fixes");
  });

  it("a fixed week naming no session of the rotation reads En rotation", async () => {
    await edit((p) => placeSession(p, LEGS, null, 0, EDIT_AT));
    await edit(() =>
      setSchedule(SEED_PROGRAM_ID, fixed([null, null, LEGS, null, null, null, null]), EDIT_AT),
    );
    renderRoute("/workouts?tab=program");
    expect((await row()).textContent).toBe("Rythme A, B à la suite En rotation");
  });

  it("the row is absent with no active program or an empty rotation", async () => {
    await edit((p) => createProgram(p, OTHER, EDIT_AT));
    await edit((p) => chooseActive(p, OTHER, EDIT_AT));
    renderRoute("/workouts?tab=program");
    await screen.findByText(/^Le programme se modifie sur ordinateur/);
    await settle();
    expect(screen.queryByRole("button", { name: /^Rythme/ })).toBeNull();
    // On a computer the editor's entry stays in its own group.
    const entry = screen.getByRole("link", { name: "Modifier le programme" });
    expect(entry.parentElement!.className.split(" ")).toEqual(
      expect.arrayContaining(["hidden", "lg:block"]),
    );
    cleanup();
    fakeApi({ me: null });
    localStorage.clear();
    renderRoute("/workouts?tab=program");
    await screen.findAllByRole("heading", { level: 2, name: /^Séance / });
    expect(screen.queryByRole("button", { name: /^Rythme/ })).toBeNull();
  });

  it("from 1 024 px the editor's entry shares the row's group, the note follows the row", async () => {
    renderRoute("/workouts?tab=program");
    const r = await row();
    const entry = screen.getByRole("link", { name: "Modifier le programme" });
    expect(entry.closest("div")!.parentElement).toBe(r.parentElement);
    const note = screen.getByText("Le programme se modifie sur ordinateur.");
    expect(r.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the sheet « Rythme du programme »", () => {
  it("the sheet opens on the program's mode with the rotation note", async () => {
    renderRoute("/workouts?tab=program");
    const sheet = await openSheet();
    expect(
      within(sheet).getByRole("radio", { name: "En rotation" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      within(sheet).getByText(
        "Les séances s'enchaînent dans l'ordre, quel que soit le jour. Pas de jour de repos prévu.",
      ),
    ).toBeTruthy();
    expect(within(sheet).queryByRole("radiogroup", { name: "Lundi" })).toBeNull();
    expect(within(sheet).getAllByRole("button").at(-1)!.textContent).toBe("Enregistrer");
  });

  it("Jours fixes proposes Monday A, Wednesday B, Friday C from the last weeks with Proposé d'après tes dernières semaines", async () => {
    await seed(ADA.id, FOUR_WEEKS);
    renderRoute("/workouts?tab=program");
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("radio", { name: "Jours fixes" }));
    expect(
      await within(sheet).findByText(
        "Proposé d'après tes dernières semaines. Un tap change un jour.",
      ),
    ).toBeTruthy();
    expect(chosen(sheet)).toEqual(["A", "Repos", "B", "Repos", "C", "Repos", "Repos"]);
    expect(within(sheet).getByText("A · Push, B · Legs, C · Fessiers + tirage léger")).toBeTruthy();
  });

  it("without history the starting pattern and Un tap change un jour", async () => {
    await edit((p) => placeSession(p, GLUTES, null, 0, EDIT_AT));
    renderRoute("/workouts?tab=program");
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("radio", { name: "Jours fixes" }));
    expect(await within(sheet).findByText("Un tap change un jour.")).toBeTruthy();
    expect(within(sheet).queryByText(/^Proposé/)).toBeNull();
    expect(chosen(sheet)).toEqual(["A", "Repos", "Repos", "B", "Repos", "Repos", "Repos"]);
  });

  it("stored days are offered again, a set-aside session's day shown as Repos", async () => {
    await edit(() =>
      setSchedule(SEED_PROGRAM_ID, fixed([PUSH, null, LEGS, null, GLUTES, null, null]), EDIT_AT),
    );
    // Legs set aside: Glutes moves up to B, and Wednesday reads as a rest day.
    await edit((p) => placeSession(p, LEGS, null, 0, EDIT_AT));
    await seed(ADA.id, FOUR_WEEKS);
    renderRoute("/workouts?tab=program");
    const sheet = await openSheet();
    expect(
      within(sheet).getByRole("radio", { name: "Jours fixes" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(within(sheet).getByText("Un tap change un jour.")).toBeTruthy();
    expect(chosen(sheet)).toEqual(["A", "Repos", "Repos", "Repos", "B", "Repos", "Repos"]);
  });

  it("each day is a radio group named by the day; arrows move; a tap picks", async () => {
    await edit(() =>
      setSchedule(SEED_PROGRAM_ID, fixed([PUSH, null, null, null, null, null, null]), EDIT_AT),
    );
    renderRoute("/workouts?tab=program");
    const sheet = await openSheet();
    expect(
      within(sheet)
        .getAllByRole("radiogroup")
        .map((g) => g.getAttribute("aria-label"))
        .slice(1),
    ).toEqual(DAYS);
    const monday = within(sheet).getByRole("radiogroup", { name: "Lundi" });
    expect(
      within(monday)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["A", "B", "C", "Repos"]);
    const a = chip(sheet, "Lundi", "A");
    act(() => a.focus());
    fireEvent.keyDown(a, { key: "ArrowRight" });
    await waitFor(() =>
      expect(chip(sheet, "Lundi", "B").getAttribute("aria-checked")).toBe("true"),
    );
    expect(document.activeElement).toBe(chip(sheet, "Lundi", "B"));
    fireEvent.click(chip(sheet, "Mardi", "C"));
    expect(chosen(sheet)).toEqual(["B", "C", "Repos", "Repos", "Repos", "Repos", "Repos"]);
  });

  it("with 5 sessions each day is a menu row listing Repos then A to E", async () => {
    for (const [session, slot, name] of [
      ["0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f0d", "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f1d", "Bras"],
      ["0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f0e", "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f1e", "Mollets"],
    ] as const) {
      await edit((p) => addSession(p, session, SEED_PROGRAM_ID, EDIT_AT));
      await edit(() => renameSession(session, name, EDIT_AT));
      await edit((p) => addSlot(p, slot, session, { id: "ds:0025", measure: "reps" }, EDIT_AT));
    }
    await edit(() =>
      setSchedule(SEED_PROGRAM_ID, fixed([PUSH, null, null, null, null, null, null]), EDIT_AT),
    );
    renderRoute("/workouts?tab=program");
    expect((await row()).textContent).toBe("Rythme 1 séance par semaine Jours fixes");
    fireEvent.click(await row());
    const sheet = await screen.findByRole("dialog", { name: "Rythme du programme" });
    expect(within(sheet).queryByRole("radiogroup", { name: "Lundi" })).toBeNull();
    const rows = within(sheet).getAllByRole("combobox");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Lundi · A · Push",
      ...DAYS.slice(1).map((d) => `${d} · Repos`),
    ]);
    expect(rows[0]!.querySelector("[data-slot=row-icon]")).toBeNull();
    act(() => rows[1]!.focus());
    fireEvent.keyDown(rows[1]!, { key: "Enter" });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Repos",
      "A · Push",
      "B · Legs",
      "C · Fessiers + tirage léger",
      "D · Bras",
      "E · Mollets",
    ]);
    fireEvent.click(screen.getByRole("option", { name: "D · Bras" }));
    expect(within(sheet).getByRole("combobox", { name: "Mardi · D · Bras" })).toBeTruthy();
    expect(within(sheet).queryByText(/^A · Push, /)).toBeNull();
  });

  it("Enregistrer writes one schedule change, valid, stored and queued, and closes", async () => {
    await seed(ADA.id, FOUR_WEEKS);
    renderRoute("/workouts?tab=program");
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("radio", { name: "Jours fixes" }));
    await within(sheet).findByText(/^Proposé/);
    fireEvent.click(chip(sheet, "Vendredi", "Repos"));
    fireEvent.click(chip(sheet, "Samedi", "C"));
    fireEvent.click(within(sheet).getByRole("button", { name: "Enregistrer" }));
    await gone();
    const days = [PUSH, null, LEGS, null, null, GLUTES, null];
    expect(await stored()).toEqual(fixed(days));
    const changes = await written();
    expect(changes).toEqual([
      {
        kind: "program",
        id: SEED_PROGRAM_ID,
        field: "schedule",
        value: fixed(days),
        at: NOW.toISOString(),
      },
    ]);
    expect(isValidChange(changes[0]!)).toBe(true);
    await waitFor(async () =>
      expect((await row()).textContent).toBe("Rythme 3 séances par semaine Jours fixes"),
    );
  });

  it("nothing is written when nothing changed or on close", async () => {
    renderRoute("/workouts?tab=program");
    let sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: "Enregistrer" }));
    await gone();
    // Changed, then closed by its button, then by Escape.
    sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("radio", { name: "Jours fixes" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Fermer" }));
    await gone();
    sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("radio", { name: "Jours fixes" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await gone();
    await settle();
    expect(await written()).toEqual([]);
    expect((await stored()).mode).toBe("rotation");
  });

  it("nothing is written when fixed days are saved as they stand", async () => {
    const days = [PUSH, null, LEGS, null, null, GLUTES, null];
    await edit(() => setSchedule(SEED_PROGRAM_ID, fixed(days), EDIT_AT));
    renderRoute("/workouts?tab=program");
    const sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: "Enregistrer" }));
    await gone();
    await settle();
    expect(await written()).toEqual([]);
  });

  it("an untouched sheet saved after a newer fixed week landed writes nothing", async () => {
    await edit(() =>
      setSchedule(SEED_PROGRAM_ID, fixed([PUSH, null, LEGS, null, GLUTES, null, null]), EDIT_AT),
    );
    renderRoute("/workouts?tab=program");
    const sheet = await openSheet();
    const newer = fixed([null, PUSH, null, LEGS, null, null, null]);
    await lands(() => setSchedule(SEED_PROGRAM_ID, newer, "2026-10-20T06:00:00.000Z"));
    await waitFor(() => expect(rowText()).toBe("Rythme 2 séances par semaine Jours fixes"));
    fireEvent.click(within(sheet).getByRole("button", { name: "Enregistrer" }));
    await gone();
    await settle();
    expect(await written()).toEqual([]);
    expect(await stored()).toEqual(newer);
  });

  it("an untouched sheet in rotation saved after another device's fixed week landed writes nothing", async () => {
    renderRoute("/workouts?tab=program");
    const sheet = await openSheet();
    const newer = fixed([PUSH, null, LEGS, null, GLUTES, null, null]);
    await lands(() => setSchedule(SEED_PROGRAM_ID, newer, "2026-10-20T06:00:00.000Z"));
    await waitFor(() => expect(rowText()).toBe("Rythme 3 séances par semaine Jours fixes"));
    fireEvent.click(within(sheet).getByRole("button", { name: "Enregistrer" }));
    await gone();
    await settle();
    expect(await written()).toEqual([]);
    expect(await stored()).toEqual(newer);
  });

  it("every day on Repos keeps the sheet open with Choisis au moins un jour de séance and writes nothing", async () => {
    await edit(() =>
      setSchedule(SEED_PROGRAM_ID, fixed([PUSH, null, null, null, null, null, null]), EDIT_AT),
    );
    renderRoute("/workouts?tab=program");
    const sheet = await openSheet();
    fireEvent.click(chip(sheet, "Lundi", "Repos"));
    fireEvent.click(within(sheet).getByRole("button", { name: "Enregistrer" }));
    expect((await within(sheet).findByRole("alert")).textContent).toBe(
      "Choisis au moins un jour de séance.",
    );
    await settle();
    expect(screen.getByRole("dialog", { name: "Rythme du programme" })).toBe(sheet);
    expect(await written()).toEqual([]);
    // A session day picked again clears the note.
    fireEvent.click(chip(sheet, "Mardi", "B"));
    expect(within(sheet).queryByRole("alert")).toBeNull();
  });

  it("saving En rotation keeps the stored days", async () => {
    const days = [PUSH, null, LEGS, null, null, null, null];
    await edit(() => setSchedule(SEED_PROGRAM_ID, fixed(days), EDIT_AT));
    await seed(ADA.id, FOUR_WEEKS);
    renderRoute("/workouts?tab=program");
    let sheet = await openSheet();
    fireEvent.click(chip(sheet, "Vendredi", "C"));
    fireEvent.click(within(sheet).getByRole("radio", { name: "En rotation" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Enregistrer" }));
    await gone();
    expect(await stored()).toEqual({ mode: "rotation", days });
    expect(await written()).toHaveLength(1);
    await waitFor(async () =>
      expect((await row()).textContent).toBe("Rythme A, B, C à la suite En rotation"),
    );
    // Fixed days again: the stored days, not a proposal.
    sheet = await openSheet();
    fireEvent.click(within(sheet).getByRole("radio", { name: "Jours fixes" }));
    expect(await within(sheet).findByText("Un tap change un jour.")).toBeTruthy();
    expect(chosen(sheet)).toEqual(["A", "Repos", "B", "Repos", "Repos", "Repos", "Repos"]);
  });

  it("uses tokens only", () => {
    expectTokensOnly("workouts/rhythm-sheet.tsx");
  });
});
