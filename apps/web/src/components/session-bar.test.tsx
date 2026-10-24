import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { workPosition, type Workout, type WorkoutSet } from "@belay/shared/training/workout";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { OpenAccount } from "../sync/account";
import { type ActiveSession, type AccountDb, openAccountDb, recordChanges } from "../sync/db";
import { armRestSound, restEnded } from "../lib/rest-sound";
import { expectTokensOnly } from "../test/design-rules";
import { ADA } from "../test/seed";
import { SessionBar } from "./session-bar";

// The tone itself is the sound module's to test; here, only when the bar asks for it.
const disarm = vi.fn();
vi.mock("../lib/rest-sound", () => ({
  armRestSound: vi.fn(() => disarm),
  restEnded: vi.fn(() => true),
}));

let db: AccountDb;
let account: OpenAccount;
beforeEach(async () => {
  indexedDB = new IDBFactory();
  db = await openAccountDb(ADA.id);
  // The bar only reads the device's open session: no sync runs here.
  account = { kind: "open", user: ADA, db, engine: {} as OpenAccount["engine"] };
});
afterEach(async () => {
  cleanup();
  db.close();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "vibrate");
  vi.mocked(armRestSound).mockClear();
  vi.mocked(restEnded).mockClear();
  disarm.mockClear();
  localStorage.clear();
  await i18n.changeLanguage("en");
});

const C = sessionByCode("C", starterProgram)!;
const startedAt = "2026-10-05T17:00:00.000Z";
const workout: Workout = {
  id: "w1",
  sessionCode: "C",
  plan: [...C.slots],
  startedAt,
  endedAt: null,
  note: null,
  exerciseNotes: {},
  removed: false,
};
const set = (slotIndex: number, round: number, minute: number): WorkoutSet => ({
  id: `s${slotIndex}-${round}`,
  workoutId: workout.id,
  slotIndex,
  position: workPosition(round),
  exerciseId: C.slots[slotIndex]!.exerciseId,
  warmup: false,
  weightKg: 60,
  reps: 8,
  rir: 1,
  doneAt: new Date(Date.parse(startedAt) + minute * 60_000).toISOString(),
  removed: false,
});
// Two sets of the first slot done: its third is up next.
const twoDone = [set(0, 0, 3), set(0, 1, 6)];

