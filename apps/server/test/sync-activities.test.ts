import { newId } from "@belay/shared";
import type { Change, SyncResponse } from "@belay/shared/sync/schema";
import { appendSlot, replaceSlot, skipSlot } from "@belay/shared/training/plan";
import { sessionByCode } from "@belay/shared/training/program";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { oidcProvider } from "../src/auth/oidc";
import { hashToken, newSessionToken, SESSION_COOKIE } from "../src/auth/session";
import { loadConfig } from "../src/config";
import { asUser } from "../src/db/client";
import { createSession, upsertUser } from "../src/db/identity";
import { activities, dailySteps, workoutSets, workouts } from "../src/db/schema";
import { testEnv } from "./config";
import { appDb, testDb } from "./db";

// The server as it runs: the belay_app login role, row-level security on every request. The
// owner only reads what was stored.
const { db } = appDb();
const owner = testDb().db;
const cfg = loadConfig(testEnv({ OIDC_ISSUER: "http://localhost:1" }));
const app = createApp({ cfg, db, getOidc: oidcProvider(cfg.oidc) });

const AT = "2026-10-07T17:00:00.000Z";
const LATER = "2026-10-07T17:05:00.000Z";
const LATEST = "2026-10-07T17:10:00.000Z";
const B = [...sessionByCode("B")!.slots];
const PLANK = { id: "ds:2135", measure: "seconds" as const };

