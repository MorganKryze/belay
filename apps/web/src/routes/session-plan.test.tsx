import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readActiveSession, readHistory, recordChange } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";

// Wednesday 7 October 2026, 18:00 on the phone's clock.
const NOW = new Date(2026, 9, 7, 18, 0);
beforeEach(() => {
  indexedDB = new IDBFactory();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  writeLastUser(ADA);
  fakeApi({ me: ADA });
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e${String(n).padStart(2, "0")}`;
const at = (d: Date) => d.toISOString();
const MONDAY = new Date(2026, 9, 5, 18, 0);
// A climb on Monday of this week, as the activity sheet records it.
const climbOn = (date: string): Change => ({
  kind: "activity",
  id: id(90),
  field: "fields",
  date,
  type: "climbing",
  durationMin: 90,
  cardioType: null,
  climbStyle: "boulder",
  climbRuns: 14,
  climbGrade: "6b+",
  climbColor: null,
  at: at(MONDAY),
});
// Session B on Monday: the goblet squat, never the barbell one, at 24 kg × 10.
const LAST_B: Change[] = [
  {
    kind: "workout",
    id: id(1),
    field: "start",
    sessionCode: "B",
    plan: [{ ...sessionByCode("B", starterProgram)!.slots[0]!, exerciseId: "ds:1760" }],
    startedAt: at(MONDAY),
    at: at(MONDAY),
  },
  {
    kind: "set",
    id: id(10),
    workoutId: id(1),
    field: "create",
    slotIndex: 0,
    position: 3,
    exerciseId: "ds:1760",
    warmup: false,
    weightKg: 24,
    reps: 10,
    seconds: null,
    rir: 2,
    doneAt: at(MONDAY),
    at: at(MONDAY),
  },
  {
    kind: "workout",
    id: id(1),
    field: "ended",
    value: at(new Date(2026, 9, 5, 19, 0)),
    at: at(new Date(2026, 9, 5, 19, 0)),
  },
];

const later = (seconds: number) =>
  act(() => vi.setSystemTime(new Date(Date.now() + seconds * 1000)));
const NAMES: Record<string, string> = { A: "Push", B: "Legs", C: "Glutes + light pull" };
const startSession = async (code: string) => {
  renderRoute(`/workout?start=${code}`);
  return screen.findByRole("heading", { name: `Session ${code} · ${NAMES[code]}`, level: 1 });
};
const card = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name}`) });
const field = (scope: HTMLElement, name: string) =>
  within(scope).getByRole("textbox", { name }) as HTMLInputElement;
const log = (scope: HTMLElement, name: string) =>
  fireEvent.click(within(scope).getByRole("button", { name }));
const stored = async () => {
  const db = await openAccountDb(ADA.id);
  const result = { history: await readHistory(db), active: await readActiveSession(db) };
  db.close();
  return result;
};
const session = async () => (await stored()).history.workouts.find((w) => w.id !== id(1))!;

