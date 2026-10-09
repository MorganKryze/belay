import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readActiveSession, readHistory, readOutbox } from "../sync/db";
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
// What jsdom lacks, set on its navigator for one test.
const give = (name: "vibrate" | "wakeLock", value: unknown) =>
  Object.defineProperty(navigator, name, { value, configurable: true });
afterEach(async () => {
  cleanup();
  for (const name of ["vibrate", "wakeLock"]) Reflect.deleteProperty(navigator, name);
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e${String(n).padStart(2, "0")}`;
const at = (d: Date) => d.toISOString();
// Session A on Monday: the bench press at 80 kg × 8, 8, 7, 6, finished an hour later.
const MONDAY = new Date(2026, 9, 5, 18, 0);
const LAST_A: Change[] = [
  {
    kind: "workout",
    id: id(1),
    field: "start",
    sessionCode: "A",
    plan: [...sessionByCode("A")!.slots],
    startedAt: at(MONDAY),
    at: at(MONDAY),
  },
  ...[8, 8, 7, 6].map((reps, k): Change => ({
    kind: "set",
    id: id(10 + k),
    workoutId: id(1),
    field: "create",
    slotIndex: 0,
    position: 3 + k,
    exerciseId: "ds:0025",
    warmup: false,
    weightKg: 80,
    reps,
    rir: 1,
    doneAt: at(MONDAY),
    at: at(MONDAY),
  })),
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
const startSession = async (code = "A") => {
  renderRoute(`/workout?start=${code}`);
  return screen.findByRole("heading", {
    name: `Session ${code} · ${{ A: "Push", B: "Legs", C: "Glutes + light pull" }[code]}`,
    level: 1,
  });
};
const card = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name}`) });
const field = (scope: HTMLElement, name: string) =>
  within(scope).getByRole("textbox", { name }) as HTMLInputElement;
const type = (scope: HTMLElement, name: string, value: string) =>
  fireEvent.change(field(scope, name), { target: { value } });
const log = (scope: HTMLElement, name: string) =>
  fireEvent.click(within(scope).getByRole("button", { name }));
const stored = async () => {
  const db = await openAccountDb(ADA.id);
  const result = {
    history: await readHistory(db),
    active: await readActiveSession(db),
    outbox: await readOutbox(db),
  };
  db.close();
  return result;
};

