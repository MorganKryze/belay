import { FORGOTTEN_MS } from "@belay/shared/training/rules";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { workPosition, type Workout, type WorkoutSet } from "@belay/shared/training/workout";
import { cleanup, render } from "@testing-library/react";
import type { TFunction } from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import "@/i18n/lazy";
import type { Account, OpenAccount } from "@/sync/account";
import type { ActiveSession } from "@/sync/db";

// The plugin as Capacitor's proxy hands it out: any name it does not know, « then » included,
// is a method that throws, so a promise resolved with the plugin itself would never settle.
const { native, view } = vi.hoisted(() => ({
  native: {
    setLiveActivity: vi.fn<(o: { activity: unknown }) => Promise<void>>(async () => {}),
    then: () => {
      throw new Error('"BelayNative.then()" is not implemented on ios');
    },
  },
  view: { active: null as ActiveSession | null, reading: false },
}));
vi.mock("@/native/plugin", () => ({ BelayNative: native }));
vi.mock("@/sync/account", () => ({
  useSessionView: () => ({ data: view.reading ? undefined : { active: view.active } }),
  useHistory: () => ({ data: view.reading ? undefined : {} }),
}));
// The notification half of the module is tested on its own: here it only has to stay quiet.
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    cancel: async () => {},
    checkPermissions: async () => ({ display: "denied" }),
  },
}));

import { type LiveActivity, liveActivityOf, showLiveActivity } from "./live-activity";
import { NativeRestAlert } from "./rest-alert";

const NOW = Date.parse("2026-10-28T18:00:00.000Z");
const at = (s: number) => new Date(NOW + s * 1000).toISOString();
const W = "0192c3a0-0000-7000-8000-000000000001";
const A = sessionByCode("A", starterProgram)!;
const START = at(-600);
const workout: Workout = {
  id: W,
  sessionCode: "A",
  plan: [...A.slots],
  startedAt: START,
  endedAt: null,
  note: null,
  exerciseNotes: {},
  removed: false,
};
const set = (slotIndex: number, round: number, doneAt: number, warmup = false): WorkoutSet => ({
  id: `s${slotIndex}-${round}${warmup ? "w" : ""}`,
  workoutId: W,
  slotIndex,
  position: warmup ? round : workPosition(round),
  exerciseId: A.slots[slotIndex]!.exerciseId,
  warmup,
  weightKg: 80,
  reps: 8,
  rir: 1,
  doneAt: at(doneAt),
  removed: false,
});
const active = (more: Partial<ActiveSession> = {}): ActiveSession => ({
  workoutId: W,
  slotIndex: 0,
  restEndsAt: null,
  ...more,
});
const t = () => i18n.getFixedT("fr") as TFunction;
const describeIt = (
  sets: WorkoutSet[],
  more: Partial<ActiveSession> = {},
  stops: "all" | "session" = "all",
) => liveActivityOf({ workout, sets }, active(more), stops, NOW, t());
// The bench press's first set done 30 s ago: its planned 150 s rest runs until +120 s.
const firstSet = [set(0, 0, -30)];

const open = { kind: "open" } as OpenAccount;
const shown = (n: number) => native.setLiveActivity.mock.calls[n - 1]?.[0].activity;
const quiet = () => new Promise((r) => setTimeout(r, 20));
let reset = 0;