describe("session C's rule (spec D6, §4.3)", () => {
  it("adds the pulldown and the curl in a week with no climb, each one to leave out", async () => {
    await seed(ADA.id, LAST_B); // the last session was B: C comes next
    renderRoute("/");
    expect((await screen.findByRole("region", { name: /^Session C/ })).textContent).toContain(
      "Next up · 10 exercises · about 60 min",
    );
    cleanup();
    await startSession("C");
    expect(
      screen.getByText(
        "No climbing this week: vertical pull and curl added at the end of the session.",
      ),
    ).toBeTruthy();
    const pulldown = card("Cable lat pulldown full range of motion");
    expect(pulldown.textContent).toContain("added, no climbing");
    fireEvent.click(within(pulldown).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(card("Cable lat pulldown full range of motion").textContent).toContain(
        "left out today",
      ),
    );
    expect((await session()).plan[8]).toMatchObject({ rule: "no_climbing", skipped: true });
    // Finish counts the sets left in the slots done today: 21 of C and the curl's 2, less one.
    const thrust = card("Barbell hip thrust");
    fireEvent.change(field(thrust, "Load of set 1, kg"), { target: { value: "60" } });
    fireEvent.change(field(thrust, "Reps of set 1"), { target: { value: "10" } });
    log(thrust, "Log set 1");
    await waitFor(() => within(thrust).getByRole("img", { name: "Set 1 logged" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(
      await screen.findByText(
        "1 set logged out of 23. The 22 unticked sets won't be saved; your program doesn't change.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep going" }));
    fireEvent.click(
      within(card("Cable lat pulldown full range of motion")).getByRole("button", {
        name: "Put back",
      }),
    );
    await waitFor(async () => expect((await session()).plan[8]!.skipped).toBe(false));
  });

  it("adds nothing once a climb is recorded this week, and never changes a session begun", async () => {
    await seed(ADA.id, [climbOn("2026-10-05")]);
    await startSession("C");
    expect(screen.queryByText(/No climbing this week/)).toBeNull();
    expect((await session()).plan).toHaveLength(8);
    cleanup();
    // Another week's session C, begun with no climb; a climb logged afterwards changes nothing.
    indexedDB = new IDBFactory();
    await startSession("C");
    await waitFor(async () => expect((await session()).plan).toHaveLength(10));
    const db = await openAccountDb(ADA.id);
    await recordChange(db, climbOn("2026-10-07"));
    db.close();
    cleanup();
    renderRoute("/workout");
    expect(
      await screen.findByText(
        "No climbing this week: vertical pull and curl added at the end of the session.",
      ),
    ).toBeTruthy();
    expect((await session()).plan).toHaveLength(10);
  });
});

describe("replacing an exercise (spec D7, §4.3)", () => {
  it("offers the program's alternatives with their last time, then the library", async () => {
    await seed(ADA.id, LAST_B);
    await startSession("B");
    const squat = card("Barbell full squat");
    fireEvent.click(within(squat).getByRole("button", { name: "Replace" }));
    const sheet = await screen.findByRole("dialog", { name: "Replace Barbell full squat" });
    const planned = within(sheet).getByRole("region", { name: "Planned in your program" });
    expect(
      within(planned)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([
      expect.stringContaining("Dumbbell goblet squat"),
      expect.stringContaining("Sled 45° leg press"),
    ]);
    expect(within(planned).getAllByRole("button")[0]!.textContent).toContain(
      "Quads · Dumbbell · last time 24 kg × 10",
    );
    expect(within(planned).getAllByRole("button")[1]!.textContent).toContain("never done");
    expect(
      within(sheet).getByText("For this session only: the program does not change."),
    ).toBeTruthy();
    fireEvent.change(within(sheet).getByRole("searchbox", { name: "Search exercises" }), {
      target: { value: "hack squat" },
    });
    expect(within(sheet).getByRole("status").textContent).toMatch(/exercises?$/);
    expect(within(sheet).getAllByRole("button").length).toBeGreaterThan(2);
  });

  it("keeps the sets already done on the first exercise, the next ones on the new one", async () => {
    await seed(ADA.id, LAST_B);
    await startSession("B");
    let squat = card("Barbell full squat");
    fireEvent.change(field(squat, "Load of set 1, kg"), { target: { value: "100" } });
    fireEvent.change(field(squat, "Reps of set 1"), { target: { value: "5" } });
    log(squat, "Log set 1");
    await waitFor(() => within(squat).getByRole("img", { name: "Set 1 logged" }));
    fireEvent.click(screen.queryByRole("button", { name: "Skip" }) ?? document.body);
    squat = card("Barbell full squat");
    fireEvent.click(within(squat).getByRole("button", { name: "Replace" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: /^Dumbbell goblet squat/,
      }),
    );
    const goblet = await waitFor(() => card("Dumbbell goblet squat"));
    expect(within(goblet).getByText("1 set done with Barbell full squat")).toBeTruthy();
    expect(within(goblet).getByRole("img", { name: "Set 1 logged" })).toBeTruthy();
    // The next set prefills from the goblet squat's own history.
    expect(field(goblet, "Load of set 2, kg").value).toBe("24");
    expect(field(goblet, "Reps of set 2").value).toBe("10");
    log(goblet, "Log set 2");
    await waitFor(async () =>
      expect(
        (await stored()).history.sets
          .filter((s) => s.workoutId !== id(1))
          .map((s) => [s.position, s.exerciseId]),
      ).toEqual([
        [3, "ds:0043"],
        [4, "ds:1760"],
      ]),
    );
    expect((await session()).plan[0]!.exerciseId).toBe("ds:1760");
    expect(sessionByCode("B", starterProgram)!.slots[0]!.exerciseId).toBe("ds:0043"); // the program stays
  });
});

describe("« + Série » and « + Exercice » (spec D7, D8)", () => {
  it("adds a set past the plan without changing the targets", async () => {
    await startSession("A");
    const bench = card("Barbell bench press");
    expect(within(bench).queryByRole("textbox", { name: "Load of set 5, kg" })).toBeNull();
    fireEvent.click(within(bench).getByRole("button", { name: "+ Set" }));
    fireEvent.change(field(bench, "Load of set 5, kg"), { target: { value: "60" } });
    fireEvent.change(field(bench, "Reps of set 5"), { target: { value: "12" } });
    log(bench, "Log set 5");
    await waitFor(async () =>
      expect((await stored()).history.sets.map((s) => s.position)).toEqual([7]),
    );
    expect((await session()).plan[0]!.sets).toBe(4);
    // Every planned set is still to do. Shown as logged first: with nothing logged on screen,
    // Finish opens the other sheet.
    await waitFor(() => within(bench).getByRole("img", { name: "Set 5 logged" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(
      await screen.findByText(
        "0 sets logged out of 19. The 19 unticked sets won't be saved; your program doesn't change.",
      ),
    ).toBeTruthy();
  });

  it("adds an exercise at the end from the library, and leaves it out again", async () => {
    await startSession("A");
    fireEvent.click(screen.getByRole("button", { name: "+ Exercise" }));
    const sheet = await screen.findByRole("dialog", { name: "Add an exercise" });
    expect(within(sheet).queryByRole("region", { name: "Planned in your program" })).toBeNull();
    fireEvent.change(within(sheet).getByRole("searchbox"), { target: { value: "dead hang" } });
    fireEvent.click(within(sheet).getByRole("button", { name: /^Dead hang/ }));
    const hang = await waitFor(() => card("Dead hang"));
    expect(hang.textContent).toContain("3\u00a0×\u00a030–60\u00a0s");
    expect(hang.textContent).toContain("added");
    expect(within(hang).getByText("Seconds")).toBeTruthy();
    expect(within(hang).queryByRole("radiogroup")).toBeNull(); // no RIR for a timed set
    expect((await session()).plan.at(-1)).toMatchObject({
      exerciseId: "belay:dead-hang",
      measure: "seconds",
      added: true,
    });
    fireEvent.click(within(hang).getByRole("button", { name: "Remove" }));
    await waitFor(async () => expect((await session()).plan.at(-1)!.skipped).toBe(true));
  });
});

describe("a timed exercise and its chrono (spec D11, §4.3)", () => {
  const addHang = async () => {
    await startSession("A");
    fireEvent.click(screen.getByRole("button", { name: "+ Exercise" }));
    const sheet = await screen.findByRole("dialog", { name: "Add an exercise" });
    fireEvent.change(within(sheet).getByRole("searchbox"), { target: { value: "dead hang" } });
    fireEvent.click(within(sheet).getByRole("button", { name: /^Dead hang/ }));
    return waitFor(() => card("Dead hang"));
  };

  it("counts down the target, fills the seconds in, and ✓ logs them", async () => {
    const hang = await addHang();
    expect(field(hang, "Seconds of set 1").value).toBe("30");
    fireEvent.change(field(hang, "Seconds of set 1"), { target: { value: "45" } });
    fireEvent.click(within(hang).getByRole("button", { name: "Timer 0:45" }));
    expect((await within(hang).findByRole("timer", { name: "Timer" })).textContent).toBe("0:45");
    await later(46);
    expect(await within(hang).findByText("Timer done")).toBeTruthy();
    log(card("Dead hang"), "Log set 1");
    await waitFor(async () =>
      expect((await stored()).history.sets).toEqual([
        expect.objectContaining({
          exerciseId: "belay:dead-hang",
          weightKg: 0,
          reps: null,
          seconds: 45,
          rir: null,
        }),
      ]),
    );
    expect((await stored()).active?.chrono).toBeNull();
  });

  it("keeps counting from its end time after a reload, then logs the target", async () => {
    const hang = await addHang();
    fireEvent.click(within(hang).getByRole("button", { name: "Timer 0:30" }));
    await within(hang).findByRole("timer");
    cleanup();
    await later(10); // the app was closed for ten seconds
    renderRoute("/workout");
    expect((await screen.findByRole("timer", { name: "Timer" })).textContent).toBe("0:20");
    await later(21);
    await waitFor(() => expect(field(card("Dead hang"), "Seconds of set 1").value).toBe("30"));
    log(card("Dead hang"), "Log set 1");
    await waitFor(async () =>
      expect((await stored()).history.sets.map((s) => s.seconds)).toEqual([30]),
    );
  });

  it("stopped early, keeps the seconds held", async () => {
    const hang = await addHang();
    fireEvent.click(within(hang).getByRole("button", { name: "Timer 0:30" }));
    await within(hang).findByRole("timer");
    await later(12);
    fireEvent.click(within(card("Dead hang")).getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(field(card("Dead hang"), "Seconds of set 1").value).toBe("12"));
  });

  it("stopped and logged at once, logs the seconds held, not the target", async () => {
    const hang = await addHang();
    fireEvent.click(within(hang).getByRole("button", { name: "Timer 0:30" }));
    await within(hang).findByRole("timer");
    await later(5);
    fireEvent.click(within(card("Dead hang")).getByRole("button", { name: "Stop" }));
    // The stop is saved and shown, but no clock tick has come since: ✓ right away.
    await waitFor(async () => expect((await stored()).active?.chrono?.seconds).toBe(5));
    await act(() => new Promise((done) => setTimeout(done, 100))); // the card has re-rendered
    log(card("Dead hang"), "Log set 1");
    await waitFor(async () =>
      expect((await stored()).history.sets.map((s) => s.seconds)).toEqual([5]),
    );
  });

  const pauseSession = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Pause the session" }));
    await screen.findByRole("button", { name: "Resume the session" });
  };

  it("stands still while everything is paused, and goes on from there on resume", async () => {
    const hang = await addHang();
    fireEvent.click(within(hang).getByRole("button", { name: "Timer 0:30" }));
    await within(hang).findByRole("timer");
    await later(5);
    await pauseSession();
    await later(20);
    // Let the card's one-second clock tick during the pause: only then would a running chrono show.
    await act(() => new Promise((resolve) => setTimeout(resolve, 1100)));
    expect(within(card("Dead hang")).getByRole("timer", { name: "Timer" }).textContent).toBe(
      "0:25",
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume the session" }));
    await screen.findByRole("button", { name: "Pause the session" });
    await later(10);
    await waitFor(() =>
      expect(within(card("Dead hang")).getByRole("timer", { name: "Timer" }).textContent).toBe(
        "0:15",
      ),
    );
  });

  it("with Rest continues, keeps counting through the pause", async () => {
    localStorage.setItem("belay.pauseStops", "session");
    const hang = await addHang();
    fireEvent.click(within(hang).getByRole("button", { name: "Timer 0:30" }));
    await within(hang).findByRole("timer");
    await pauseSession();
    await later(10);
    await waitFor(() =>
      expect(within(card("Dead hang")).getByRole("timer", { name: "Timer" }).textContent).toBe(
        "0:20",
      ),
    );
  });

  it("says it in French", async () => {
    await i18n.changeLanguage("fr");
    renderRoute("/workout?start=C");
    expect(
      await screen.findByText(
        "Pas d'escalade cette semaine\u202f: tirage vertical et curl ajoutés en fin de séance.",
        { normalizer: (s) => s },
      ),
    ).toBeTruthy();
    expect(card("Cable lat pulldown full range of motion").textContent).toContain(
      "ajouté, sans escalade",
    );
    expect(screen.getAllByRole("button", { name: "Remplacer" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "+ Exercice" })).toBeTruthy();
  });
});

describe("fix round: extra rows, chrono, replaced warm-ups, leaving out", () => {
  it("an extra set is one row, gone once logged", async () => {
    await startSession("A");
    const bench = card("Barbell bench press");
    fireEvent.click(within(bench).getByRole("button", { name: "+ Set" }));
    fireEvent.change(field(bench, "Load of set 5, kg"), { target: { value: "60" } });
    fireEvent.change(field(bench, "Reps of set 5"), { target: { value: "12" } });
    log(bench, "Log set 5");
    await waitFor(() =>
      within(card("Barbell bench press")).getByRole("img", { name: "Set 5 logged" }),
    );
    expect(
      within(card("Barbell bench press")).queryByRole("textbox", { name: "Load of set 6, kg" }),
    ).toBeNull();
  });

  it("a stopped chrono logs the time held, not the typed target", async () => {
    await startSession("A");
    fireEvent.click(screen.getByRole("button", { name: "+ Exercise" }));
    const sheet = await screen.findByRole("dialog", { name: "Add an exercise" });
    fireEvent.change(within(sheet).getByRole("searchbox"), { target: { value: "dead hang" } });
    fireEvent.click(within(sheet).getByRole("button", { name: /^Dead hang/ }));
    const hang = await waitFor(() => card("Dead hang"));
    fireEvent.change(field(hang, "Seconds of set 1"), { target: { value: "45" } });
    fireEvent.click(within(hang).getByRole("button", { name: "Timer 0:45" }));
    await within(hang).findByRole("timer");
    await later(12);
    fireEvent.click(within(card("Dead hang")).getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(field(card("Dead hang"), "Seconds of set 1").value).toBe("12"));
    log(card("Dead hang"), "Log set 1");
    await waitFor(async () =>
      expect((await stored()).history.sets.map((s) => s.seconds)).toEqual([12]),
    );
  });

  it("keeps a replaced exercise's warm-ups read only, the new one's start fresh", async () => {
    await seed(ADA.id, LAST_B);
    await startSession("B");
    const squat = card("Barbell full squat");
    fireEvent.change(field(squat, "Load of set 1, kg"), { target: { value: "100" } });
    fireEvent.change(field(squat, "Reps of set 1"), { target: { value: "5" } });
    log(squat, "Log warm-up 1");
    await waitFor(() => within(squat).getByRole("img", { name: "Warm-up 1 logged" }));
    log(card("Barbell full squat"), "Log set 1");
    await waitFor(() =>
      within(card("Barbell full squat")).getByRole("img", { name: "Set 1 logged" }),
    );
    fireEvent.click(within(card("Barbell full squat")).getByRole("button", { name: "Replace" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: /^Dumbbell goblet squat/,
      }),
    );
    const goblet = await waitFor(() => card("Dumbbell goblet squat"));
    expect(within(goblet).getByText("2 sets done with Barbell full squat")).toBeTruthy();
    expect(within(goblet).getByRole("img", { name: "Warm-up 1 logged" })).toBeTruthy();
    expect(within(goblet).queryByRole("textbox", { name: "Load of warm-up 1, kg" })).toBeNull();
  });

  it("successive plan edits build on each other", async () => {
    await startSession("C");
    const buttons = screen.getAllByRole("button", { name: "Remove" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]!);
    fireEvent.click(buttons[1]!);
    await waitFor(async () => {
      const plan = (await session()).plan;
      expect([plan[8]!.skipped, plan[9]!.skipped]).toEqual([true, true]);
    });
    const db = await openAccountDb(ADA.id);
    const { readOutbox } = await import("../sync/db");
    const plans = (await readOutbox(db))
      .map((e) => e.change)
      .filter((c) => c.kind === "workout" && c.field === "plan");
    db.close();
    const last = plans.at(-1) as Extract<Change, { field: "plan" }>;
    expect([last.value[8]!.skipped, last.value[9]!.skipped]).toEqual([true, true]);
  });

  const makeCurrent = async (slotIndex: number) => {
    await startSession("C");
    const db = await openAccountDb(ADA.id);
    const active = (await readActiveSession(db))!;
    await db.put("activeSession", { ...active, slotIndex }, "current");
    db.close();
    cleanup();
    renderRoute("/workout");
    await screen.findByRole("heading", { name: /^Session C/, level: 1 });
  };

  it("leaving out the current exercise moves on to the next", async () => {
    await makeCurrent(8);
    fireEvent.click(
      within(card("Cable lat pulldown full range of motion")).getByRole("button", {
        name: "Remove",
      }),
    );
    await waitFor(async () => expect((await stored()).active?.slotIndex).toBe(9));
    const curl = screen
      .getAllByRole("region")
      .find(
        (r) => r.textContent?.includes("added, no climbing") && !r.textContent.includes("left out"),
      )!;
    expect(within(curl).getByRole("button", { expanded: true })).toBeTruthy();
  });
});
