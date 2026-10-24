import type { Change } from "@belay/shared/sync/schema";
import {
  addSession,
  addSlot,
  chooseActive,
  createProgram,
  placeSession,
  renameProgram,
  renameSession,
} from "@belay/shared/training/program-edits";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import {
  SEED_PROGRAM_ID,
  seedId,
  type StoredPrograms,
} from "@belay/shared/training/stored-program";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readPrograms, recordChanges } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";

// The programs' read, watched.
vi.mock("../sync/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../sync/db")>();
  return { ...real, readPrograms: vi.fn(real.readPrograms) };
});

// Wednesday 7 October 2026, 18:00 on the phone's clock.
beforeEach(() => {
  indexedDB = new IDBFactory();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 7, 18, 0));
  writeLastUser(ADA);
  fakeApi({ me: ADA });
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(readPrograms).mockClear();
  await i18n.changeLanguage("en");
});

const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e${String(n).padStart(2, "0")}`;
// A finished session of `code` begun on day `d` of October at 18:00 (local time), with the
// session it came from when given.
const done = (n: number, code: string, d: number, sessionId?: string): Change[] => {
  const start = new Date(2026, 9, d, 18, 0).toISOString();
  const end = new Date(2026, 9, d, 19, 0).toISOString();
  return [
    {
      kind: "workout",
      id: id(n),
      field: "start",
      sessionCode: code,
      ...(sessionId && { sessionId }),
      plan: [...(sessionByCode(code, starterProgram) ?? sessionByCode("A", starterProgram)!).slots],
      startedAt: start,
      at: start,
    },
    { kind: "workout", id: id(n), field: "ended", value: end, at: end },
  ];
};
// The cards in their order, by title: the next one as a region, the others as links.
const cards = async () =>
  (await screen.findAllByRole("heading", { level: 2, name: /^(Session|Séance) / })).map(
    (h) => h.textContent!,
  );
const cardLink = (title: string) => screen.getByRole("link", { name: new RegExp(`^${title}`) });

describe("the program as cards (spec D13, §4.5)", () => {
  it("puts the next session first, then when each other one was last done", async () => {
    await seed(ADA.id, [...done(1, "A", 3), ...done(2, "B", 4)]);
    renderRoute("/workouts?tab=program");
    expect(await cards()).toEqual([
      "Session C · Glutes + light pull",
      "Session A · Push",
      "Session B · Legs",
    ]);
    const c = screen.getByRole("region", { name: "Session C · Glutes + light pull" });
    // No climb this week: the rule's two slots count.
    expect(c.textContent).toContain("Next up · 10 exercises · about 60 min");
    const a = cardLink("Session A · Push");
    expect(a.textContent).toContain("4 days ago · 6 exercises · about 55 min");
    expect(cardLink("Session B · Legs").textContent).toContain("3 days ago");
  });

  it("the next card's button is See the session and pushes its preview", async () => {
    await seed(ADA.id, done(1, "C", 3));
    const router = renderRoute("/workouts?tab=program");
    const a = await screen.findByRole("region", { name: "Session A · Push" });
    const see = within(a).getByRole("link", { name: "See the session" });
    expect(see.getAttribute("href")).toBe("/workouts/session/A");
    fireEvent.click(see);
    expect(await screen.findByRole("heading", { name: "Session A · Push", level: 1 })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/workouts/session/A");
  });

  it("another card opens its preview on a tap anywhere", async () => {
    await seed(ADA.id, done(1, "C", 3));
    const router = renderRoute("/workouts?tab=program");
    await cards();
    const b = cardLink("Session B · Legs");
    expect(b.getAttribute("href")).toBe("/workouts/session/B");
    // The whole card is the one link: its title and its line sit inside it, with no button.
    expect(within(b).getByRole("heading", { level: 2, name: "Session B · Legs" })).toBeTruthy();
    expect(b.textContent).toContain("Never done · 7 exercises");
    expect(within(b).queryByRole("button")).toBeNull();
    fireEvent.click(within(b).getByText(/Never done/));
    expect(await screen.findByRole("heading", { name: "Session B · Legs", level: 1 })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/workouts/session/B");
  });

  it("no card shows Start or a See list", async () => {
    await seed(ADA.id, done(1, "A", 3));
    renderRoute("/workouts?tab=program");
    await cards();
    expect(screen.queryByRole("link", { name: "Start" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^(See|Hide)$/ })).toBeNull();
    expect(within(screen.getByRole("main")).queryByRole("list")).toBeNull();
    expect(screen.queryByRole("link", { name: /Barbell bench press/ })).toBeNull();
  });

  it("with A open, A's card resumes it and B's card opens B's preview", async () => {
    const begun = new Date(2026, 9, 7, 17, 30).toISOString();
    await seed(ADA.id, [
      {
        kind: "workout",
        id: id(1),
        field: "start",
        sessionCode: "A",
        plan: [...sessionByCode("A", starterProgram)!.slots],
        startedAt: begun,
        at: begun,
      },
    ]);
    renderRoute("/workouts?tab=program");
    const a = await screen.findByRole("region", { name: "Session A · Push" });
    expect(within(a).getByRole("link", { name: "Resume" }).getAttribute("href")).toBe(
      "/workout?start=A",
    );
    expect(within(a).queryByRole("link", { name: "See the session" })).toBeNull();
    expect(cardLink("Session B · Legs").getAttribute("href")).toBe("/workouts/session/B");
    expect(cardLink("Session C · Glutes \\+ light pull").getAttribute("href")).toBe(
      "/workouts/session/C",
    );
    expect(screen.getAllByRole("link", { name: "Resume" })).toHaveLength(1);
  });

  it("with A open, A's card says In progress · 1 of 19 sets and still resumes it", async () => {
    const begun = new Date(2026, 9, 7, 17, 30).toISOString();
    const plan = [...sessionByCode("A", starterProgram)!.slots];
    await seed(ADA.id, [
      {
        kind: "workout",
        id: id(1),
        field: "start",
        sessionCode: "A",
        plan,
        startedAt: begun,
        at: begun,
      },
      // A warm-up does not count; the one work set does.
      ...[0, 3].map((position, k): Change => ({
        kind: "set",
        id: id(10 + k),
        workoutId: id(1),
        field: "create",
        slotIndex: 0,
        position,
        exerciseId: plan[0]!.exerciseId,
        warmup: position < 3,
        weightKg: 60,
        reps: 8,
        seconds: null,
        rir: position < 3 ? null : 2,
        doneAt: begun,
        at: begun,
      })),
    ]);
    renderRoute("/workouts?tab=program");
    const a = await screen.findByRole("region", { name: "Session A · Push" });
    expect(a.textContent).toContain("In progress · 1 of 19 sets");
    expect(within(a).getByRole("link", { name: "Resume" }).getAttribute("href")).toBe(
      "/workout?start=A",
    );
  });

  it("says never done, done today, and counts C without its rule once climbed", async () => {
    await seed(ADA.id, [
      ...done(1, "B", 7),
      {
        kind: "activity",
        id: id(90),
        field: "fields",
        date: "2026-10-05",
        type: "climbing",
        durationMin: 90,
        cardioType: null,
        climbStyle: null,
        climbRuns: null,
        climbGrade: null,
        climbColor: null,
        at: "2026-10-05T18:00:00.000Z",
      },
    ]);
    renderRoute("/workouts?tab=program");
    await cards();
    expect(
      screen.getByRole("region", { name: "Session C · Glutes + light pull" }).textContent,
    ).toContain("Next up · 8 exercises");
    expect(cardLink("Session A · Push").textContent).toContain("Never done");
    expect(cardLink("Session B · Legs").textContent).toContain("Done today");
  });

  it("says it in French", async () => {
    await seed(ADA.id, done(1, "A", 3));
    await i18n.changeLanguage("fr");
    renderRoute("/workouts?tab=program");
    const b = await screen.findByRole("region", { name: "Séance B · Legs" });
    expect(b.textContent).toContain("La prochaine · 7 exercices · environ 60 min");
    expect(within(b).getByRole("link", { name: "Voir la séance" })).toBeTruthy();
    expect(cardLink("Séance A · Push").textContent).toContain("Il y a 4 jours");
  });
});

// Program edits as the editor queues them, built on what the phone holds.
async function edit(build: (p: StoredPrograms) => Change[] | null) {
  const db = await openAccountDb(ADA.id);
  await recordChanges(db, build(await readPrograms(db))!);
  db.close();
}
const EDIT_AT = "2026-10-01T06:00:00.000Z";
const D = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f0d";
const E = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f0e";
const OTHER = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f20";
// Every read of the programs answered and the screen given its turn.
async function settled() {
  await vi.waitFor(() => expect(readPrograms).toHaveBeenCalled());
  await act(async () => {
    await Promise.all(vi.mocked(readPrograms).mock.results.map((r) => r.value));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}
// Each card's address, in order: the next one's button, the others' whole card.
const hrefs = () =>
  screen
    .getAllByRole("link")
    .map((a) => a.getAttribute("href")!)
    .filter((href) => /^\/workouts\/session\/[A-Z]$/.test(href));

describe("the program cards read the active program", () => {
  it("list the active rotation from the next session", async () => {
    for (const [session, slot] of [
      [D, "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f1d"],
      [E, "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f1e"],
    ] as const) {
      await edit((p) => addSession(p, session, SEED_PROGRAM_ID, EDIT_AT));
      await edit((p) => addSlot(p, slot, session, { id: "ds:0025", measure: "reps" }, EDIT_AT));
    }
    await seed(ADA.id, done(1, "C", 3, seedId(3)));
    renderRoute("/workouts?tab=program");
    const d = await screen.findByRole("region", { name: /^Session D/ });
    expect(d.textContent).toMatch(/Next up · 1 exercise · about \d+\u00A0min/);
    expect(hrefs()).toEqual(["D", "E", "A", "B", "C"].map((c) => `/workouts/session/${c}`));
  });

  it("leave a set-aside session out", async () => {
    // Legs set aside: Glutes moves up to B.
    await edit((p) => placeSession(p, seedId(2), null, 0, EDIT_AT));
    await seed(ADA.id, done(1, "A", 3, seedId(1)));
    renderRoute("/workouts?tab=program");
    const b = await screen.findByRole("region", { name: /^Session B/ });
    expect(b.textContent).toContain("Next up · 10 exercises · about 60\u00A0min");
    expect(hrefs()).toEqual(["/workouts/session/B", "/workouts/session/A"]);
  });

  it("show no card for an empty rotation", async () => {
    await edit((p) => createProgram(p, OTHER, EDIT_AT));
    await edit((p) => chooseActive(p, OTHER, EDIT_AT));
    renderRoute("/workouts?tab=program");
    await screen.findByText(/^The program is edited on a computer/);
    await settled();
    expect(screen.queryAllByRole("heading", { level: 2, name: /^Session / })).toEqual([]);
  });

  it("show no card when the active program was removed on another device", async () => {
    await edit((p) => createProgram(p, OTHER, EDIT_AT));
    await edit((p) => chooseActive(p, OTHER, EDIT_AT));
    await edit(() => [{ kind: "program", id: OTHER, field: "removed", value: true, at: EDIT_AT }]);
    renderRoute("/workouts?tab=program");
    await screen.findByText(/^The program is edited on a computer/);
    await settled();
    expect(screen.queryAllByRole("heading", { level: 2, name: /^Session / })).toEqual([]);
  });
});

const ASIDE = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f30";
const ASIDE_SLOT = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f31";
const OTHER_SESSION = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f21";
const OTHER_SLOT = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f22";
// A second program « Summer » holding one session with the bench press.
async function summer() {
  await edit((p) => createProgram(p, OTHER, EDIT_AT));
  await edit(() => renameProgram(OTHER, "Summer", EDIT_AT));
  await edit((p) => addSession(p, OTHER_SESSION, OTHER, EDIT_AT));
  await edit((p) =>
    addSlot(p, OTHER_SLOT, OTHER_SESSION, { id: "ds:0025", measure: "reps" }, EDIT_AT),
  );
}
// The row above the cards, by its program's name.
const activeRow = (name: string | RegExp) => screen.findByRole("button", { name });

describe("the active program on Programme", () => {
  it("a row above the cards names the active program and the number of its sessions", async () => {
    await summer();
    renderRoute("/workouts?tab=program");
    const row = await activeRow(/^Starter program/);
    expect(row.textContent).toContain("Active program · 3 sessions");
    const [first] = await screen.findAllByRole("heading", { level: 2, name: /^Session / });
    expect(row.compareDocumentPosition(first!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says it in French", async () => {
    await i18n.changeLanguage("fr");
    renderRoute("/workouts?tab=program");
    expect((await activeRow(/^Programme de départ/)).textContent).toContain(
      "Programme actif · 3 séances",
    );
  });

  it("the row opens a sheet listing the programs with a check on the active one; a tap activates another and closes", async () => {
    await summer();
    renderRoute("/workouts?tab=program");
    fireEvent.click(await activeRow(/^Starter program/));
    const sheet = await screen.findByRole("dialog", { name: "Active program" });
    const choices = within(sheet).getAllByRole("button", { name: /sessions?$/ });
    expect(choices.map((b) => b.textContent!.trim())).toEqual([
      "Starter program 3 sessions",
      "Summer 1 session",
    ]);
    expect(choices[0]!.getAttribute("aria-current")).toBe("true");
    expect(choices[1]!.getAttribute("aria-current")).toBeNull();
    expect(
      within(sheet).getByText(
        "One tap makes it active and closes. Creating, renaming or deleting a program happens on a computer.",
      ),
    ).toBeTruthy();
    fireEvent.click(choices[1]!);
    await waitForGone(() => screen.queryByRole("dialog"));
    expect((await activeRow(/^Summer/)).textContent).toContain("Active program · 1 session");
    expect(await cards()).toEqual(["Session A"]);
    const db = await openAccountDb(ADA.id);
    expect((await readPrograms(db)).activeId).toBe(OTHER);
    db.close();
  });

  it("a tap on the active program just closes the sheet", async () => {
    await summer();
    renderRoute("/workouts?tab=program");
    fireEvent.click(await activeRow(/^Starter program/));
    const sheet = await screen.findByRole("dialog", { name: "Active program" });
    fireEvent.click(within(sheet).getByRole("button", { name: /^Starter program/ }));
    await waitForGone(() => screen.queryByRole("dialog"));
    const db = await openAccountDb(ADA.id);
    expect((await readPrograms(db)).activeAt).toBeNull();
    db.close();
  });

  it("without an account there is no row", async () => {
    fakeApi({ me: null });
    localStorage.clear();
    renderRoute("/workouts?tab=program");
    await cards();
    expect(screen.queryByRole("button", { name: /Active program|Starter program/ })).toBeNull();
  });
});

describe("sessions set aside on Programme", () => {
  it("De côté lists each set-aside session with its size, each linking to its preview", async () => {
    await edit((p) => addSession(p, ASIDE, null, EDIT_AT));
    await edit(() => renameSession(ASIDE, "Léa's full body", EDIT_AT));
    await edit((p) => addSlot(p, ASIDE_SLOT, ASIDE, { id: "ds:0025", measure: "reps" }, EDIT_AT));
    renderRoute("/workouts?tab=program");
    const aside = await screen.findByRole("region", { name: "Set aside · out of the rotation" });
    const [row, ...others] = within(aside).getAllByRole("link");
    expect(others).toEqual([]);
    expect(row!.textContent).toMatch(/^Léa's full body 1 exercise · about \d+\u00A0min$/);
    expect(row!.getAttribute("href")).toBe(`/workouts/session/${ASIDE}`);
    // Under the cards.
    const [first] = await screen.findAllByRole("heading", { level: 2, name: /^Session / });
    expect(first!.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says it in French", async () => {
    await edit((p) => placeSession(p, seedId(2), null, 0, EDIT_AT));
    await i18n.changeLanguage("fr");
    renderRoute("/workouts?tab=program");
    const aside = await screen.findByRole("region", { name: "De côté · hors rotation" });
    expect(within(aside).getByRole("link").textContent).toBe("Legs 7 exercices · environ 60 min");
  });

  it("no section when nothing is set aside", async () => {
    renderRoute("/workouts?tab=program");
    await cards();
    await settled();
    expect(screen.queryByRole("region", { name: /^Set aside/ })).toBeNull();
  });
});

describe("the editor's entry on Programme", () => {
  it("from 1 024 px the note becomes « Modifier le programme » to the editor", async () => {
    renderRoute("/workouts?tab=program");
    const note = await screen.findByText("The program is edited on a computer.");
    expect(note.className.split(" ")).toContain("lg:hidden");
    const entry = screen.getByRole("link", { name: "Edit the program" });
    expect(entry.getAttribute("href")).toBe("/workouts/program");
    expect(entry.parentElement!.className.split(" ")).toEqual(
      expect.arrayContaining(["hidden", "lg:block"]),
    );
  });
});

describe("the open session's card", () => {
  it("while a session is open its card shows « En cours » after a reorder", async () => {
    const begun = new Date(2026, 9, 7, 17, 30).toISOString();
    await seed(ADA.id, [
      {
        kind: "workout",
        id: id(1),
        field: "start",
        sessionCode: "A",
        sessionId: seedId(1),
        plan: [...sessionByCode("A", starterProgram)!.slots],
        startedAt: begun,
        at: begun,
      },
    ]);
    // Push moves last: it now reads C, and Legs reads A.
    await edit((p) => placeSession(p, seedId(1), SEED_PROGRAM_ID, 2, EDIT_AT));
    renderRoute("/workouts?tab=program");
    const push = await screen.findByRole("region", { name: "Session C · Push" });
    expect(push.textContent).toContain("In progress");
    expect(within(push).getByRole("link", { name: "Resume" })).toBeTruthy();
    expect(screen.getAllByText(/^In progress/)).toHaveLength(1);
    expect(cardLink("Session A · Legs").getAttribute("href")).toBe("/workouts/session/A");
  });
});

// Waits until the query finds nothing.
const waitForGone = (query: () => HTMLElement | null) =>
  vi.waitFor(() => expect(query()).toBeNull());
