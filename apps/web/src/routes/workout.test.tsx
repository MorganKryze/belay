import type { Change, SyncRequest } from "@belay/shared/sync/schema";
import { resumedStart } from "@belay/shared/training/pause";
import { sessionByCode } from "@belay/shared/training/program";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import {
  openAccountDb,
  readActiveSession,
  readHistory,
  readOutbox,
  recordChanges,
} from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { answer } from "../test/answer";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";

// Passes through, until a test makes the device refuse a write (a lost connection, a full disk).
vi.mock("../sync/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../sync/db")>();
  return { ...real, recordChanges: vi.fn(real.recordChanges) };
});

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

  it("starts the session full screen from its preview, then says how far it is", async () => {
    renderRoute("/");
    fireEvent.click(await screen.findByRole("link", { name: /^Session A · Push/ }));
    fireEvent.click(await screen.findByRole("link", { name: "Start the session" }));
    expect(await screen.findByRole("button", { name: "Finish" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Session A · Push", level: 1 })).toBeTruthy();
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
    expect(within(bench).getByText(/ · last time 80 kg × 8$/)).toBeTruthy();
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

  it("a checked set is recorded at the tap, turns soft green at once and pops only its tick", async () => {
    await seed(ADA.id, LAST_A);
    await startSession("A");
    const bench = card("Barbell bench press");
    log(bench, "Log set 1");
    const square = await within(bench).findByRole("img", { name: "Set 1 logged" });
    const { history } = await stored();
    expect(history.sets.filter((s) => s.workoutId !== id(1))).toEqual([
      expect.objectContaining({ position: 3, warmup: false, weightKg: 80 }),
    ]);
    const row = square.parentElement!;
    expect(row.className).toContain("bg-reference");
    expect(row.className).toContain("transition-colors");
    expect(row.className).toContain("duration-(--tint-duration)");
    expect(square.className).toContain("bg-reference-ink");
    expect(square.className).not.toContain("bg-primary");
    expect(square.className).not.toContain("animate-pop-in");
    expect(square.querySelector("svg")!.getAttribute("class")).toContain("animate-pop-in");
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    const sheet = await screen.findByRole("dialog", { name: "Finish the session?" });
    expect(
      within(sheet).getByText(
        "1 set logged out of 19. The 18 unticked sets won't be saved; your program doesn't change.",
      ),
    ).toBeTruthy();
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
    fireEvent.click(within(sheet).getByRole("button", { name: "Finish and save" }));
    expect(await screen.findByText(/^Session done · /)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Session A · Push", level: 1 })).toBeTruthy();
    expect(screen.getByText("Record: Barbell bench press, 82.5 kg × 8")).toBeTruthy();
    const stats = screen.getByText("Duration").closest("dl")!;
    expect(stats.textContent).toContain("Duration1 h 04");
    expect(stats.textContent).toContain("Sets1");
    expect(stats.textContent).toContain("Volume660 kg");
    expect(screen.getByText("Warm-ups left out · 0 sets")).toBeTruthy();
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

  it("resumes the open session from Program instead of starting another", async () => {
    await startSession("A");
    cleanup();
    renderRoute("/workouts?tab=program");
    // B's card opens B's preview, which offers to resume the session open rather than start B.
    fireEvent.click(await screen.findByRole("link", { name: /^Session B · Legs/ }));
    fireEvent.click(await screen.findByRole("link", { name: "Resume the session in progress" }));
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
    expect(within(bench).getByText(/ · la dernière fois 80 kg × 8$/)).toBeTruthy();
    expect(within(bench).getAllByText("Montée")).toHaveLength(2);
    expect(field(bench, "Charge de la série 1, kg").value).toBe("80");
    fireEvent.click(within(bench).getByRole("button", { name: "Valider la série 1" }));
    expect(await screen.findByText("Repos · série 2 ensuite")).toBeTruthy();
  });
});

describe("lowering the session", () => {
  it("the header holds Minimize, the time and Finish, each 44 px", async () => {
    await startSession("A");
    const minimize = screen.getByRole("button", { name: "Minimize the session" });
    const finish = screen.getByRole("button", { name: "Finish" });
    const time = screen.getByText("Elapsed time").parentElement!;
    const header = minimize.parentElement!;
    // In order, in one sticky row above the title; the e2e measures the boxes.
    expect([...header.children]).toEqual(expect.arrayContaining([minimize, time, finish]));
    expect([...header.children].indexOf(minimize)).toBeLessThan([...header.children].indexOf(time));
    expect([...header.children].indexOf(time)).toBeLessThan([...header.children].indexOf(finish));
    expect(header.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["sticky", "h-12.75", "border-b", "bg-background"]),
    );
    expect(minimize.className.split(/\s+/)).toContain("size-11");
    expect(time.className.split(/\s+/)).toContain("min-h-11");
    expect(finish.className.split(/\s+/)).toContain("h-11");
    const title = screen.getByRole("heading", { name: "Session A · Push", level: 1 });
    expect(header.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Minimize goes back to the page the session was raised over", async () => {
    const router = renderRoute("/tools/plates");
    await screen.findByRole("heading", { name: "Plates", level: 1 });
    await act(() => router.navigate({ to: "/workout", search: { start: "A" } }));
    await screen.findByRole("heading", { name: "Session A · Push", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Minimize the session" }));
    await screen.findByRole("heading", { name: "Plates", level: 1 });
    expect(router.state.location.pathname).toBe("/tools/plates");
    expect(router.history.location.state.__TSR_index).toBe(0);
    // Lowered, not finished: the session is still the open one.
    expect((await stored()).active).not.toBeNull();
  });

  it("with no page before, Minimize lands on Accueil, replacing the session's entry", async () => {
    const router = renderRoute("/workout?start=A");
    await screen.findByRole("heading", { name: "Session A · Push", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Minimize the session" }));
    await screen.findByRole("heading", { name: "Hello, Ada", level: 1 });
    expect(router.state.location.pathname).toBe("/");
    expect(router.history.location.state.__TSR_index).toBe(0);
    expect(router.history.length).toBe(1);
    expect((await stored()).active).not.toBeNull();
  });
});

describe("fix round 1", () => {
  it("offers the RIR under the next set after the last one done, and logs none when it was not shown", async () => {
    await seed(ADA.id, LAST_A);
    await startSession("A");
    const bench = card("Barbell bench press");
    // Warm-ups skipped: nothing was shown under set 1, so no RIR is recorded for it.
    expect(within(bench).queryByRole("radiogroup")).toBeNull();
    log(bench, "Log set 1");
    await waitFor(() => within(bench).getByRole("img", { name: "Set 1 logged" }));
    expect(within(bench).getByRole("radiogroup", { name: "RIR, reps in reserve" })).toBeTruthy();
    expect((await stored()).history.sets.find((s) => s.workoutId !== id(1))?.rir).toBeNull();
  });

  it("shows the RIR row in a card unfolded by a tap", async () => {
    await startSession("A");
    fireEvent.click(screen.getByRole("button", { name: /^Dumbbell lateral raise/ }));
    const lateral = card("Dumbbell lateral raise");
    expect(within(lateral).getByRole("radiogroup", { name: "RIR, reps in reserve" })).toBeTruthy();
  });

  it("keeps the RIR row after a reload mid-rest", async () => {
    await seed(ADA.id, LAST_A);
    await startSession("A");
    log(card("Barbell bench press"), "Log set 1");
    await screen.findByRole("timer");
    cleanup();
    renderRoute("/workout");
    await screen.findByRole("timer");
    expect(
      within(card("Barbell bench press")).getByRole("radiogroup", { name: "RIR, reps in reserve" }),
    ).toBeTruthy();
  });

  it("does not bring an expired rest back at the next warm-up", async () => {
    await seed(ADA.id, LAST_A);
    await startSession("A");
    const bench = card("Barbell bench press");
    log(bench, "Log set 1");
    await screen.findByRole("timer");
    await later(200);
    await screen.findByText("Back to it");
    fireEvent.pointerDown(document.body);
    log(bench, "Log warm-up 1");
    await waitFor(() => within(bench).getByRole("img", { name: "Warm-up 1 logged" }));
    await waitFor(async () => expect((await stored()).active?.restEndsAt).toBeNull());
    expect(screen.queryByText("Back to it")).toBeNull();
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("starts today's session when the one open was forgotten", async () => {
    fakeApi({ me: ADA, sync: () => new Response(null, { status: 500 }) });
    const eleven = new Date(2026, 9, 7, 11, 0);
    await seed(ADA.id, [
      {
        kind: "workout",
        id: id(2),
        field: "start",
        sessionCode: "A",
        plan: [...sessionByCode("A")!.slots],
        startedAt: at(eleven),
        at: at(eleven),
      },
      {
        kind: "set",
        id: id(20),
        workoutId: id(2),
        field: "create",
        slotIndex: 0,
        position: 3,
        exerciseId: "ds:0025",
        warmup: false,
        weightKg: 80,
        reps: 8,
        rir: null,
        doneAt: at(eleven),
        at: at(eleven),
      },
    ]);
    renderRoute("/");
    const line = await screen.findByRole("link", { name: /^Session [AB] · / });
    expect(line.textContent).not.toContain("in progress");
    fireEvent.click(line);
    fireEvent.click(await screen.findByRole("link", { name: "Start the session" }));
    await screen.findByRole("button", { name: "Finish" });
    const { history } = await stored();
    expect(history.workouts).toHaveLength(2);
    expect(history.workouts.find((w) => w.id === id(2))?.endedAt).toBe(at(eleven)); // left at its last set
  });
});

describe("pause", () => {
  // The real clock: a pause lasts the time that passes, and the moved start is read against it.
  beforeEach(() => vi.useRealTimers());
  const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));
  // What the device sent and what it still holds to send.
  const sentOrQueued = async (requests: SyncRequest[]) => [
    ...requests.flatMap((r) => r.changes),
    ...(await stored()).outbox.map((e) => e.change),
  ];
  const moves = async (requests: SyncRequest[]) =>
    (await sentOrQueued(requests)).flatMap((c) =>
      c.kind === "workout" && c.field === "startedAt" ? [c] : [],
    );
  const pause = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Pause the session" }));
    await waitFor(async () =>
      expect((await stored()).active?.pausedAt).toEqual(expect.any(String)),
    );
    await screen.findByRole("button", { name: "Resume the session" });
    return (await stored()).active!.pausedAt!;
  };
  const startOf = async () => (await stored()).history.workouts.find((w) => w.id !== id(1))!;

  it("Pause stores since when, on this device only", async () => {
    const { requests } = fakeApi({ me: ADA });
    await startSession("A");
    const pausedAt = await pause();
    expect(Date.parse(pausedAt)).toBeLessThanOrEqual(Date.now());
    expect(await screen.findByText("Paused")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume the session" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pause the session" })).toBeNull();
    // Only the start ever leaves the device: the pause stays on it.
    expect((await sentOrQueued(requests)).map((c) => c.kind === "workout" && c.field)).toEqual([
      "start",
    ]);
  });

  it("Resume moves the start by the time paused and clears the pause in one write", async () => {
    const { requests } = fakeApi({ me: ADA });
    await startSession("A");
    const { startedAt } = await startOf();
    const pausedAt = await pause();
    await wait(60);
    fireEvent.click(screen.getByRole("button", { name: "Resume the session" }));
    await waitFor(async () => expect(await moves(requests)).toHaveLength(1));
    const [move] = await moves(requests);
    expect(move!.value).toBe(resumedStart(startedAt, pausedAt, move!.at));
    expect(Date.parse(move!.value) - Date.parse(startedAt)).toBeGreaterThanOrEqual(60);
    const after = await stored();
    expect(after.active?.pausedAt).toBeNull();
    expect(after.history.workouts.find((w) => w.id !== id(1))?.startedAt).toBe(move!.value);
    await waitFor(() => expect(screen.queryByText("Paused")).toBeNull());
    expect(screen.getByRole("button", { name: "Pause the session" })).toBeTruthy();
  });

  it("a set checked while paused resumes first, then logs the set", async () => {
    const { requests } = fakeApi({ me: ADA });
    await seed(ADA.id, LAST_A);
    await startSession("A");
    const { startedAt } = await startOf();
    const pausedAt = await pause();
    await wait(60);
    const bench = card("Barbell bench press");
    log(bench, "Log set 1");
    await waitFor(() => within(bench).getByRole("img", { name: "Set 1 logged" }));
    expect((await screen.findByRole("timer")).textContent).toBe("2:30");
    const order = (await sentOrQueued(requests))
      .filter(
        (c) =>
          (c.kind === "set" && c.workoutId !== id(1)) ||
          (c.kind === "workout" && c.field === "startedAt"),
      )
      .map((c) => c.kind);
    expect(order).toEqual(["workout", "set"]);
    const [move] = await moves(requests);
    const set = (await stored()).history.sets.find((s) => s.workoutId !== id(1))!;
    // Resumed at the tap that logged the set.
    expect(move!.at).toBe(set.doneAt);
    expect(move!.value).toBe(resumedStart(startedAt, pausedAt, set.doneAt));
    const { active } = await stored();
    expect(active?.pausedAt).toBeNull();
    expect(active?.restEndsAt).toEqual(expect.any(String));
  });

  // A server that, once `log(at)` is called, answers every sync with a set of the open session
  // logged at that time on another device.
  const anotherDevice = () => {
    let remote: string | null = null;
    const api = fakeApi({ me: ADA });
    const { requests } = fakeApi({
      me: ADA,
      sync: async (request) => {
        if (!remote) return api.fetchMock("/api/sync", { body: JSON.stringify(request) });
        const workout = await startOf();
        return Response.json(
          answer({
            cursor: "2",
            sets: [
              {
                id: id(30),
                workoutId: workout.id,
                slotIndex: 0,
                position: 3,
                exerciseId: "ds:0025",
                warmup: false,
                weightKg: 60,
                reps: 8,
                seconds: null,
                rir: 1,
                doneAt: remote,
                fieldsAt: remote,
                removed: false,
                removedAt: null,
              },
            ],
          }),
        );
      },
    });
    const log = (at: string) => {
      remote = at;
      window.dispatchEvent(new Event("online"));
    };
    return { requests, log };
  };

  it("a set from another device after the pause ends it at that set's time", async () => {
    const { requests, log } = anotherDevice();
    await startSession("A");
    const { startedAt } = await startOf();
    const pausedAt = await pause();
    await wait(60);
    const remote = new Date(Date.parse(pausedAt) + 30).toISOString();
    log(remote);
    await waitFor(async () => expect((await stored()).active?.pausedAt).toBeNull());
    await waitFor(async () => expect(await moves(requests)).toHaveLength(1));
    const [move] = await moves(requests);
    expect(move!.at).toBe(remote);
    expect(move!.value).toBe(resumedStart(startedAt, pausedAt, remote));
    expect(
      within(card("Barbell bench press")).getByRole("img", { name: "Set 1 logged" }),
    ).toBeTruthy();
    // Once: further syncs bring the same set again and move nothing more.
    window.dispatchEvent(new Event("online"));
    await wait(100);
    expect(await moves(requests)).toHaveLength(1);
  });

  it("a failed resume keeps the pause and says the save failed", async () => {
    const { requests } = fakeApi({ me: ADA });
    await startSession("A");
    const pausedAt = await pause();
    vi.mocked(recordChanges).mockRejectedValueOnce(new DOMException("lost", "InvalidStateError"));
    fireEvent.click(screen.getByRole("button", { name: "Resume the session" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't save on this phone. Try again.",
    );
    expect((await stored()).active?.pausedAt).toBe(pausedAt);
    expect(await moves(requests)).toEqual([]);
    expect(screen.getByRole("button", { name: "Resume the session" })).toBeTruthy();
  });

  it("finished after another device's set failed to resume it, the start moves to that set only", async () => {
    const { requests, log } = anotherDevice();
    await startSession("A");
    const { startedAt } = await startOf();
    const pausedAt = await pause();
    await wait(60);
    const remote = new Date(Date.parse(pausedAt) + 30).toISOString();
    vi.mocked(recordChanges).mockRejectedValueOnce(new DOMException("lost", "InvalidStateError"));
    log(remote);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't save on this phone. Try again.",
    );
    expect((await stored()).active?.pausedAt).toBe(pausedAt);
    await wait(60);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    const sheet = await screen.findByRole("dialog", { name: "Finish the session?" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Finish and save" }));
    expect(await screen.findByText(/^Session done · /)).toBeTruthy();
    // The time trained on the other device since its set stays in the session.
    const [move] = await moves(requests);
    expect(move!.value).toBe(resumedStart(startedAt, pausedAt, remote));
  });
});

describe("finish", () => {
  // The real clock: a pause left out of the duration is read against the time that passes.
  beforeEach(() => {
    vi.useRealTimers();
    vi.mocked(recordChanges).mockClear();
  });
  const OPEN = id(3);
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const tick = () => act(() => new Promise((r) => setTimeout(r, 0)));
  const sentOrQueued = async (requests: SyncRequest[]) => [
    ...requests.flatMap((r) => r.changes),
    ...(await stored()).outbox.map((e) => e.change),
  ];
  const removals = async (requests: SyncRequest[]) =>
    (await sentOrQueued(requests)).filter(
      (c) => c.kind === "workout" && c.id === OPEN && c.field === "removed",
    );
  const open = async () => (await stored()).history.workouts.find((w) => w.id === OPEN)!;

  // Session A open on this device, started 40 minutes ago, with the given number of work sets
  // logged in each slot from the first, and a warm-up of the bench press when asked.
  async function openWith(counts: number[], { warmup = false } = {}) {
    const plan = [...sessionByCode("A")!.slots];
    const changes: Change[] = [
      {
        kind: "workout",
        id: OPEN,
        field: "start",
        sessionCode: "A",
        plan,
        startedAt: ago(40),
        at: ago(40),
      },
    ];
    const set = (slotIndex: number, position: number, n: number): Change => ({
      kind: "set",
      id: id(40 + n),
      workoutId: OPEN,
      field: "create",
      slotIndex,
      position,
      exerciseId: plan[slotIndex]!.exerciseId,
      warmup: position < 3,
      weightKg: 20,
      reps: 10,
      rir: null,
      doneAt: ago(30 - n),
      at: ago(30 - n),
    });
    if (warmup) changes.push(set(0, 0, 0));
    counts.forEach((count, slotIndex) => {
      for (let round = 0; round < count; round++)
        changes.push(set(slotIndex, 3 + round, changes.length));
    });
    await seed(ADA.id, changes);
    const db = await openAccountDb(ADA.id);
    await recordChanges(db, [], { active: { workoutId: OPEN, slotIndex: 0, restEndsAt: null } });
    db.close();
    vi.mocked(recordChanges).mockClear();
    const router = renderRoute("/workout");
    await screen.findByRole("heading", { name: /^(Session|Séance) A · Push$/, level: 1 });
    return router;
  }
  const finish = async (title = "Finish the session?") => {
    fireEvent.click(screen.getByRole("button", { name: /^(Finish|Terminer)$/ }));
    const sheet = await screen.findByRole("dialog", { name: title });
    await tick();
    return sheet;
  };
  const description = (sheet: HTMLElement) =>
    document.getElementById(sheet.getAttribute("aria-describedby")!)!.textContent;

  it("Finish with sets left counts them exactly", async () => {
    await openWith([4, 3, 3, 1]);
    const sheet = await finish();
    expect(description(sheet)).toBe(
      "11 sets logged out of 19. The 8 unticked sets won't be saved; your program doesn't change.",
    );
    expect(within(sheet).getByRole("button", { name: "Finish and save" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Delete the session…" })).toBeTruthy();
    // Keep going holds the focus first: Enter right after opening ends nothing.
    expect(document.activeElement).toBe(within(sheet).getByRole("button", { name: "Keep going" }));
    cleanup();
    await i18n.changeLanguage("fr");
    renderRoute("/workout");
    await screen.findByRole("heading", { name: "Séance A · Push", level: 1 });
    const fr = await finish("Terminer la séance\u202f?");
    expect(description(fr)).toBe(
      "11 séries notées sur 19. Les 8 séries non cochées ne seront pas enregistrées\u202f; ton programme ne change pas.",
    );
    expect(within(fr).getByRole("button", { name: "Terminer et enregistrer" })).toBeTruthy();
    expect(within(fr).getByRole("button", { name: "Supprimer la séance…" })).toBeTruthy();
    expect(within(fr).getByRole("button", { name: "Continuer la séance" })).toBeTruthy();
  });

  it("says one set in the singular, logged or left", async () => {
    await openWith([4, 3, 3, 3, 3, 2]);
    expect(description(await finish())).toBe(
      "18 sets logged out of 19. The unticked set won't be saved; your program doesn't change.",
    );
    cleanup();
    await i18n.changeLanguage("fr");
    renderRoute("/workout");
    await screen.findByRole("heading", { name: "Séance A · Push", level: 1 });
    expect(description(await finish("Terminer la séance\u202f?"))).toBe(
      "18 séries notées sur 19. La série non cochée ne sera pas enregistrée\u202f; ton programme ne change pas.",
    );
  });

  it("with every set done the sheet still opens and says 19 of 19", async () => {
    await openWith([4, 3, 3, 3, 3, 3]);
    const sheet = await finish();
    expect(description(sheet)).toBe("19 sets logged out of 19; your program doesn't change.");
    expect((await open()).endedAt).toBeNull();
    cleanup();
    await i18n.changeLanguage("fr");
    renderRoute("/workout");
    await screen.findByRole("heading", { name: "Séance A · Push", level: 1 });
    expect(description(await finish("Terminer la séance\u202f?"))).toBe(
      "19 séries notées sur 19\u202f; ton programme ne change pas.",
    );
  });

  it("Finish and save ends the session and opens its summary in place", async () => {
    const router = await openWith([4, 3, 3, 1]);
    const sheet = await finish();
    fireEvent.click(within(sheet).getByRole("button", { name: "Finish and save" }));
    expect(await screen.findByText(/^Session done · /)).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/workout/summary/${OPEN}`);
    // In place: the session's entry is the summary's now.
    expect(router.history.length).toBe(1);
    const { active, history } = await stored();
    expect(active).toBeNull();
    const workout = history.workouts.find((w) => w.id === OPEN)!;
    expect(workout.endedAt).toEqual(expect.any(String));
    expect(workout.removed).toBe(false);
  });

  it("Delete the session… only asks again: nothing is queued until Delete the session", async () => {
    const { requests } = fakeApi({ me: ADA });
    const router = await openWith([4, 3, 3, 1]);
    const sheet = await finish();
    fireEvent.click(within(sheet).getByRole("button", { name: "Delete the session…" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete the session?" });
    await tick();
    expect(description(confirm)).toBe(
      "The 11 logged sets won't be kept; your program doesn't change.",
    );
    expect(document.activeElement).toBe(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Finish the session?" })).toBeNull();
    expect(await removals(requests)).toEqual([]);
    expect((await stored()).active).not.toBeNull();
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete the session" }));
    expect(await screen.findByRole("heading", { name: "Hello, Ada", level: 1 })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/");
    expect(router.history.length).toBe(1);
    await waitFor(async () => expect(await removals(requests)).toHaveLength(1));
    const { active } = await stored();
    expect(active).toBeNull();
    expect((await open()).removed).toBe(true);
  });

  it("the delete question says it in French, one set in the singular", async () => {
    await i18n.changeLanguage("fr");
    await openWith([1]);
    const sheet = await finish("Terminer la séance\u202f?");
    fireEvent.click(within(sheet).getByRole("button", { name: "Supprimer la séance…" }));
    const confirm = await screen.findByRole("dialog", { name: "Supprimer la séance\u202f?" });
    expect(description(confirm)).toBe(
      "La série notée ne sera pas gardée\u202f; ton programme ne change pas.",
    );
    expect(within(confirm).getByRole("button", { name: "Supprimer la séance" })).toBeTruthy();
    expect(within(confirm).getByRole("button", { name: "Annuler" })).toBeTruthy();
  });

  it("with nothing logged the sheet offers Leave without saving, which removes the empty session", async () => {
    const router = await openWith([]);
    const sheet = await finish("Nothing logged yet");
    expect(description(sheet)).toBe(
      "If you leave, this session won't be kept. You can start it later.",
    );
    expect(within(sheet).queryByRole("button", { name: "Finish and save" })).toBeNull();
    expect(document.activeElement).toBe(within(sheet).getByRole("button", { name: "Keep going" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Leave without saving" }));
    expect(await screen.findByRole("heading", { name: "Hello, Ada", level: 1 })).toBeTruthy();
    expect(router.history.length).toBe(1);
    expect((await stored()).active).toBeNull();
    expect((await open()).removed).toBe(true);
    // A warm-up is a set logged: the finish sheet instead.
    cleanup();
    indexedDB = new IDBFactory();
    await openWith([], { warmup: true });
    expect(description(await finish())).toBe(
      "0 sets logged out of 19. The 19 unticked sets won't be saved; your program doesn't change.",
    );
  });

  // A work set of the bench press in the open session, logged on another device.
  const BENCH = {
    id: id(30),
    workoutId: OPEN,
    slotIndex: 0,
    position: 3,
    exerciseId: sessionByCode("A")!.slots[0]!.exerciseId,
    warmup: false,
    weightKg: 60,
    reps: 8,
    rir: 1,
  };
  const benchSet = (doneAt: string): Change => ({
    kind: "set",
    field: "create",
    ...BENCH,
    doneAt,
    at: doneAt,
  });
  const ONE_LOGGED =
    "1 set logged out of 19. The 18 unticked sets won't be saved; your program doesn't change.";

  it("a set synced while Nothing logged yet is open turns it into the finish question", async () => {
    let remote: string | null = null;
    const { requests } = fakeApi({
      me: ADA,
      sync: () => {
        if (!remote) return Response.json(answer());
        const row = { ...BENCH, seconds: null, doneAt: remote, fieldsAt: remote };
        return Response.json(
          answer({ cursor: "2", sets: [{ ...row, removed: false, removedAt: null }] }),
        );
      },
    });
    await openWith([]);
    await finish("Nothing logged yet");
    remote = new Date().toISOString();
    window.dispatchEvent(new Event("online"));
    const sheet = await screen.findByRole("dialog", { name: "Finish the session?" });
    expect(description(sheet)).toBe(ONE_LOGGED);
    expect(screen.queryByRole("button", { name: "Leave without saving" })).toBeNull();
    expect(within(sheet).getByRole("button", { name: "Delete the session…" })).toBeTruthy();
    expect(await removals(requests)).toEqual([]);
    expect((await open()).removed).toBe(false);
  });

  it("Leave without saving looks again: a set stored since gets the finish question, never a removal", async () => {
    const { requests } = fakeApi({ me: ADA });
    await openWith([]);
    const sheet = await finish("Nothing logged yet");
    // Stored on the device as another tab would, the screen not told yet.
    await seed(ADA.id, [benchSet(new Date().toISOString())]);
    fireEvent.click(within(sheet).getByRole("button", { name: "Leave without saving" }));
    const asked = await screen.findByRole("dialog", { name: "Finish the session?" });
    expect(description(asked)).toBe(ONE_LOGGED);
    expect(await removals(requests)).toEqual([]);
    expect((await open()).removed).toBe(false);
    expect((await stored()).active).not.toBeNull();
  });

  it("the nothing-logged sheet says it in French", async () => {
    await i18n.changeLanguage("fr");
    await openWith([]);
    const sheet = await finish("Rien n'est noté pour l'instant");
    expect(description(sheet)).toBe(
      "Si tu quittes, cette séance ne sera pas gardée. Tu pourras la commencer plus tard.",
    );
    expect(within(sheet).getByRole("button", { name: "Quitter sans enregistrer" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Continuer la séance" })).toBeTruthy();
  });

  it("Keep going, Escape and the veil change nothing", async () => {
    const { requests } = fakeApi({ me: ADA });
    await openWith([4, 3, 3, 1]);
    const veil = () => {
      const overlay = document.querySelector<HTMLElement>("[data-sheet-overlay]")!;
      // A tap on the veil: Radix waits for the click that ends the press.
      fireEvent.pointerDown(overlay);
      fireEvent.click(overlay);
    };
    for (const close of [
      (sheet: HTMLElement) =>
        fireEvent.click(within(sheet).getByRole("button", { name: "Keep going" })),
      () => fireEvent.keyDown(document.activeElement!, { key: "Escape" }),
      veil,
    ]) {
      close(await finish());
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
    // The delete question closes the same way, by Cancel.
    const sheet = await finish();
    fireEvent.click(within(sheet).getByRole("button", { name: "Delete the session…" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete the session?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("heading", { name: "Session A · Push", level: 1 })).toBeTruthy();
    const workout = await open();
    expect(workout.endedAt).toBeNull();
    expect(workout.removed).toBe(false);
    expect((await stored()).active).not.toBeNull();
    expect(await removals(requests)).toEqual([]);
  });

  it("a failed end keeps the session and says the save failed", async () => {
    await openWith([4, 3, 3, 1]);
    vi.mocked(recordChanges).mockRejectedValueOnce(new DOMException("lost", "InvalidStateError"));
    const sheet = await finish();
    fireEvent.click(within(sheet).getByRole("button", { name: "Finish and save" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't save on this phone. Try again.",
    );
    expect(screen.getByRole("heading", { name: "Session A · Push", level: 1 })).toBeTruthy();
    expect(
      within(card("Barbell bench press")).getByRole("img", { name: "Set 4 logged" }),
    ).toBeTruthy();
    expect((await open()).endedAt).toBeNull();
    expect((await stored()).active).not.toBeNull();
  });

  it("finish while paused writes the moved start and the end together", async () => {
    const { requests } = fakeApi({ me: ADA });
    await openWith([4]);
    const { startedAt } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Pause the session" }));
    await waitFor(async () =>
      expect((await stored()).active?.pausedAt).toEqual(expect.any(String)),
    );
    const pausedAt = (await stored()).active!.pausedAt!;
    await act(() => new Promise((r) => setTimeout(r, 60)));
    const sheet = await finish();
    fireEvent.click(within(sheet).getByRole("button", { name: "Finish and save" }));
    expect(await screen.findByText(/^Session done · /)).toBeTruthy();
    // One write holds both: the duration never counts the pause, on any device.
    const together = vi
      .mocked(recordChanges)
      .mock.calls.map(([, changes]) => changes.map((c) => c.kind === "workout" && c.field))
      .filter((fields) => fields.includes("ended"));
    expect(together).toEqual([["startedAt", "ended"]]);
    const mine = (await sentOrQueued(requests)).flatMap((c) =>
      c.kind === "workout" && c.id === OPEN ? [c] : [],
    );
    const ended = mine.find((c) => c.field === "ended")!;
    const move = mine.find((c) => c.field === "startedAt")!;
    expect(ended.value).toBe(ended.at);
    expect(move.at).toBe(ended.at);
    expect(move.value).toBe(resumedStart(startedAt, pausedAt, ended.at));
    expect(Date.parse(move.value as string) - Date.parse(startedAt)).toBeGreaterThanOrEqual(60);
    expect((await open()).startedAt).toBe(move.value);
  });
});