beforeEach(async () => {
  localStorage.clear();
  view.active = null;
  view.reading = false;
  native.setLiveActivity.mockReset();
  native.setLiveActivity.mockResolvedValue(undefined);
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  await i18n.changeLanguage("fr");
  // The queue remembers the last description across tests: each test starts from one of its own.
  showLiveActivity({ workoutId: `reset-${++reset}` } as LiveActivity);
  await vi.waitFor(() => expect(native.setLiveActivity).toHaveBeenCalled());
  native.setLiveActivity.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("liveActivityOf", () => {
  it("a due set shows its exercise, « Série 1 sur 4 · Séance A » and the start", () => {
    expect(describeIt([])).toEqual({
      workoutId: W,
      staleAt: Date.parse(START) + FORGOTTEN_MS,
      state: {
        status: "due",
        title: "Barbell bench press",
        detail: "Série 1 sur 4 · Séance A",
        statusLabel: "En cours",
        restOverTitle: "Repos terminé",
        restOverDetail: "C’est reparti",
        staleLine: "Ouvre Belay pour continuer",
        startedAt: Date.parse(START),
        pausedAt: null,
        restStart: null,
        restEnd: null,
        restFrozen: false,
      },
    });
  });

  it("a rest shows Repos, the next set and a window as long as the planned rest", () => {
    const rest = describeIt(firstSet, { restEndsAt: at(120) })!;
    expect(rest.state).toMatchObject({
      status: "rest",
      title: "Barbell bench press",
      detail: "Série 2 sur 4 · Séance A",
      statusLabel: "Repos",
      restStart: NOW - 30_000,
      restEnd: NOW + 120_000,
      pausedAt: null,
      restFrozen: false,
    });
    expect(rest.staleAt).toBe(NOW + 120_000);

    // No rest planned after the slot: the window starts at the last work set instead.
    const unplanned = liveActivityOf(
      {
        workout: { ...workout, plan: workout.plan.map((s) => ({ ...s, restSec: 0 })) },
        sets: firstSet,
      },
      active({ restEndsAt: at(30) }),
      "all",
      NOW,
      t(),
    )!;
    expect(unplanned.state).toMatchObject({ restStart: NOW - 30_000, restEnd: NOW + 30_000 });
  });

  it("+30 s past the plan keeps the session's start, moves the end and keeps the window as long as the plan", () => {
    const longer = describeIt(firstSet, { restEndsAt: at(150) })!;
    // Its start sits at the moment of the tap, so the bar fills again, as the rest bar does.
    expect(longer.state).toMatchObject({
      startedAt: Date.parse(START),
      restStart: NOW,
      restEnd: NOW + 150_000,
    });
    expect(longer.staleAt).toBe(NOW + 150_000);
  });

  it("a pause under Tout s’arrête freezes the rest and the chrono", () => {
    // Paused 20 s ago with 15 s of rest left: past its end on the wall clock, still held.
    const paused = describeIt(firstSet, { restEndsAt: at(-5), pausedAt: at(-20) })!;
    expect(paused.state).toMatchObject({
      status: "paused",
      statusLabel: "En pause",
      title: "Barbell bench press",
      detail: "Série 2 sur 4 · Séance A",
      pausedAt: NOW - 20_000,
      restStart: NOW - 155_000,
      restEnd: NOW - 5_000,
      restFrozen: true,
    });
    // Nothing moves until the resume: the line comes at the forgotten mark.
    expect(paused.staleAt).toBe(NOW - 30_000 + FORGOTTEN_MS);
  });

  it("a pause under Le repos continue keeps the rest running and says En pause", () => {
    const paused = describeIt(firstSet, { restEndsAt: at(120), pausedAt: at(-20) }, "session")!;
    expect(paused.state).toMatchObject({
      status: "paused",
      statusLabel: "En pause",
      pausedAt: NOW - 20_000,
      restStart: NOW - 30_000,
      restEnd: NOW + 120_000,
      restFrozen: false,
    });
    expect(paused.staleAt).toBe(NOW + 120_000);

    // Its end passed during the pause: no rest left to show.
    const over = describeIt(firstSet, { restEndsAt: at(-5), pausedAt: at(-20) }, "session")!;
    expect(over.state).toMatchObject({ status: "paused", restStart: null, restEnd: null });
  });

  it("every set logged says Toutes les séries faites and the session", () => {
    const all = A.slots.flatMap((slot, i) =>
      Array.from({ length: slot.sets }, (_, r) => set(i, r, -500 + i * 60 + r * 10)),
    );
    expect(describeIt(all)!.state).toMatchObject({
      status: "done",
      title: "Toutes les séries faites",
      detail: "Séance A",
      statusLabel: "En cours",
      restStart: null,
      restEnd: null,
    });
  });

  it("the stale date is the rest's end while it runs, else six hours after the last set", () => {
    expect(describeIt(firstSet, { restEndsAt: at(120) })!.staleAt).toBe(NOW + 120_000);
    // The rest over, a warm-up of the next exercise logged after it: the latest set counts.
    const later = [...firstSet, set(1, 0, -10, true)];
    expect(describeIt(later, { restEndsAt: at(-15) })!.staleAt).toBe(NOW - 10_000 + FORGOTTEN_MS);
    expect(describeIt([])!.staleAt).toBe(Date.parse(START) + FORGOTTEN_MS);
  });

  it("a session not taken up on this phone shows nothing", () => {
    const session = { workout, sets: [] };
    expect(liveActivityOf(session, null, "all", NOW, t())).toBeNull();
    expect(liveActivityOf(session, undefined, "all", NOW, t())).toBeNull();
    const elsewhere = active({ workoutId: "0192c3a0-0000-7000-8000-000000000002" });
    expect(liveActivityOf(session, elsewhere, "all", NOW, t())).toBeNull();
    expect(liveActivityOf(null, active(), "all", NOW, t())).toBeNull();
  });

  it("texts longer than 80 characters are cut", () => {
    const long = "x".repeat(200);
    const plan = workout.plan.map((s) => ({ ...s, exerciseId: long }));
    const { state } = liveActivityOf(
      { workout: { ...workout, plan }, sets: [] },
      active(),
      "all",
      NOW,
      (() => long) as unknown as TFunction,
    )!;
    for (const text of [
      state.title,
      state.detail,
      state.statusLabel,
      state.restOverTitle,
      state.restOverDetail,
      state.staleLine,
    ])
      expect(text).toHaveLength(80);
  });
});

describe("showLiveActivity", () => {
  it("the same description twice is sent once", async () => {
    const due = describeIt([])!;
    showLiveActivity(due);
    showLiveActivity(structuredClone(due));
    await quiet();
    expect(native.setLiveActivity).toHaveBeenCalledExactlyOnceWith({ activity: due });

    // One call at a time: what is asked meanwhile waits, and only the latest goes.
    let finish = () => {};
    native.setLiveActivity.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)));
    const rest = describeIt(firstSet, { restEndsAt: at(120) })!;
    showLiveActivity(rest);
    showLiveActivity(due);
    showLiveActivity(null);
    await quiet();
    expect(native.setLiveActivity).toHaveBeenCalledTimes(2);
    finish();
    await vi.waitFor(() => expect(native.setLiveActivity).toHaveBeenCalledTimes(3));
    expect(native.setLiveActivity).toHaveBeenLastCalledWith({ activity: null });
    await quiet();
    expect(native.setLiveActivity).toHaveBeenCalledTimes(3);
  });
});