async function signIn(sub: string) {
  const user = await upsertUser(db, { issuer: "https://idp.test", sub, displayName: sub });
  const token = newSessionToken();
  await createSession(db, hashToken(token, cfg.tokenHashKey), user, 30);
  const cookie = `${SESSION_COOKIE}=${token}`;
  const sync = async (cursor: string, changes: Change[] = []) => {
    const res = await app.request("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ account: user, cursor, changes }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as SyncResponse;
  };
  return { user, sync };
}

const steps = (date: string, value: number | null, at: string): Change => ({
  kind: "steps",
  date,
  value,
  at,
});
const climb = (id: string, at: string, patch: Record<string, unknown> = {}): Change =>
  ({
    kind: "activity",
    id,
    field: "fields",
    date: "2026-10-07",
    type: "climbing",
    durationMin: 90,
    cardioType: null,
    climbStyle: "boulder",
    climbRuns: 14,
    climbGrade: "6b+",
    climbColor: null,
    at,
    ...patch,
  }) as Change;
const start = (id: string, plan = B, at = AT): Change => ({
  kind: "workout",
  id,
  field: "start",
  sessionCode: "B",
  plan,
  startedAt: at,
  at,
});
const planChange = (id: string, value: typeof B, at: string): Change => ({
  kind: "workout",
  id,
  field: "plan",
  value,
  at,
});
const create = (
  id: string,
  workoutId: string,
  patch: Partial<Extract<Change, { kind: "set"; field: "create" }>> = {},
): Change => ({
  kind: "set",
  id,
  workoutId,
  field: "create",
  slotIndex: 0,
  position: 3,
  exerciseId: "ds:0043",
  warmup: false,
  weightKg: 100,
  reps: 8,
  seconds: null,
  rir: 2,
  doneAt: LATER,
  at: LATER,
  ...patch,
});

describe("steps and activities through /api/sync", () => {
  it("keeps the day's steps, the later write winning, and a deletion", async () => {
    const { sync } = await signIn("ac-steps");
    const first = await sync("0", [steps("2026-10-07", 8400, LATER)]);
    expect(first.steps).toEqual([{ date: "2026-10-07", steps: 8400, stepsAt: LATER }]);
    // Older than what is stored: loses, and the stored day comes back.
    const late = await sync(first.cursor, [steps("2026-10-07", 100, AT)]);
    expect(late.steps).toEqual([{ date: "2026-10-07", steps: 8400, stepsAt: LATER }]);
    const gone = await sync(first.cursor, [steps("2026-10-07", null, LATEST)]);
    expect(gone.steps).toEqual([{ date: "2026-10-07", steps: null, stepsAt: LATEST }]);
  });

  it("creates an activity, edits its block, removes it, and sends a losing edit back", async () => {
    const { sync } = await signIn("ac-activity");
    const id = newId();
    const first = await sync("0", [climb(id, AT)]);
    expect(first.rejected).toEqual([]);
    expect(first.activities).toEqual([
      {
        id,
        date: "2026-10-07",
        type: "climbing",
        durationMin: 90,
        cardioType: null,
        climbStyle: "boulder",
        climbRuns: 14,
        climbGrade: "6b+",
        climbColor: null,
        fieldsAt: AT,
        removed: false,
        removedAt: null,
      },
    ]);
    const edited = await sync(first.cursor, [
      climb(id, LATEST, { climbGrade: null, climbColor: "blue", durationMin: 120 }),
      climb(id, LATER, { durationMin: 30 }), // earlier than the edit before it: loses
    ]);
    expect(edited.activities[0]).toMatchObject({ durationMin: 120, climbColor: "blue" });
    const removed = await sync(edited.cursor, [
      { kind: "activity", id, field: "removed", value: true, at: LATEST },
    ]);
    expect(removed.activities[0]).toMatchObject({ removed: true, removedAt: LATEST });
  });

  it("refuses the removal of an activity never created, and someone else's", async () => {
    const a = await signIn("ac-owner-a");
    const b = await signIn("ac-owner-b");
    const id = newId();
    await a.sync("0", [climb(id, AT)]);
    const res = await b.sync("0", [
      { kind: "activity", id, field: "removed", value: true, at: LATER },
      { kind: "activity", id: newId(), field: "removed", value: true, at: LATER },
      climb(id, LATER), // A's id for one of B's own
    ]);
    expect(res.rejected).toEqual([
      { index: 0, reason: "unknown" },
      { index: 1, reason: "unknown" },
      { index: 2, reason: "unknown" },
    ]);
    const [row] = await owner.select().from(activities).where(eq(activities.id, id));
    expect(row?.removed).toBe(false);
  });

  it("isolates two people, through the API and in SQL", async () => {
    const a = await signIn("ac-iso-a");
    const b = await signIn("ac-iso-b");
    await a.sync("0", [steps("2026-10-07", 8400, AT), climb(newId(), AT)]);
    const seen = await b.sync("0");
    expect(seen.steps).toEqual([]);
    expect(seen.activities).toEqual([]);
    const rows = await asUser(db, b.user, async (tx) => [
      ...(await tx.select().from(dailySteps)),
      ...(await tx.select().from(activities)),
    ]);
    expect(rows).toEqual([]);
  });
});

describe("a session's own plan and start through /api/sync", () => {
  it("takes the later plan, and sends a losing one back", async () => {
    const { sync } = await signIn("pl-later");
    const w = newId();
    const replaced = replaceSlot(B, 0, { id: "ds:1760", measure: "reps" });
    const skipped = skipSlot(B, 2, true);
    const first = await sync("0", [start(w), planChange(w, replaced, LATEST)]);
    expect(first.workouts[0]).toMatchObject({ plan: replaced, planAt: LATEST });
    // Another device's plan, written before: it loses, and the stored plan comes back.
    const late = await sync(first.cursor, [planChange(w, skipped, LATER)]);
    expect(late.workouts).toEqual([
      expect.objectContaining({ id: w, plan: replaced, planAt: LATEST }),
    ]);
  });

  it("moves a session's start, the later write winning, a clock ahead brought back", async () => {
    const { sync } = await signIn("pl-start");
    const w = newId();
    const moved = "2026-10-06T17:00:00.000Z";
    const first = await sync("0", [
      start(w),
      { kind: "workout", id: w, field: "startedAt", value: moved, at: LATER },
      { kind: "workout", id: w, field: "ended", value: "2026-10-06T18:00:00.000Z", at: LATER },
    ]);
    expect(first.workouts[0]).toMatchObject({
      startedAt: moved,
      startedAtAt: LATER,
      endedAt: "2026-10-06T18:00:00.000Z",
    });
    const ahead = new Date(Date.now() + 3_600_000).toISOString();
    const res = await sync("0", [
      { kind: "workout", id: w, field: "startedAt", value: ahead, at: ahead },
    ]);
    expect(Date.parse(res.workouts[0]!.startedAt)).toBeLessThanOrEqual(Date.now());
  });

  it("refuses a plan naming an exercise the library lacks, and the stored one comes back", async () => {
    const { sync } = await signIn("pl-unknown");
    const w = newId();
    const bad = [...B, { ...B[0]!, exerciseId: "ds:9999" }];
    const first = await sync("0", [start(w)]);
    const res = await sync(first.cursor, [planChange(w, bad, LATER)]);
    expect(res.rejected).toEqual([{ index: 0, reason: "unknown_exercise" }]);
    expect(res.workouts[0]!.plan).toEqual(B);
    const other = newId();
    const refusedStart = await sync("0", [start(other, bad)]);
    expect(refusedStart.rejected).toEqual([{ index: 0, reason: "unknown_exercise" }]);
    expect(await owner.select().from(workouts).where(eq(workouts.id, other))).toEqual([]);
  });

  it("refuses a plan that would drop a slot, and the stored session comes back", async () => {
    const { sync } = await signIn("pl-shrank");
    const w = newId();
    const longer = appendSlot(B, PLANK);
    const first = await sync("0", [start(w), planChange(w, longer, LATER)]);
    // A stale device's shorter plan, even a later one: refused, the stored session echoed.
    const res = await sync(first.cursor, [planChange(w, B, LATEST)]);
    expect(res.rejected).toEqual([{ index: 0, reason: "plan_shrank" }]);
    expect(res.workouts).toEqual([expect.objectContaining({ id: w, plan: longer, planAt: LATER })]);
    // A plan as long, or longer, is taken as before.
    const same = replaceSlot(longer, 0, { id: "ds:1760", measure: "reps" });
    const ok = await sync(res.cursor, [planChange(w, same, LATEST)]);
    expect(ok.rejected).toEqual([]);
    expect(ok.workouts[0]).toMatchObject({ plan: same, planAt: LATEST });
    const more = await sync(ok.cursor, [
      planChange(w, appendSlot(same, PLANK), "2026-10-07T17:20:00.000Z"),
    ]);
    expect(more.rejected).toEqual([]);
    expect(more.workouts[0]!.plan).toHaveLength(longer.length + 1);
  });

  it("refuses a plan counting an exercise in the wrong measure", async () => {
    const { sync } = await signIn("pl-measure");
    const w = newId();
    await sync("0", [start(w)]);
    const timedSquat = [{ ...B[0]!, measure: "seconds" as const, repRange: [30, 60] as const }];
    const res = await sync("0", [
      planChange(w, appendSlot(B, PLANK), LATER), // right: the plank in seconds
      planChange(w, [...B, ...timedSquat], LATEST), // wrong: the squat in seconds
    ]);
    expect(res.rejected).toEqual([{ index: 1, reason: "wrong_measure" }]);
    expect(res.workouts[0]!.plan.at(-1)).toMatchObject({ exerciseId: PLANK.id });
  });
});

describe("timed sets through /api/sync", () => {
  it("keeps a timed set in seconds, and corrects it in seconds", async () => {
    const { sync } = await signIn("ts-keep");
    const w = newId();
    const set = newId();
    const plan = appendSlot(B, PLANK);
    const timed = {
      slotIndex: 7,
      exerciseId: PLANK.id,
      weightKg: 0,
      reps: null,
      seconds: 45,
      rir: null,
    };
    const first = await sync("0", [start(w, plan), create(set, w, timed)]);
    expect(first.rejected).toEqual([]);
    expect(first.sets[0]).toMatchObject({ reps: null, seconds: 45 });
    const res = await sync(first.cursor, [
      {
        kind: "set",
        id: set,
        workoutId: w,
        field: "values",
        weightKg: 10,
        reps: null,
        seconds: 60,
        rir: null,
        at: LATEST,
      },
    ]);
    expect(res.sets[0]).toMatchObject({ weightKg: 10, reps: null, seconds: 60 });
  });

  it("refuses reps for a timed exercise and seconds for one in reps, every change of that set", async () => {
    const { sync } = await signIn("ts-wrong");
    const w = newId();
    const plank = newId();
    const squat = newId();
    const kept = newId();
    const res = await sync("0", [
      start(w, appendSlot(B, PLANK)),
      create(plank, w, { slotIndex: 7, exerciseId: PLANK.id, reps: 45 }),
      create(squat, w, { reps: null, seconds: 45, rir: null }),
      { kind: "set", id: squat, workoutId: w, field: "removed", value: true, at: LATEST },
      create(kept, w, { position: 4 }),
      {
        kind: "set",
        id: kept,
        workoutId: w,
        field: "values",
        weightKg: 100,
        reps: null,
        seconds: 30,
        rir: null,
        at: LATEST,
      },
    ]);
    expect(res.rejected).toEqual([
      { index: 1, reason: "wrong_measure" },
      { index: 2, reason: "wrong_measure" },
      { index: 3, reason: "wrong_measure" },
      { index: 4, reason: "wrong_measure" },
      { index: 5, reason: "wrong_measure" },
    ]);
    expect(await owner.select().from(workoutSets).where(eq(workoutSets.workoutId, w))).toEqual([]);
  });

  it("refuses a correction in seconds of a set already stored in reps", async () => {
    const { sync } = await signIn("ts-stored");
    const w = newId();
    const set = newId();
    const first = await sync("0", [start(w), create(set, w)]);
    const res = await sync(first.cursor, [
      {
        kind: "set",
        id: set,
        workoutId: w,
        field: "values",
        weightKg: 100,
        reps: null,
        seconds: 30,
        rir: null,
        at: LATEST,
      },
    ]);
    expect(res.rejected).toEqual([{ index: 0, reason: "wrong_measure" }]);
    const [row] = await owner.select().from(workoutSets).where(eq(workoutSets.id, set));
    expect(row).toMatchObject({ reps: 8, seconds: null });
  });

  it("still takes a set queued before timed sets, without seconds", async () => {
    const { sync } = await signIn("ts-old");
    const w = newId();
    const old = create(newId(), w) as Record<string, unknown>;
    delete old.seconds;
    const res = await sync("0", [start(w), old as Change]);
    expect(res.rejected).toEqual([]);
    expect(res.sets[0]).toMatchObject({ reps: 8, seconds: null });
  });
});