// A router around the bar, so its link resolves and a tap lands on the session.
async function show(props: Omit<Parameters<typeof SessionBar>[0], "account">) {
  const root = createRootRoute({ component: Outlet });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/",
        component: () => <SessionBar account={account} {...props} />,
      }),
      createRoute({
        getParentRoute: () => root,
        path: "/workout",
        component: () => <h1>Session</h1>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { link: await screen.findByRole("link"), router };
}

// The device's open session, as the session screen leaves it after a set.
const resting = (endsAt: number, workoutId = workout.id) =>
  recordChanges(db, [], {
    active: {
      workoutId,
      slotIndex: 0,
      restEndsAt: new Date(endsAt).toISOString(),
    } satisfies ActiveSession,
  });
// Started ten minutes ago on the real clock.
const tenMinutes = () => ({ ...workout, startedAt: new Date(Date.now() - 600_000).toISOString() });

describe("SessionBar", () => {
  it("names the exercise of the next set, then « Série 3 sur 4 · Séance C » at every width", async () => {
    await i18n.changeLanguage("fr");
    const { link } = await show({ workout, sets: twoDone });
    expect(C.slots[0]!.sets).toBe(4);
    // The validated bar: no « En cours » while the session simply runs, one line at every width.
    const line = screen.getByText("Série 3 sur 4 · Séance C");
    expect(line.className.split(/\s+/)).not.toContain("hidden");
    expect(link.textContent).not.toMatch(/En cours|3\/4/);
    // The 13 px step, not the colour token that shares its name.
    expect(line.className.split(/\s+/)).toContain("text-(length:--text-secondary)");
    expect(line.className.split(/\s+/)).not.toContain("text-secondary");
    expect(screen.getByText("Barbell hip thrust")).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/workout?start=C");
    expect(link.className.split(/\s+/)).toContain("lg:hidden");
    expectTokensOnly("components/session-bar.tsx");
  });

  it("shows the letter and En cours only once every set is done", async () => {
    await i18n.changeLanguage("fr");
    const all = C.slots.flatMap((s, i) =>
      Array.from({ length: s.skipped ? 0 : s.sets }, (_, r) => set(i, r, 5)),
    );
    const { link } = await show({ workout, sets: all });
    expect(screen.getByText("Séance C")).toBeTruthy();
    expect(screen.getByText("En cours")).toBeTruthy();
    expect(link.textContent).not.toMatch(/série/);
  });

  it("shows the time since the start", async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      now: Date.parse(startedAt) + 24 * 60_000 + 10_000,
    });
    await show({ workout, sets: twoDone });
    expect(screen.getByText("24:10")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("24:11")).toBeTruthy();
  });

  it("a tap reopens the session", async () => {
    const { link } = await show({ workout, sets: twoDone });
    fireEvent.click(link);
    expect(await screen.findByRole("heading", { name: "Session" })).toBeTruthy();
  });

  it("rises in and fades out", async () => {
    const onAnimationEnd = vi.fn();
    const { link } = await show({ workout, sets: twoDone });
    expect(link.className.split(/\s+/)).toContain("animate-session-bar-in");
    cleanup();
    const leaving = await show({ workout, sets: twoDone, leaving: true, onAnimationEnd });
    expect(leaving.link.className.split(/\s+/)).toContain("animate-fade-out");
    fireEvent.animationEnd(leaving.link);
    expect(onAnimationEnd).toHaveBeenCalledOnce();
  });

  // The real clock throughout: the bar counts from the stored end of the rest.
  it("during a rest the bar counts it down and names the next set", async () => {
    await resting(Date.now() + 90_000);
    const { link } = await show({ workout: tenMinutes(), sets: [set(0, 0, 3)] });
    expect(await screen.findByText("Rest · set 2 of 4 · Session C")).toBeTruthy();
    expect(screen.getByText("Barbell hip thrust")).toBeTruthy();
    expect(link.textContent).toMatch(/1:(29|30)/);
    expect(link.textContent).not.toMatch(/10:0\d/);
  });

  it("a rest of another session or one already over shows the session time", async () => {
    await resting(Date.now() + 90_000, "another");
    await show({ workout: tenMinutes(), sets: [set(0, 0, 3)] });
    expect(await screen.findByText(/^10:0\d$/)).toBeTruthy();
    expect(screen.getByText("Set 2 of 4 · Session C")).toBeTruthy();
    cleanup();
    await resting(Date.now() - 1000);
    await show({ workout: tenMinutes(), sets: [set(0, 0, 3)] });
    expect(await screen.findByText(/^10:0\d$/)).toBeTruthy();
    expect(screen.queryByText(/^Rest/)).toBeNull();
  });

  it("while paused the bar says Paused and its time stands still", async () => {
    const started = tenMinutes();
    await recordChanges(db, [], {
      active: {
        workoutId: workout.id,
        slotIndex: 0,
        restEndsAt: null,
        pausedAt: new Date(Date.now() - 1000).toISOString(),
      },
    });
    await show({ workout: started, sets: [set(0, 0, 3)] });
    expect(await screen.findByText("Paused · set 2 of 4 · Session C")).toBeTruthy();
    const time = () => screen.getByText(/^\d+:\d\d$/).textContent;
    expect(time()).toBe("9:59");
    await new Promise((r) => setTimeout(r, 1100));
    expect(time()).toBe("9:59");
  });

  it("while paused the rest stands still, unless the rest keeps running", async () => {
    const pausedAt = new Date(Date.now() - 1000).toISOString();
    await recordChanges(db, [], {
      active: {
        workoutId: workout.id,
        slotIndex: 0,
        restEndsAt: new Date(Date.parse(pausedAt) + 90_000).toISOString(),
        pausedAt,
      },
    });
    await show({ workout: tenMinutes(), sets: [set(0, 0, 3)] });
    const timer = await screen.findByRole("timer");
    expect(timer.textContent).toBe("1:30");
    // Everything stopped: the bar says Paused over the frozen rest, not Rest.
    expect(screen.getByText("Paused · set 2 of 4 · Session C")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 1100));
    expect(timer.textContent).toBe("1:30");
    localStorage.setItem("belay.pauseStops", "session");
    await waitFor(() => expect(screen.getByRole("timer").textContent).toMatch(/^1:2\d$/));
    // The rest goes on through the pause, so the bar still says Rest.
    expect(screen.getByText("Rest · set 2 of 4 · Session C")).toBeTruthy();
  });

  it("the bar says the rest is over, once, and vibrates once", async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    await resting(Date.now() + 400);
    await show({ workout: tenMinutes(), sets: [set(0, 0, 3)] });
    await screen.findByText("Rest · set 2 of 4 · Session C");
    expect(screen.getByRole("status").textContent).toBe("");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Rest over"), {
      timeout: 1500,
    });
    expect(vibrate).toHaveBeenCalledOnce();
    expect(vibrate).toHaveBeenCalledWith(200);
    // Back to the session time once the rest is over.
    expect(await screen.findByText("Set 2 of 4 · Session C")).toBeTruthy();
    // The bar renders again on each tick of its clock: the cue stays a single one.
    await new Promise((r) => setTimeout(r, 600));
    expect(vibrate).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toBe("Rest over");
  });

  it("a bar mounted after the rest ended says nothing", async () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    await resting(Date.now() - 1000);
    await show({ workout: tenMinutes(), sets: [set(0, 0, 3)] });
    await screen.findByText("Set 2 of 4 · Session C");
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.getByRole("status").textContent).toBe("");
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("the session bar plays the tone when its rest runs out", async () => {
    const endsAt = new Date(Date.now() + 400).toISOString();
    await recordChanges(db, [], {
      active: { workoutId: workout.id, slotIndex: 0, restEndsAt: endsAt },
    });
    await show({ workout: tenMinutes(), sets: [set(0, 0, 3)] });
    // Armed on mount, so the first tap on Accueil unlocks the audio.
    expect(armRestSound).toHaveBeenCalledOnce();
    await screen.findByText("Rest · set 2 of 4 · Session C");
    expect(restEnded).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Rest over"), {
      timeout: 1500,
    });
    // Keyed by the stored end itself, as the rest bar keys it, so one end plays once.
    expect(restEnded).toHaveBeenCalledExactlyOnceWith(endsAt);
    await new Promise((r) => setTimeout(r, 600));
    expect(restEnded).toHaveBeenCalledOnce();
    cleanup();
    expect(disarm).toHaveBeenCalledOnce();
  });

  it("it plays nothing when the rest ended before it mounted", async () => {
    await resting(Date.now() - 1000);
    await show({ workout: tenMinutes(), sets: [set(0, 0, 3)] });
    await screen.findByText("Set 2 of 4 · Session C");
    await new Promise((r) => setTimeout(r, 600));
    expect(restEnded).not.toHaveBeenCalled();
  });

  it("it plays nothing while a pause holds the rest", async () => {
    // The rest would have ended 300 ms in, but the pause that stops everything froze it.
    const pausedAt = new Date(Date.now() - 100).toISOString();
    await recordChanges(db, [], {
      active: {
        workoutId: workout.id,
        slotIndex: 0,
        restEndsAt: new Date(Date.now() + 300).toISOString(),
        pausedAt,
      },
    });
    await show({ workout: tenMinutes(), sets: [set(0, 0, 3)] });
    await screen.findByRole("timer");
    await new Promise((r) => setTimeout(r, 900));
    expect(screen.getByRole("timer").textContent).toBe("0:01");
    expect(restEnded).not.toHaveBeenCalled();
  });
});
