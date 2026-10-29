// The open session on the iPhone's lock screen and in the Dynamic Island, described for the
// native side. The clocks there run by themselves, so only a change of what it shows is sent,
// never a tick. Loaded with the rest alert, on the phone only.
import { exerciseById } from "@belay/shared/exercises/catalog";
import { type PauseStops, restClock } from "@belay/shared/training/pause";
import { FORGOTTEN_MS, restSecAfter, sessionProgress } from "@belay/shared/training/rules";
import type { Workout, WorkoutSet } from "@belay/shared/training/workout";
import type { TFunction } from "i18next";
import type { ActiveSession } from "@/sync/db";
import { BelayNative } from "./plugin";

export type OpenSession = { workout: Workout; sets: readonly WorkoutSet[] };
export type ActivityStatus = "due" | "rest" | "paused" | "done";
// Every word already in the person's language: the lock screen has no text of its own. Times
// are epoch milliseconds.
export interface ActivityState {
  status: ActivityStatus;
  title: string;
  detail: string;
  statusLabel: string;
  restOverTitle: string;
  restOverDetail: string;
  staleLine: string;
  startedAt: number;
  pausedAt: number | null;
  restStart: number | null;
  restEnd: number | null;
  restFrozen: boolean;
}
export interface LiveActivity {
  workoutId: string;
  staleAt: number;
  state: ActivityState;
}

// ActivityKit refuses an update above 4 KB: 80 characters a text keeps the whole far below it.
// The Android app refuses a longer text; a test holds its decoder to this value.
export const ACTIVITY_TEXT_MAX = 80;
const cap = (text: string) => text.slice(0, ACTIVITY_TEXT_MAX);
const latest = (sets: readonly WorkoutSet[]) =>
  sets.reduce<WorkoutSet | null>((last, s) => (last && last.doneAt >= s.doneAt ? last : s), null);

// What the session bar says, for the lock screen. Only a session taken up on this phone: its rest
// and pause live in this phone's record, and another device's session has neither. The exercise
// and the set's place go out, never a load or a weight.
export function liveActivityOf(
  open: OpenSession | null,
  active: ActiveSession | null | undefined,
  stops: PauseStops,
  now: number,
  t: TFunction,
): LiveActivity | null {
  if (!open || active?.workoutId !== open.workout.id) return null;
  const { workout, sets } = open;
  const progress = sessionProgress(workout.plan, sets);
  const next = progress.next;
  const slot = next && workout.plan[next.slotIndex];
  const letter = t("sessionBar.session", { code: workout.sessionCode });
  const end = active.restEndsAt ? Date.parse(active.restEndsAt) : null;
  const paused = active.pausedAt ?? null;
  // A pause that stops everything holds the rest where it stood.
  const resting = end !== null && end > restClock(paused, now, stops);
  const restFrozen = paused !== null && stops === "all";
  const status: ActivityStatus = paused ? "paused" : resting ? "rest" : slot ? "due" : "done";

  // The window the bar empties over is the rest planned, as the session's rest bar measures it:
  // +30 s past the plan fills it again. With no rest planned, it starts at the last work set.
  let restStart: number | null = null;
  if (resting) {
    const planned = progress.last ? restSecAfter(workout.plan, progress.last.slotIndex) * 1000 : 0;
    const work = latest(sets.filter((s) => !s.warmup));
    restStart = planned > 0 || !work ? end - planned : Date.parse(work.doneAt);
  }
  // iOS redraws at this date with no word from the app: the rest over at its end, else the line
  // asking to open the app at the shell's forgotten mark.
  const lastSet = latest(sets)?.doneAt ?? workout.startedAt;
  const staleAt = resting && !restFrozen ? end : Date.parse(lastSet) + FORGOTTEN_MS;

  return {
    workoutId: workout.id,
    staleAt,
    state: {
      status,
      title: cap(
        slot ? (exerciseById(slot.exerciseId)?.name ?? slot.exerciseId) : t("native.activity.done"),
      ),
      detail: cap(
        slot
          ? `${t("sessionBar.setLead", { n: next.round + 1, total: slot.sets })} · ${letter}`
          : letter,
      ),
      statusLabel: cap(
        t(
          status === "paused"
            ? "sessionBar.paused"
            : status === "rest"
              ? "sessionBar.rest"
              : "sessionBar.running",
        ),
      ),
      restOverTitle: cap(t("session.restOver")),
      restOverDetail: cap(t("session.backToIt")),
      staleLine: cap(t("native.activity.stale")),
      startedAt: Date.parse(workout.startedAt),
      pausedAt: paused ? Date.parse(paused) : null,
      restStart,
      restEnd: resting ? end : null,
      restFrozen,
    },
  };
}

// The description last asked for, as JSON, and whether a call is under way. The page asks on
// every render: a repeat is dropped here, so iOS hears of a change once.
let wanted: string | undefined;
let asked: LiveActivity | null = null;
let sending = false;
// The last description is to go once more, unchanged.
let again = false;

// One call at a time, each awaited, so an older description never lands after a newer one; what
// is asked meanwhile waits, and only the latest goes.
export function showLiveActivity(next: LiveActivity | null): void {
  const json = JSON.stringify(next);
  if (json === wanted) return;
  wanted = json;
  asked = next;
  if (!sending) void send();
}

// Android posts nothing for a description sent while notifications are off: once they are
// allowed, the last one goes again, after the call under way if there is one.
export function resendLiveActivity(): void {
  if (wanted === undefined) return;
  again = true;
  if (!sending) void send();
}

async function send(): Promise<void> {
  sending = true;
  let sent: string | undefined;
  while (sent !== wanted || again) {
    sent = wanted;
    again = false;
    try {
      await BelayNative.setLiveActivity({ activity: asked });
    } catch {
      // Activities turned off, the device's limit, or a start refused in the background: the
      // app keeps working without the lock screen, and the next change tries again.
    }
  }
  sending = false;
}