describe("NativeRestAlert and the Activity", () => {
  const show = (sets: WorkoutSet[] | null, account: Account = open) => (
    <NativeRestAlert account={account} session={sets && { workout, sets }} />
  );

  it("one call when a set is logged, none while the clock runs", async () => {
    view.active = active();
    const { rerender } = render(show([]));
    await vi.waitFor(() => expect(native.setLiveActivity).toHaveBeenCalledTimes(1));
    expect(shown(1)).toMatchObject({ workoutId: W, state: { status: "due" } });

    view.active = active({ restEndsAt: at(120) });
    rerender(show(firstSet));
    await vi.waitFor(() => expect(native.setLiveActivity).toHaveBeenCalledTimes(2));
    expect(shown(2)).toMatchObject({ state: { status: "rest", restEnd: NOW + 120_000 } });

    // The screen draws again while the rest counts down: its clocks run on the phone.
    for (const s of [1, 30, 90]) {
      vi.setSystemTime(NOW + s * 1000);
      rerender(show(firstSet));
    }
    await quiet();
    expect(native.setLiveActivity).toHaveBeenCalledTimes(2);
  });

  it("finishing or deleting the session sends nothing to show", async () => {
    view.active = active();
    const { rerender } = render(show(firstSet));
    await vi.waitFor(() => expect(native.setLiveActivity).toHaveBeenCalledTimes(1));
    view.active = null;
    rerender(show(null));
    await vi.waitFor(() => expect(native.setLiveActivity).toHaveBeenCalledTimes(2));
    expect(native.setLiveActivity).toHaveBeenLastCalledWith({ activity: null });
  });

  it("a signed-out account ends the Activity, a loading one leaves it", async () => {
    const { rerender } = render(show(null, { kind: "loading" }));
    await quiet();
    expect(native.setLiveActivity).not.toHaveBeenCalled();
    rerender(show(null, { kind: "signed-out", unreachable: false }));
    await vi.waitFor(() =>
      expect(native.setLiveActivity).toHaveBeenCalledExactlyOnceWith({ activity: null }),
    );
    cleanup();

    // An account whose local data cannot be opened ends it too.
    showLiveActivity({ workoutId: "again" } as LiveActivity);
    await vi.waitFor(() => expect(native.setLiveActivity).toHaveBeenCalledTimes(2));
    render(show(null, { kind: "unavailable" } as Account));
    await vi.waitFor(() => expect(native.setLiveActivity).toHaveBeenCalledTimes(3));
    expect(native.setLiveActivity).toHaveBeenLastCalledWith({ activity: null });
  });

  it("nothing is sent while this phone's records are still being read", async () => {
    // At launch an Activity left by the last run is still the open session's: an empty first
    // read must not end it.
    view.reading = true;
    view.active = active();
    const { rerender } = render(show(null));
    await quiet();
    expect(native.setLiveActivity).not.toHaveBeenCalled();
    view.reading = false;
    rerender(show([]));
    await vi.waitFor(() => expect(native.setLiveActivity).toHaveBeenCalledTimes(1));
    expect(shown(1)).toMatchObject({ workoutId: W, state: { status: "due" } });
  });

  it("leaving the account ends it", async () => {
    view.active = active();
    const { unmount } = render(show([]));
    await vi.waitFor(() => expect(native.setLiveActivity).toHaveBeenCalledTimes(1));
    unmount();
    await vi.waitFor(() => expect(native.setLiveActivity).toHaveBeenCalledTimes(2));
    expect(native.setLiveActivity).toHaveBeenLastCalledWith({ activity: null });
  });

  it("a rejected call changes nothing and the next change is still sent", async () => {
    native.setLiveActivity.mockRejectedValueOnce(new Error("Activities are off"));
    view.active = active();
    const { rerender } = render(show([]));
    await vi.waitFor(() => expect(native.setLiveActivity).toHaveBeenCalledTimes(1));
    view.active = active({ restEndsAt: at(120) });
    rerender(show(firstSet));
    await vi.waitFor(() => expect(native.setLiveActivity).toHaveBeenCalledTimes(2));
    expect(shown(2)).toMatchObject({ state: { status: "rest" } });
  });
});
