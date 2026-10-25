import type { Change } from "@belay/shared/sync/schema";
import { setSchedule } from "@belay/shared/training/program-edits";
import {
  DEFAULT_SCHEDULE,
  nextInRotation,
  rotationOf,
  SEED,
  SEED_PROGRAM_ID,
} from "@belay/shared/training/stored-program";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readHistory, readOutbox, readPrograms, recordChanges } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA } from "../test/seed";

// The programs on the account: the starting one, « Force 4 jours » of four sessions, active, and
// « Été léger » of two, created in that order.
const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c${n.toString(16).padStart(4, "0")}`;
const T0 = "2026-10-01T06:00:00.000Z";
const FORCE = id(0x10);
const SUMMER = id(0x20);
let slots = 0x1000;
const session = (
  sessionId: string,
  name: string,
  programId: string,
  position: number,
): Change[] => [
  { kind: "programSession", id: sessionId, field: "create", name, programId, position, at: T0 },
  {
    kind: "programSlot",
    id: id(slots++),
    field: "create",
    sessionId,
    position: 0,
    rule: null,
    exerciseId: "ds:0025",
    sets: 3,
    repRange: [8, 12],
    rirTarget: [1, 2],
    restSec: 90,
    warmupSets: 0,
    isMain: false,
    groupKey: null,
    at: T0,
  },
];
const program = (programId: string, name: string): Change => ({
  kind: "program",
  id: programId,
  field: "create",
  name,
  schedule: DEFAULT_SCHEDULE,
  at: T0,
});
const PROGRAMS: Change[] = [
  program(FORCE, "Force 4 jours"),
  program(SUMMER, "Été léger"),
  { kind: "activeProgram", programId: FORCE, at: T0 },
  ...session(id(0x11), "Haut lourd", FORCE, 0),
  ...session(id(0x12), "Bas lourd", FORCE, 1),
  ...session(id(0x13), "Haut léger", FORCE, 2),
  ...session(id(0x14), "Bas léger", FORCE, 3),
  ...session(id(0x21), "Jambes", SUMMER, 0),
  ...session(id(0x22), "Dos", SUMMER, 1),
];

async function seed(changes: Change[]) {
  const db = await openAccountDb(ADA.id);
  await recordChanges(db, changes);
  db.close();
}
async function stored() {
  const db = await openAccountDb(ADA.id);
  const [programs, history] = await Promise.all([readPrograms(db), readHistory(db)]);
  db.close();
  return { programs, history };
}

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
  await i18n.changeLanguage("en");
});

// Spaces as a reader sees them: the narrow and no-break ones read as plain spaces.
const plain = (text: string | null) => (text ?? "").replace(/\s/g, " ");
const selector = (name: string) =>
  screen.findByRole("button", { name: new RegExp(`^Programme actif\\s:\\s${name}\\.\\sChanger`) });
async function openMenu(name = "Force 4 jours") {
  const trigger = await selector(name);
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.findByRole("menu");
}
const choose = async (label: RegExp | string) => {
  await act(async () => fireEvent.click(await screen.findByRole("menuitem", { name: label })));
};
const toastText = async (text: RegExp) =>
  waitFor(() =>
    expect(screen.getAllByRole("status").some((s) => text.test(plain(s.textContent)))).toBe(true),
  );
const chips = async () =>
  within(await screen.findByRole("tablist", { name: "Séances du programme" }))
    .getAllByRole("tab")
    .map((tab) => tab.getAttribute("aria-label") ?? tab.textContent);
const nameField = () => screen.findByRole("textbox", { name: "Nom du programme" });
const liveSessions = (
  programs: Awaited<ReturnType<typeof stored>>["programs"],
  programId: string,
) => programs.sessions.filter((s) => s.programId === programId && !s.removed);

describe("the program switcher", () => {
  beforeEach(() => seed(PROGRAMS));

  it("the menu lists programs in creation order with their counts and a check on the active one", async () => {
    renderRoute("/workouts/program");
    const menu = await openMenu();
    expect(plain(within(menu).getByText(/^Tes programmes/).textContent)).toBe(
      "Tes programmes · un seul est actif",
    );
    const programs = within(menu).getAllByRole("menuitemradio");
    expect(programs.map((p) => plain(p.textContent))).toEqual([
      "Programme de départ3 séances",
      "Force 4 jours4 séances · actif",
      "Été léger2 séances",
    ]);
    expect(programs.map((p) => p.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Nouveau programme", "Renommer ce programme", "Supprimer ce programme"]);
  });

  it("choosing one activates it and the toast names it and its next session", async () => {
    renderRoute("/workouts/program");
    const menu = await openMenu();
    await act(async () =>
      fireEvent.click(within(menu).getByRole("menuitemradio", { name: /^Été léger/ })),
    );
    await waitFor(async () => expect((await stored()).programs.activeId).toBe(SUMMER));
    await toastText(/^Été léger est actif : la prochaine séance est A · Jambes\.Annuler$/);
    await waitFor(async () => expect(await chips()).toEqual(["A · Jambes", "B · Dos"]));
    expect(await selector("Été léger")).toBeTruthy();
  });

  it("switching to a program on fixed days names its planned session in the toast", async () => {
    // Été léger holds Jambes on Mondays and Dos on Wednesdays; today is a Wednesday, so Dos comes
    // first where the rotation would offer Jambes.
    const days = [id(0x21), null, id(0x22), null, null, null, null];
    await seed(setSchedule(SUMMER, { mode: "fixed", days }, "2026-10-02T06:00:00.000Z"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 21, 8, 0));
    try {
      renderRoute("/workouts/program");
      const menu = await openMenu();
      await act(async () =>
        fireEvent.click(within(menu).getByRole("menuitemradio", { name: /^Été léger/ })),
      );
      await toastText(/^Été léger est actif : la prochaine séance est B · Dos\.Annuler$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Annuler makes the previous one active with the same next session", async () => {
    // Session B of Force was done last: Force offers C next.
    await seed([
      {
        kind: "workout",
        id: id(0x900),
        field: "start",
        sessionCode: "B",
        sessionId: id(0x12),
        plan: [
          {
            exerciseId: "ds:0025",
            sets: 3,
            repRange: [8, 12],
            rirTarget: [1, 2],
            restSec: 90,
            warmupSets: 0,
            isMain: false,
            groupKey: null,
          },
        ],
        startedAt: "2026-10-05T16:00:00.000Z",
        at: "2026-10-05T16:00:00.000Z",
      },
      {
        kind: "workout",
        id: id(0x900),
        field: "ended",
        value: "2026-10-05T17:00:00.000Z",
        at: "2026-10-05T17:00:00.000Z",
      },
    ]);
    const next = async () => {
      const { programs, history } = await stored();
      return nextInRotation(history.workouts, rotationOf(programs), programs.activeAt)?.sessionId;
    };
    expect(await next()).toBe(id(0x13));
    renderRoute("/workouts/program");
    const menu = await openMenu();
    await act(async () =>
      fireEvent.click(within(menu).getByRole("menuitemradio", { name: /^Été léger/ })),
    );
    await waitFor(async () => expect((await stored()).programs.activeId).toBe(SUMMER));
    const undo = await screen.findByRole("button", { name: "Annuler" });
    await act(async () => fireEvent.click(undo));
    await waitFor(async () => expect((await stored()).programs.activeId).toBe(FORCE));
    expect(await next()).toBe(id(0x13));
    await waitFor(async () =>
      expect(await chips()).toEqual([
        "A · Haut lourd",
        "B · Bas lourd",
        "C · Haut léger",
        "D · Bas léger",
      ]),
    );
  });

  it("Vide creates one empty session, active, its name opened", async () => {
    renderRoute("/workouts/program");
    await openMenu();
    await act(async () =>
      fireEvent.click(await screen.findByRole("menuitem", { name: "Nouveau programme" })),
    );
    const menu = await screen.findByRole("menu");
    expect(plain(within(menu).getByText(/^Nouveau programme ·/).textContent)).toBe(
      "Nouveau programme · il devient actif",
    );
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => plain(i.textContent)),
    ).toEqual([
      "Videune séance vide, tu la remplis",
      "Programme de départA · Push, B · Legs, C · Fessiers + tirage léger",
      "Copie de « Force 4 jours »les mêmes séances, à modifier",
    ]);
    await choose(/^Vide/);
    const field = await nameField();
    expect((field as HTMLInputElement).value).toBe("Nouveau programme");
    await waitFor(() => expect(document.activeElement).toBe(field));
    const { programs } = await stored();
    const created = programs.programs.find((p) => p.id === programs.activeId)!;
    expect(created).toMatchObject({ name: "Nouveau programme", removed: false });
    expect(created.id).not.toBe(FORCE);
    const sessions = liveSessions(programs, created.id);
    expect(sessions).toHaveLength(1);
    expect(programs.slots.filter((s) => s.sessionId === sessions[0]!.id)).toEqual([]);
    await toastText(/^Nouveau programme créé, il est actif\./);
  });

  it("Programme de départ and Copie de « X » create with new ids", async () => {
    renderRoute("/workouts/program");
    await openMenu();
    await choose("Nouveau programme");
    await choose(/^Programme de départ/);
    await waitFor(async () => expect((await stored()).programs.activeId).not.toBe(FORCE));
    let { programs } = await stored();
    const starter = programs.programs.find((p) => p.id === programs.activeId)!;
    expect(starter.name).toBe("Programme de départ");
    expect(starter.id).not.toBe(SEED_PROGRAM_ID);
    const copied = liveSessions(programs, starter.id);
    expect(copied).toHaveLength(3);
    for (const s of copied) expect(SEED.sessions.some((x) => x.id === s.id)).toBe(false);
    fireEvent.keyDown(await nameField(), { key: "Escape" });

    // Back to Force, then its copy.
    await openMenu("Programme de départ");
    await act(async () =>
      fireEvent.click(await screen.findByRole("menuitemradio", { name: /^Force 4 jours/ })),
    );
    await waitFor(async () => expect((await stored()).programs.activeId).toBe(FORCE));
    await openMenu();
    await choose("Nouveau programme");
    await choose(/^Copie de/);
    await waitFor(async () => expect((await stored()).programs.activeId).not.toBe(FORCE));
    ({ programs } = await stored());
    const copy = programs.programs.find((p) => p.id === programs.activeId)!;
    expect(copy.name).toBe("Copie de Force 4 jours");
    const sessions = liveSessions(programs, copy.id);
    expect(sessions.map((s) => s.name)).toEqual([
      "Haut lourd",
      "Bas lourd",
      "Haut léger",
      "Bas léger",
    ]);
    const source = liveSessions(programs, FORCE).map((s) => s.id);
    for (const s of sessions) {
      expect(source).not.toContain(s.id);
      expect(programs.slots.filter((x) => x.sessionId === s.id && !x.removed)).toHaveLength(1);
    }
  });

  it("rename saves on Enter, cancels on Escape, refuses 61 characters", async () => {
    renderRoute("/workouts/program");
    await openMenu();
    await choose("Renommer ce programme");
    let field = (await nameField()) as HTMLInputElement;
    expect(field.value).toBe("Force 4 jours");
    expect(field.maxLength).toBe(60);
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.change(field, { target: { value: "  Force 4 jours d'hiver " } });
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    await waitFor(async () =>
      expect((await stored()).programs.programs.find((p) => p.id === FORCE)!.name).toBe(
        "Force 4 jours d'hiver",
      ),
    );
    expect(await selector("Force 4 jours d'hiver")).toBeTruthy();

    await openMenu("Force 4 jours d'hiver");
    await choose("Renommer ce programme");
    field = (await nameField()) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Autre" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(await selector("Force 4 jours d'hiver")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Nom du programme" })).toBeNull();

    await openMenu("Force 4 jours d'hiver");
    await choose("Renommer ce programme");
    field = (await nameField()) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "x".repeat(61) } });
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    expect(screen.getByRole("textbox", { name: "Nom du programme" })).toBe(field);
    expect((await stored()).programs.programs.find((p) => p.id === FORCE)!.name).toBe(
      "Force 4 jours d'hiver",
    );
  });

  it("refuses a name with a control character as a refusal, not as a change made elsewhere", async () => {
    renderRoute("/workouts/program");
    await openMenu();
    await choose("Renommer ce programme");
    const field = (await nameField()) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Force\u0007" } });
    await act(async () => fireEvent.keyDown(field, { key: "Enter" }));
    expect(
      await screen.findByText("Pas enregistré : cette modification n'est pas possible ici."),
    ).toBeTruthy();
    expect(screen.queryByText(/a changé ailleurs/)).toBeNull();
    expect(screen.getByRole("textbox", { name: "Nom du programme" })).toBe(field);
    expect((await stored()).programs.programs.find((p) => p.id === FORCE)!.name).toBe(
      "Force 4 jours",
    );
  });

  it("a click away saves the name; Enter then the click away writes it once; Escape still cancels", async () => {
    const api = fakeApi({ me: ADA });
    // Each name written, sent already or still queued.
    const names = async () => {
      const db = await openAccountDb(ADA.id);
      const queued = (await readOutbox(db)).map((e) => e.change);
      db.close();
      return [...api.requests.flatMap((r) => r.changes), ...queued]
        .filter((c) => c.kind === "program" && c.id === FORCE && c.field === "name")
        .map((c) => (c as { value: unknown }).value);
    };
    const before = (await names()).length;
    renderRoute("/workouts/program");

    await openMenu();
    await choose("Renommer ce programme");
    fireEvent.change(await nameField(), { target: { value: "Force d'hiver" } });
    await act(async () => (await nameField()).blur());
    expect(await selector("Force d'hiver")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Nom du programme" })).toBeNull();

    await openMenu("Force d'hiver");
    await choose("Renommer ce programme");
    const typed = await nameField();
    fireEvent.change(typed, { target: { value: "Force de printemps" } });
    await act(async () => {
      fireEvent.keyDown(typed, { key: "Enter" });
      typed.blur();
    });
    expect(await selector("Force de printemps")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await names()).slice(before)).toEqual(["Force d'hiver", "Force de printemps"]);

    await openMenu("Force de printemps");
    await choose("Renommer ce programme");
    const kept = await nameField();
    fireEvent.change(kept, { target: { value: "Autre" } });
    await act(async () => {
      fireEvent.keyDown(kept, { key: "Escape" });
      kept.blur();
    });
    expect(await selector("Force de printemps")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await names()).slice(before)).toEqual(["Force d'hiver", "Force de printemps"]);
  });

  it("Supprimer asks on the sheet naming the program, its session count and the one that becomes active; confirming removes it", async () => {
    renderRoute("/workouts/program");
    await openMenu();
    await choose("Supprimer ce programme");
    const sheet = await screen.findByRole("dialog");
    expect(plain(within(sheet).getByRole("heading").textContent)).toBe(
      "Supprimer le programme « Force 4 jours » ?",
    );
    expect(plain(sheet.textContent)).toContain(
      "Ses 4 séances partent avec lui. Programme de départ redevient actif. L'historique ne change pas.",
    );
    await act(async () =>
      fireEvent.click(within(sheet).getByRole("button", { name: "Supprimer le programme" })),
    );
    await waitFor(async () => {
      const { programs } = await stored();
      expect(programs.activeId).toBe(SEED_PROGRAM_ID);
      expect(programs.programs.find((p) => p.id === FORCE)!.removed).toBe(true);
    });
    expect(await selector("Programme de départ")).toBeTruthy();
    // Confirmed on the sheet, so no toast offers to take it back.
    expect(screen.queryByRole("button", { name: "Annuler" })).toBeNull();
  });

  it("past 20 programs the toast says the limit", async () => {
    await seed(Array.from({ length: 17 }, (_, i) => program(id(0x30 + i), `P${i}`)));
    renderRoute("/workouts/program");
    await openMenu();
    await choose("Nouveau programme");
    await choose(/^Vide/);
    await toastText(/^Le compte garde 20 programmes au plus\./);
    expect((await stored()).programs.activeId).toBe(FORCE);
    expect(screen.queryByRole("textbox", { name: "Nom du programme" })).toBeNull();
  });
});

describe("with one program", () => {
  it("the delete row is the neutral line", async () => {
    renderRoute("/workouts/program");
    const menu = await openMenu("Programme de départ");
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(1);
    expect(within(menu).queryByRole("menuitem", { name: "Supprimer ce programme" })).toBeNull();
    expect(within(menu).getByText("Il reste au moins un programme.")).toBeTruthy();
  });
});