describe("Home's session line (§4.1)", () => {
  it("offers the next session of the program, with its length", async () => {
    renderRoute("/");
    const line = await screen.findByRole("link", { name: /^Session A · Push/ });
    expect(line.textContent).toContain("6 exercises · about 55 min");
    cleanup();
    await seed(ADA.id, LAST_A);
    renderRoute("/");
    expect((await screen.findByRole("link", { name: /^Session B · Legs/ })).textContent).toContain(
      "7 exercises · about 60 min",
    );
  });

  it("starts the session full screen, then says how far it is", async () => {
    renderRoute("/");
    fireEvent.click(await screen.findByRole("link", { name: /^Session A · Push/ }));
    expect(await screen.findByRole("heading", { name: "Session A · Push", level: 1 })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    const bench = card("Barbell bench press");
    type(bench, "Load of set 1, kg", "80");
    type(bench, "Reps of set 1", "8");
    log(bench, "Log set 1");
    await waitFor(() => within(bench).getByRole("img", { name: "Set 1 logged" }));
    cleanup();
    renderRoute("/");
    expect((await screen.findByRole("link", { name: /^Session A · Push/ })).textContent).toContain(
      "in progress · 1 of 19 sets",
    );
  });
});

describe("the session screen (§4.2, §4.3)", () => {
  it("prefills from last time, logs the set as shown, and starts the rest", async () => {
    await seed(ADA.id, LAST_A);
    await startSession("A");
    const bench = card("Barbell bench press");
    expect(within(bench).getByText("Last time: 80 kg × 8, 8, 7, 6")).toBeTruthy();
    // Warm-ups from the working load, on the Plates tool's default gym bar and plates.
    expect(field(bench, "Load of warm-up 1, kg").value).toBe("40");
    expect(field(bench, "Reps of warm-up 1").value).toBe("5");
    expect(field(bench, "Load of warm-up 2, kg").value).toBe("60");
    expect(field(bench, "Load of set 4, kg").value).toBe("80");
    expect(field(bench, "Reps of set 4").value).toBe("6");
    // A warm-up: logged, no rest.
    log(bench, "Log warm-up 1");
    await waitFor(() => within(bench).getByRole("img", { name: "Warm-up 1 logged" }));
    expect(screen.queryByRole("timer")).toBeNull();
    log(bench, "Log warm-up 2");
    await waitFor(() => within(bench).getByRole("img", { name: "Warm-up 2 logged" }));
    // The first work set, with the RIR offered at the low end of the target (1–2).
    const rir = within(bench).getByRole("radiogroup", { name: "RIR, reps in reserve" });
    expect(within(rir).getByRole("radio", { name: "1" }).getAttribute("aria-checked")).toBe("true");
    log(bench, "Log set 1");
    expect((await screen.findByRole("timer")).textContent).toBe("2:30");
    expect(screen.getByText("Rest · set 2 next")).toBeTruthy();
    const { history } = await stored();
    expect(history.sets.filter((s) => s.workoutId !== id(1))).toEqual([
      expect.objectContaining({ position: 0, warmup: true, weightKg: 40, reps: 5, rir: null }),
      expect.objectContaining({ position: 1, warmup: true, weightKg: 60, reps: 3, rir: null }),
      expect.objectContaining({ position: 3, warmup: false, weightKg: 80, reps: 8, rir: 1 }),
    ]);
  });

  it("keeps the rest's remaining time and the set after a reload mid-rest", async () => {
    await seed(ADA.id, LAST_A);
    await startSession("A");
    const bench = card("Barbell bench press");
    log(bench, "Log set 1");
    expect((await screen.findByRole("timer")).textContent).toBe("2:30");
    cleanup();
    await later(60); // the app was closed for a minute
    renderRoute("/workout");
    expect((await screen.findByRole("timer")).textContent).toBe("1:30");
    expect(
      within(card("Barbell bench press")).getByRole("img", { name: "Set 1 logged" }),
    ).toBeTruthy();
    // The same set to do next, with its RIR row.
    expect(
      within(card("Barbell bench press")).getByRole("button", { name: "Log set 2" }),
    ).toBeTruthy();
  });

  it("adds 30 s, skips, and at zero says so once and goes at the next tap", async () => {
    const vibrate = vi.fn();
    give("vibrate", vibrate);
    await seed(ADA.id, LAST_A);
    await startSession("A");
    log(card("Barbell bench press"), "Log set 1");
    await screen.findByRole("timer");
    fireEvent.click(screen.getByRole("button", { name: "+30 s" }));
    await waitFor(() => expect(screen.getByRole("timer").textContent).toBe("3:00"));
    await later(181);
    expect(await screen.findByText("Back to it")).toBeTruthy();
    expect(await screen.findByText("Rest over")).toBeTruthy(); // announced once, politely
    expect(vibrate).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByText("Back to it")).toBeNull());
    expect((await stored()).active?.restEndsAt).toBeNull();
    log(card("Barbell bench press"), "Log set 2");
    await screen.findByRole("timer");
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.queryByRole("timer")).toBeNull());
  });

  it("rests only after the last exercise of a round, with that slot's rest", async () => {
    await startSession("A");
    fireEvent.click(screen.getByRole("button", { name: /^Dumbbell lateral raise/ }));
    const lateral = card("Dumbbell lateral raise");
    expect(within(lateral).getByText(/Tri-set · round 1 of 3/)).toBeTruthy();
    type(lateral, "Load of set 1, kg", "8");
    type(lateral, "Reps of set 1", "15");
    log(lateral, "Log set 1");
    // The pushdown opens next, with no rest in between.
    const pushdown = await waitFor(() => {
      const c = card("Cable pushdown");
      within(c).getByRole("textbox", { name: "Load of set 1, kg" });
      return c;
    });
    expect(screen.queryByRole("timer")).toBeNull();
    type(pushdown, "Load of set 1, kg", "25");
    type(pushdown, "Reps of set 1", "12");
    log(pushdown, "Log set 1");
    const calves = await waitFor(() => {
      const c = card("Lever standing calf raise");
      within(c).getByRole("textbox", { name: "Load of set 1, kg" });
      return c;
    });
    type(calves, "Load of set 1, kg", "60");
    type(calves, "Reps of set 1", "12");
    log(calves, "Log set 1");
    expect((await screen.findByRole("timer")).textContent).toBe("1:15");
    expect(screen.getByText("Rest · Dumbbell lateral raise next")).toBeTruthy();
    expect(within(card("Dumbbell lateral raise")).getByText(/round 2 of 3/)).toBeTruthy();
  });

  it("prefills a set never done before from the set just done", async () => {
    await startSession("A");
    const bench = card("Barbell bench press");
    expect(field(bench, "Load of set 2, kg").value).toBe("");
    type(bench, "Load of set 1, kg", "60");
    type(bench, "Reps of set 1", "10");
    log(bench, "Log set 1");
    await waitFor(() => expect(field(bench, "Load of set 2, kg").value).toBe("60"));
    expect(field(bench, "Reps of set 2").value).toBe("10");
  });

  it("logs no RIR when the chosen value is tapped again", async () => {
    await seed(ADA.id, LAST_A);
    await startSession("A");
    const bench = card("Barbell bench press");
    log(bench, "Log warm-up 1");
    await within(bench).findByRole("img", { name: "Warm-up 1 logged" });
    log(bench, "Log warm-up 2");
    const one = await within(bench).findByRole("radio", { name: "1" });
    fireEvent.click(one);
    expect(one.getAttribute("aria-checked")).toBe("false");
    log(bench, "Log set 1");
    await waitFor(() => within(bench).getByRole("img", { name: "Set 1 logged" }));
    expect((await stored()).history.sets.find((s) => s.workoutId !== id(1))?.rir).toBeNull();
  });

  it("corrects a logged set by its cells while the session is open", async () => {
    await seed(ADA.id, LAST_A);
    await startSession("A");
    const bench = card("Barbell bench press");
    log(bench, "Log set 1");
    await waitFor(() => within(bench).getByRole("img", { name: "Set 1 logged" }));
    type(bench, "Reps of set 1", "7");
    fireEvent.blur(field(bench, "Reps of set 1"));
    await waitFor(async () =>
      expect((await stored()).outbox.at(-1)?.change).toMatchObject({
        kind: "set",
        field: "values",
        weightKg: 80,
        reps: 7,
      }),
    );
  });

  it("keeps an exercise note", async () => {
    await startSession("A");
    const bench = card("Barbell bench press");
    fireEvent.click(within(bench).getByRole("button", { name: "Note" }));
    const note = within(bench).getByRole("textbox", { name: "Note on Barbell bench press" });
    fireEvent.change(note, { target: { value: "Prise large" } });
    fireEvent.blur(note);
    await waitFor(async () =>
      expect((await stored()).history.workouts[0]?.exerciseNotes).toEqual({ "0": "Prise large" }),
    );
  });

  it("asks before finishing with sets left, then shows the summary with the record", async () => {
    await seed(ADA.id, LAST_A);
    await startSession("A");
    const bench = card("Barbell bench press");
    type(bench, "Load of set 1, kg", "82,5"); // a French comma is fine too
    log(bench, "Log set 1");
    await waitFor(() => within(bench).getByRole("img", { name: "Set 1 logged" }));
    await later(64 * 60);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    const sheet = await screen.findByRole("dialog", { name: "Finish the session?" });
    expect(within(sheet).getByText("18 sets not done will not be saved.")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("heading", { name: "Session done", level: 1 })).toBeTruthy();
    expect(screen.getByText("Record: Barbell bench press, 82.5 kg × 8")).toBeTruthy();
    const stats = screen.getByText("Duration").closest("dl")!;
    expect(stats.textContent).toContain("Duration1 h 04");
    expect(stats.textContent).toContain("Work sets1");
    expect(stats.textContent).toContain("Volume660 kg");
    expect(stats.textContent).toContain("Warm-ups left out0 sets");
    fireEvent.change(screen.getByRole("textbox", { name: "Session note (optional)" }), {
      target: { value: "Bonne énergie" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { name: "Hello, Ada", level: 1 })).toBeTruthy();
    const { history, active } = await stored();
    expect(active).toBeNull();
    expect(history.workouts.find((w) => w.id !== id(1))).toMatchObject({
      note: "Bonne énergie",
      endedAt: expect.any(String),
    });
    // Home offers the next session.
    expect((await screen.findByRole("link", { name: /^Session B · Legs/ })).textContent).toContain(
      "7 exercises",
    );
  });

  it("does not keep a session finished without a single set", async () => {
    await startSession("A");
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    const sheet = await screen.findByRole("dialog", { name: "Finish the session?" });
    expect(within(sheet).getByText("No set logged: the session will not be kept.")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("heading", { name: "Hello, Ada", level: 1 })).toBeTruthy();
    expect((await stored()).history.workouts[0]?.removed).toBe(true);
  });

  it("resumes the open session from Program instead of starting another", async () => {
    await startSession("A");
    cleanup();
    renderRoute("/workouts?tab=program");
    fireEvent.click(await screen.findByRole("button", { name: /^Session B · Legs/ }));
    const resume = await screen.findAllByRole("link", { name: "Resume the session in progress" });
    fireEvent.click(resume[0]!);
    expect(await screen.findByRole("heading", { name: "Session A · Push", level: 1 })).toBeTruthy();
    expect((await stored()).history.workouts).toHaveLength(1);
  });

  it("keeps the screen on while open, asks again when back to the front, lets go on leaving", async () => {
    const release = vi.fn(async () => {});
    const lock = { released: false, release };
    const request = vi.fn(async () => lock);
    give("wakeLock", { request });
    await startSession("A");
    await waitFor(() => expect(request).toHaveBeenCalledWith("screen"));
    // In the background the browser let go of it; back to the front, it is asked again.
    lock.released = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    cleanup();
    await waitFor(() => expect(release).toHaveBeenCalled());
  });

  it("says it in French", async () => {
    await i18n.changeLanguage("fr");
    await seed(ADA.id, LAST_A);
    renderRoute("/workout?start=A");
    const bench = await waitFor(() => card("Barbell bench press"));
    expect(within(bench).getByText("La dernière fois : 80 kg × 8, 8, 7, 6")).toBeTruthy();
    expect(within(bench).getAllByText("Montée")).toHaveLength(2);
    expect(field(bench, "Charge de la série 1, kg").value).toBe("80");
    fireEvent.click(within(bench).getByRole("button", { name: "Valider la série 1" }));
    expect(await screen.findByText("Repos · série 2 ensuite")).toBeTruthy();
  });
});
