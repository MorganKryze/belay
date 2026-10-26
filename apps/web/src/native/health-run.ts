// Brings Apple Health in line with the phone's data for the open account: one run at a time, a
// request during a run giving one more run after it, batches of 100, and only what Health
// confirmed recorded, so a run cut short starts again where it was.
import type { AccountDb } from "@/sync/db";
import {
  HEALTH_BATCH,
  type HealthObject,
  type HealthOutcome,
  health,
  healthProgress,
  markHistorySent,
  readHealth,
  recordWritten,
  type Written,
} from "./health";
import { afterOutcome, keyOf, ownerOf, planHealth } from "./health-plan";

export type HealthRunner = { request(): void; foreground(): void; stop(): void };

type Type = "workouts" | "weighings";
const typeOf = (o: HealthObject): Type =>
  o.kind === "workout" || o.kind === "workoutRemoved" ? "workouts" : "weighings";

export function createHealthRunner(
  db: AccountDb,
  userId: string,
  // Told when a run is over, so the page reads the stored state again.
  changed: () => void,
  now: () => number = Date.now,
): HealthRunner {
  const owner = ownerOf(userId);
  let running = false;
  let again = false;
  let stopped = false;
  // A write access withdrawn in iOS: that type waits for the next foreground.
  const blocked: Record<Type, boolean> = { workouts: false, weighings: false };

  async function once(): Promise<void> {
    const { settings, written, imported } = await readHealth(db);
    // Off: not one call to Health.
    if (!settings.on) return healthProgress.set({ sending: null, pending: 0 });
    const status = await health({ op: "status" });
    if (!status.available) return;
    const tx = db.transaction(["workouts", "sets", "weights"]);
    const [workouts, sets, weights] = await Promise.all([
      tx.objectStore("workouts").getAll(),
      tx.objectStore("sets").getAll(),
      tx.objectStore("weights").getAll(),
    ]);
    const objects = planHealth({
      workouts,
      sets,
      weights,
      settings,
      written,
      filled: imported.filled,
      allowed: {
        workouts: status.workouts === "allowed" && !blocked.workouts,
        weighings: status.weighings === "allowed" && !blocked.weighings,
      },
      now: now(),
      owner,
    });
    const history = settings.history === "asked";
    const total = objects.length;
    let pending = 0;
    let off = false;
    healthProgress.set({ sending: history && total > 0 ? { done: 0, total } : null, pending: 0 });
    for (let i = 0; i < total; i += HEALTH_BATCH) {
      if (stopped) return;
      // Turned off meanwhile, or off and on again (a new turn-on with its own history choice):
      // nothing more of this plan goes. A batch already handed to iOS completes.
      const current = (await readHealth(db)).settings;
      if (!current.on || current.turnedOnAt !== settings.turnedOnAt) {
        off = true;
        break;
      }
      const batch = objects.slice(i, i + HEALTH_BATCH).filter((o) => !blocked[typeOf(o)]);
      const outcomes: HealthOutcome[] =
        batch.length === 0
          ? []
          : await health({ op: "apply", objects: batch }).then(
              (r) => r.outcomes,
              // Health locked or the bridge failing: the whole batch waits for the next run.
              () => batch.map(() => "unavailable" as const),
            );
      const entries: Record<string, Written> = {};
      batch.forEach((o, k) => {
        const outcome = outcomes[k] ?? "failed";
        if (outcome === "denied") blocked[typeOf(o)] = true;
        const kept = afterOutcome(o, outcome, written[keyOf(o)]);
        if (kept) entries[keyOf(o)] = kept;
        else if (outcome !== "denied") pending++;
      });
      await recordWritten(db, entries);
      const done = Math.min(total, i + HEALTH_BATCH);
      healthProgress.set({ sending: history ? { done, total } : null, pending });
    }
    // The history is sent once every object of it was taken, and only for the turn-on that
    // asked for it: turned off and on again meanwhile, it is offered anew.
    if (history && !off && pending === 0 && !blocked.workouts && !blocked.weighings)
      await markHistorySent(db, settings.turnedOnAt);
    healthProgress.set({ sending: null, pending: off ? 0 : pending });
    changed();
  }

  function request(): void {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    void (async () => {
      do {
        again = false;
        await once().catch(() => {
          // The database closing or Health refusing its status (a build without the
          // entitlement): no « n sur N » stays on screen, and the next request tries again.
          healthProgress.set({ ...healthProgress.get(), sending: null });
        });
      } while (again && !stopped);
      running = false;
    })();
  }

  return {
    request,
    foreground() {
      blocked.workouts = false;
      blocked.weighings = false;
      request();
    },
    stop() {
      stopped = true;
    },
  };
}
