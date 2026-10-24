import { isCreatineName } from "@belay/shared/body/supplements";
import { exerciseById, isKnownExercise } from "@belay/shared/exercises/catalog";
import { MAX_ROWS } from "@belay/shared/sync/limits";
import { clampAt, mergeFields, mergeTarget, staleKeys } from "@belay/shared/sync/merge";
import type {
  ActiveProgramRow,
  ActivityChange,
  ActivityRow,
  AnnotationChange,
  AnnotationRow,
  Change,
  IntakeRow,
  MeasureRow,
  ProfileChange,
  ProfileRow,
  ProgramRow,
  ProgramSessionRow,
  ProgramSlotRow,
  Rejected,
  SetChange,
  SetRow,
  StepsRow,
  SupplementChange,
  SupplementLogChange,
  SupplementLogRow,
  SupplementRow,
  SyncRequest,
  SyncResponse,
  TargetChange,
  WeightRow,
  WorkoutChange,
  WorkoutRow,
} from "@belay/shared/sync/schema";
import { clampWorkoutTime, MAX_SETS, type Slot } from "@belay/shared/training/workout";
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { asUser, type Db, type Tx } from "../db/client";
import {
  activePrograms,
  activities,
  annotations,
  bodyMetrics,
  dailySteps,
  intakeLogs,
  programSessions,
  programSlots,
  programs,
  supplementLogs,
  supplements,
  users,
  workoutSets,
  workouts,
} from "../db/schema";
import {
  pointerRow,
  programRow,
  seedProgram,
  sessionRow,
  slotRow,
  writePrograms,
  writeProgramSessions,
  writeProgramSlots,
} from "./sync-program";

// A change and its place in the request, which a refusal names.
export type Indexed<C extends Change = Change> = C & { index: number };
const of =
  <K extends Change["kind"]>(kind: K) =>
  (c: Indexed): c is Indexed<Extract<Change, { kind: K }>> =>
    c.kind === kind;
export const nextSeq = sql`nextval('belay_sync_seq')`;
export const iso = (d: Date | null) => d?.toISOString() ?? null;

// What one sync owes the phone beyond the rows past its cursor: the changes it refused, and the
// keys whose stored rows it sends back because a change lost against them or was refused.
interface Outcome {
  rejected: Rejected[];
  days: Set<string>; // body_metrics, by date
  intake: Set<string>; // by date
  supplements: Set<string>; // by id
  logs: Set<string>; // `${supplementId}|${date}`
  annotations: Set<string>; // by id
  steps: Set<string>; // by date
  activities: Set<string>; // by id
  workouts: Set<string>; // by id
  sets: Set<string>; // by id
  programs: Set<string>; // by id
  sessions: Set<string>; // program sessions, by id
  slots: Set<string>; // program slots, by id
  active: boolean; // the active program pointer
  user: boolean; // the range and the profile
}

export interface Ctx {
  tx: Tx;
  userId: string;
  now: Date;
  out: Outcome;
  kinds: Change["kind"][]; // by place in the request
}

// One sync, in one transaction as the person: write the changes that win, then read back what
// changed since the cursor. The explicit user filters come first, row-level security second.
export function runSync(
  db: Db,
  userId: string,
  request: SyncRequest,
  now = new Date(),
): Promise<SyncResponse> {
  return asUser(db, userId, async (tx) => {
    // Syncs of one person run one after the other: two transactions taking server_seq values
    // and committing in the other order would let a cursor skip a row.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
    const changes: Indexed[] = request.changes.map((c, index) => ({ ...c, index }));
    const out: Outcome = {
      rejected: [],
      days: new Set(),
      intake: new Set(),
      supplements: new Set(),
      logs: new Set(),
      annotations: new Set(),
      steps: new Set(),
      activities: new Set(),
      workouts: new Set(),
      sets: new Set(),
      programs: new Set(),
      sessions: new Set(),
      slots: new Set(),
      active: false,
      user: false,
    };
    const ctx: Ctx = { tx, userId, now, out, kinds: changes.map((c) => c.kind) };
    // The starting program first, so an edit made on its rows before this first sync lands on them.
    await seedProgram(ctx);
    // A weigh-in is the day's "weight" field, beside the measurements.
    const body: DayChange[] = [
      ...changes.filter(of("weight")).map((c) => ({ ...c, field: "weight", value: c.weightKg })),
      ...changes.filter(of("measure")),
    ];
    await writeDayFields(ctx, BODY, body, out.days);
    await writeDayFields(ctx, INTAKE, changes.filter(of("intake")), out.intake);
    await writeTarget(ctx, changes.filter(of("target")));
    await writeProfile(ctx, changes.filter(of("profile")));
    // Supplements before their ticks: a tick may name a supplement created in the same batch.
    await writeSupplements(ctx, changes.filter(of("supplement")));
    await writeSupplementLogs(ctx, changes.filter(of("supplementLog")));
    await writeAnnotations(ctx, changes.filter(of("annotation")));
    const steps = changes.filter(of("steps")).map((c) => ({ ...c, field: "steps" }));
    await writeDayFields(ctx, STEPS, steps, out.steps);
    await writeActivities(ctx, changes.filter(of("activity")));
    // Programs before their sessions, sessions before their slots: each may name one created in
    // the same batch. All before the sessions done, which record the session they came from.
    await writePrograms(ctx, changes.filter(of("program")), changes.filter(of("activeProgram")));
    await writeProgramSessions(ctx, changes.filter(of("programSession")));
    await writeProgramSlots(ctx, changes.filter(of("programSlot")));
    // Sessions before their sets: a set may name a session started in the same batch.
    await writeWorkouts(ctx, changes.filter(of("workout")));
    await writeSets(ctx, changes.filter(of("set")));
    return readSince(tx, userId, BigInt(request.cursor), out);
  });
}

// SQLSTATE classes the database answers when it refuses the data itself: 22 (a value it cannot
// take), 23 (a check or a key) and 42501 (a row-level policy). Anything else is a server error.
function isRefusal(error: unknown): boolean {
  const code = sqlstate(error);
  return code !== null && (/^2[23]/.test(code) || code === "42501");
}
function sqlstate(error: unknown): string | null {
  const code = (error as { cause?: { code?: unknown } }).cause?.code;
  return typeof code === "string" ? code : null;
}

// Writes the rows in one statement inside a savepoint. When the database refuses it, each row is
// written again alone, so only the refused ones are dropped: one bad change never blocks a queue.
// ponytail: a refused statement is retried row by row, one savepoint each (500 at most per
// request). Upgrade: bisect the rows if refusals ever come in long queues.
export async function guarded<R extends { index: number }>(
  { tx, out, kinds }: Ctx,
  rows: R[],
  write: (tx: Tx, rows: R[]) => Promise<unknown>,
  onRefused: (row: R) => void,
): Promise<void> {
  if (rows.length === 0) return;
  try {
    await tx.transaction((sp) => write(sp, rows));
    return;
  } catch (error) {
    if (!isRefusal(error)) throw error;
  }
  for (const row of rows) {
    try {
      await tx.transaction((sp) => write(sp, [row]));
    } catch (error) {
      if (!isRefusal(error)) throw error;
      // The SQLSTATE and the kind only: a value or an id is health data, never logged.
      console.warn("sync: change refused by the database:", kinds[row.index], sqlstate(error));
      out.rejected.push({ index: row.index, reason: "refused" });
      onRefused(row);
    }
  }
}

// Changes naming something this account does not have: someone else's, or never created.
export function unknown(out: Outcome, changes: { index: number }[]) {
  for (const c of changes) out.rejected.push({ index: c.index, reason: "unknown" });
}

// A table keyed by person and day whose values each carry their own timestamp.
type DayTable = {
  table: typeof bodyMetrics | typeof intakeLogs | typeof dailySteps;
  fields: Record<string, readonly [value: PgColumn, at: PgColumn]>;
};
const BODY: DayTable = {
  table: bodyMetrics,
  fields: {
    weight: [bodyMetrics.weightKg, bodyMetrics.weightAt],
    waist: [bodyMetrics.waistCm, bodyMetrics.waistAt],
    neck: [bodyMetrics.neckCm, bodyMetrics.neckAt],
    hip: [bodyMetrics.hipCm, bodyMetrics.hipAt],
  },
};
const INTAKE: DayTable = {
  table: intakeLogs,
  fields: {
    kcal: [intakeLogs.kcal, intakeLogs.kcalAt],
    protein: [intakeLogs.proteinG, intakeLogs.proteinAt],
  },
};
const STEPS: DayTable = {
  table: dailySteps,
  fields: { steps: [dailySteps.steps, dailySteps.stepsAt] },
};
type DayChange = { index: number; date: string; field: string; value: number | null; at: string };

// Field by field: two devices writing the same day write one row, and a waist written on the
// phone never overwrites a weight written on the laptop.
async function writeDayFields(
  ctx: Ctx,
  { table, fields }: DayTable,
  changes: DayChange[],
  echo: Set<string>,
) {
  const { tx, userId, now } = ctx;
  for (const [field, [value, at]] of Object.entries(fields)) {
    const mine = changes.filter((c) => c.field === field);
    if (mine.length === 0) continue;
    const dates = [...new Set(mine.map((c) => c.date))];
    const rows = await tx
      .select({ date: table.date, at })
      .from(table)
      .where(and(eq(table.userId, userId), inArray(table.date, dates)));
    const stored = new Map(rows.map((r) => [r.date, iso(r.at as Date | null)]));
    for (const date of staleKeys(stored, mine, (c) => c.date, now)) echo.add(date);
    const v = sql.identifier(value.name);
    const a = sql.identifier(at.name);
    await guarded(
      ctx,
      mergeFields(stored, mine, (c) => c.date, now),
      (sp, batch) =>
        sp.execute(sql`
          insert into ${table} (user_id, date, ${v}, ${a})
          values ${sql.join(
            batch.map((c) => sql`(${userId}, ${c.date}, ${c.value}, ${c.at})`),
            sql`, `,
          )}
          on conflict (user_id, date) do update set
            ${v} = excluded.${v}, ${a} = excluded.${a},
            server_seq = ${nextSeq}, updated_at = now()
          where ${table}.${a} is null or excluded.${a} > ${table}.${a}`),
      (c) => echo.add(c.date), // the phone gets the stored day back, if there is one
    );
  }
}

async function writeTarget(ctx: Ctx, changes: Indexed<TargetChange>[]) {
  const { tx, userId, now, out } = ctx;
  if (changes.length === 0) return;
  const [me] = await tx.select({ at: users.targetAt }).from(users).where(eq(users.id, userId));
  const stored = iso(me?.at ?? null);
  if (staleKeys(new Map([["target", stored]]), changes, () => "target", now).size > 0)
    out.user = true;
  const winner = mergeTarget(stored, changes, now);
  await guarded(
    ctx,
    winner ? [winner] : [],
    (sp, [w]) =>
      sp
        .update(users)
        .set({
          targetMinPct: w!.minPct,
          targetMaxPct: w!.maxPct,
          targetAt: new Date(w!.at),
          serverSeq: nextSeq,
          updatedAt: sql`now()`,
        })
        .where(eq(users.id, userId)),
    () => (out.user = true),
  );
}

const PROFILE = {
  formula: [users.formula, users.formulaAt],
  birthYear: [users.birthYear, users.birthYearAt],
  height: [users.heightCm, users.heightAt],
} as const;

async function writeProfile(ctx: Ctx, changes: Indexed<ProfileChange>[]) {
  const { tx, userId, now, out } = ctx;
  if (changes.length === 0) return;
  const [me] = await tx
    .select({ formula: users.formulaAt, birthYear: users.birthYearAt, height: users.heightAt })
    .from(users)
    .where(eq(users.id, userId));
  const stored = new Map(Object.entries(me ?? {}).map(([k, v]) => [k, iso(v)]));
  if (staleKeys(stored, changes, (c) => c.field, now).size > 0) out.user = true;
  await guarded(
    ctx,
    mergeFields(stored, changes, (c) => c.field, now),
    async (sp, batch) => {
      for (const c of batch) {
        const [value, at] = PROFILE[c.field];
        await sp.execute(sql`
          update ${users} set ${sql.identifier(value.name)} = ${c.value},
            ${sql.identifier(at.name)} = ${c.at}, server_seq = ${nextSeq}, updated_at = now()
          where id = ${userId}`);
      }
    },
    () => (out.user = true),
  );
}

// Supplements and annotations are created by the first change of their id that carries the
// required fields (a name; a day, type and text). An id that is someone else's (the insert finds
// it taken) or never had such a change is unknown to this account: its changes are refused.
export async function createMissing<C extends { id: string; index: number }>(
  ctx: Ctx,
  changes: C[],
  known: Set<string>,
  isCreation: (c: C) => boolean,
  insert: (tx: Tx, first: C) => Promise<unknown[]>,
): Promise<C[]> {
  const firsts = new Map<string, C>();
  for (const c of changes)
    if (!known.has(c.id) && !firsts.has(c.id) && isCreation(c)) firsts.set(c.id, c);
  const created = new Set<string>();
  const refused = new Set<string>();
  await guarded(
    ctx,
    [...firsts.values()],
    async (sp, batch) => {
      for (const c of batch) if ((await insert(sp, c)).length > 0) created.add(c.id);
    },
    (c) => refused.add(c.id),
  );
  const kept = (c: C) => known.has(c.id) || created.has(c.id);
  // The creation the database refused is already reported; the rest of that id is unknown.
  unknown(
    ctx.out,
    changes.filter((c) => !kept(c) && !(refused.has(c.id) && firsts.get(c.id) === c)),
  );
  return changes.filter(kept);
}

async function writeSupplements(ctx: Ctx, changes: Indexed<SupplementChange>[]) {
  const { tx, userId, now, out } = ctx;
  if (changes.length === 0) return;
  const ids = [...new Set(changes.map((c) => c.id))];
  const read = () =>
    tx
      .select({ id: supplements.id, name: supplements.nameAt, removed: supplements.removedAt })
      .from(supplements)
      .where(and(eq(supplements.userId, userId), inArray(supplements.id, ids)));
  const kept = await createMissing(
    ctx,
    changes,
    new Set((await read()).map((r) => r.id)),
    (c) => c.field === "name",
    (sp, c) =>
      sp
        .insert(supplements)
        .values({
          id: c.id,
          userId,
          name: String(c.value),
          nameAt: new Date(clampAt(c.at, now)),
          // From the first name, never from the phone (§6): the rule the phone applies too.
          kind: isCreatineName(String(c.value)) ? "creatine" : "other",
        })
        .onConflictDoNothing({ target: supplements.id })
        .returning({ id: supplements.id }),
  );
  const stored = new Map(
    (await read()).flatMap((r) => [
      [`${r.id}|name`, iso(r.name)],
      [`${r.id}|removed`, iso(r.removed)],
    ]),
  );
  const key = (c: SupplementChange) => `${c.id}|${c.field}`;
  for (const k of staleKeys(stored, kept, key, now)) out.supplements.add(k.split("|")[0]!);
  await guarded(
    ctx,
    mergeFields(stored, kept, key, now),
    async (sp, batch) => {
      for (const c of batch)
        await sp
          .update(supplements)
          .set({
            ...(c.field === "name"
              ? { name: c.value, nameAt: new Date(c.at) }
              : { removed: c.value, removedAt: new Date(c.at) }),
            serverSeq: nextSeq,
            updatedAt: sql`now()`,
          })
          .where(and(eq(supplements.id, c.id), eq(supplements.userId, userId)));
    },
    (c) => out.supplements.add(c.id),
  );
}

async function writeSupplementLogs(ctx: Ctx, changes: Indexed<SupplementLogChange>[]) {
  const { tx, userId, now, out } = ctx;
  if (changes.length === 0) return;
  const ids = [...new Set(changes.map((c) => c.supplementId))];
  const mine = new Set(
    (
      await tx
        .select({ id: supplements.id })
        .from(supplements)
        .where(and(eq(supplements.userId, userId), inArray(supplements.id, ids)))
    ).map((r) => r.id),
  );
  // A tick of a supplement this account does not have: someone else's, or one never sent.
  unknown(
    out,
    changes.filter((c) => !mine.has(c.supplementId)),
  );
  const kept = changes.filter((c) => mine.has(c.supplementId));
  if (kept.length === 0) return;
  const key = (c: { supplementId: string; date: string }) => `${c.supplementId}|${c.date}`;
  const rows = await tx
    .select({
      supplementId: supplementLogs.supplementId,
      date: supplementLogs.date,
      at: supplementLogs.takenAt,
    })
    .from(supplementLogs)
    .where(
      and(
        eq(supplementLogs.userId, userId),
        inArray(supplementLogs.supplementId, [...mine]),
        inArray(supplementLogs.date, [...new Set(kept.map((c) => c.date))]),
      ),
    );
  const stored = new Map(rows.map((r) => [key(r), iso(r.at)]));
  for (const k of staleKeys(stored, kept, key, now)) out.logs.add(k);
  await guarded(
    ctx,
    mergeFields(stored, kept, key, now),
    (sp, batch) =>
      sp
        .insert(supplementLogs)
        .values(
          batch.map((c) => ({
            userId,
            supplementId: c.supplementId,
            date: c.date,
            taken: c.taken,
            takenAt: new Date(c.at),
          })),
        )
        .onConflictDoUpdate({
          target: [supplementLogs.userId, supplementLogs.supplementId, supplementLogs.date],
          set: { taken: sql`excluded.taken`, takenAt: sql`excluded.taken_at`, serverSeq: nextSeq },
          // Same rule as mergeFields, kept in SQL as a second barrier.
          setWhere: sql`excluded.taken_at > ${supplementLogs.takenAt}`,
        }),
    (c) => out.logs.add(key(c)),
  );
}

async function writeAnnotations(ctx: Ctx, changes: Indexed<AnnotationChange>[]) {
  const { tx, userId, now, out } = ctx;
  if (changes.length === 0) return;
  const ids = [...new Set(changes.map((c) => c.id))];
  const read = () =>
    tx
      .select({ id: annotations.id, fields: annotations.fieldsAt, removed: annotations.removedAt })
      .from(annotations)
      .where(and(eq(annotations.userId, userId), inArray(annotations.id, ids)));
  const kept = await createMissing(
    ctx,
    changes,
    new Set((await read()).map((r) => r.id)),
    (c) => c.field === "fields",
    (sp, c) =>
      c.field !== "fields"
        ? Promise.resolve([])
        : sp
            .insert(annotations)
            .values({
              id: c.id,
              userId,
              date: c.date,
              kind: c.type,
              label: c.label,
              fieldsAt: new Date(clampAt(c.at, now)),
            })
            .onConflictDoNothing({ target: annotations.id })
            .returning({ id: annotations.id }),
  );
  const stored = new Map(
    (await read()).flatMap((r) => [
      [`${r.id}|fields`, iso(r.fields)],
      [`${r.id}|removed`, iso(r.removed)],
    ]),
  );
  const key = (c: AnnotationChange) => `${c.id}|${c.field}`;
  for (const k of staleKeys(stored, kept, key, now)) out.annotations.add(k.split("|")[0]!);
  await guarded(
    ctx,
    mergeFields(stored, kept, key, now),
    async (sp, batch) => {
      for (const c of batch)
        await sp
          .update(annotations)
          .set({
            ...(c.field === "fields"
              ? { date: c.date, kind: c.type, label: c.label, fieldsAt: new Date(c.at) }
              : { removed: c.value, removedAt: new Date(c.at) }),
            serverSeq: nextSeq,
            updatedAt: sql`now()`,
          })
          .where(and(eq(annotations.id, c.id), eq(annotations.userId, userId)));
    },
    (c) => out.annotations.add(c.id),
  );
}

// An activity, as an annotation: created by its first block of fields, then its block and its
// removal merge apart.
async function writeActivities(ctx: Ctx, changes: Indexed<ActivityChange>[]) {
  const { tx, userId, now, out } = ctx;
  if (changes.length === 0) return;
  const ids = [...new Set(changes.map((c) => c.id))];
  const read = () =>
    tx
      .select({ id: activities.id, fields: activities.fieldsAt, removed: activities.removedAt })
      .from(activities)
      .where(and(eq(activities.userId, userId), inArray(activities.id, ids)));
  const block = (c: Extract<ActivityChange, { field: "fields" }>) => ({
    date: c.date,
    kind: c.type,
    durationMin: c.durationMin,
    cardioType: c.cardioType,
    climbStyle: c.climbStyle,
    climbRuns: c.climbRuns,
    climbGrade: c.climbGrade,
    climbColor: c.climbColor,
  });
  const kept = await createMissing(
    ctx,
    changes,
    new Set((await read()).map((r) => r.id)),
    (c) => c.field === "fields",
    (sp, c) =>
      c.field !== "fields"
        ? Promise.resolve([])
        : sp
            .insert(activities)
            .values({ id: c.id, userId, ...block(c), fieldsAt: new Date(clampAt(c.at, now)) })
            .onConflictDoNothing({ target: activities.id })
            .returning({ id: activities.id }),
  );
  const stored = new Map(
    (await read()).flatMap((r) => [
      [`${r.id}|fields`, iso(r.fields)],
      [`${r.id}|removed`, iso(r.removed)],
    ]),
  );
  const key = (c: ActivityChange) => `${c.id}|${c.field}`;
  for (const k of staleKeys(stored, kept, key, now)) out.activities.add(k.split("|")[0]!);
  await guarded(
    ctx,
    mergeFields(stored, kept, key, now),
    async (sp, batch) => {
      for (const c of batch)
        await sp
          .update(activities)
          .set({
            ...(c.field === "fields"
              ? { ...block(c), fieldsAt: new Date(c.at) }
              : { removed: c.value, removedAt: new Date(c.at) }),
            serverSeq: nextSeq,
            updatedAt: sql`now()`,
          })
          .where(and(eq(activities.id, c.id), eq(activities.userId, userId)));
    },
    (c) => out.activities.add(c.id),
  );
}

// Why a plan cannot be taken: a slot of an exercise the library lacks, or one counted in another
// measure than its exercise; null when every slot is right.
export function planProblem(
  plan: readonly { exerciseId: string; measure?: Slot["measure"] | null }[],
): Rejected["reason"] | null {
  for (const slot of plan) {
    const exercise = exerciseById(slot.exerciseId);
    if (!exercise) return "unknown_exercise";
    if ((slot.measure ?? "reps") !== exercise.measure) return "wrong_measure";
  }
  return null;
}

// A session's start (code, plan, start time) is its creation and is written once: a replay, or
// another start of the same id, changes nothing and gets the stored session back. Its other
// fields merge one by one: its own copy of the plan and its start time too, each a whole field.
// A plan naming an exercise the library lacks, counting one in the wrong measure, or shorter than
// the stored one, is refused.
async function writeWorkouts(ctx: Ctx, all: Indexed<WorkoutChange>[]) {
  const { tx, userId, now, out } = ctx;
  const problems = new Map<number, Rejected["reason"]>();
  for (const c of all) {
    const problem =
      c.field === "start" ? planProblem(c.plan) : c.field === "plan" ? planProblem(c.value) : null;
    if (problem) problems.set(c.index, problem);
  }
  // A slot is never taken out: a plan shorter than the stored one is refused, when it is the
  // newer one; an older one just loses on time, like any replayed change.
  const planned = [...new Set(all.filter((c) => c.field === "plan").map((c) => c.id))];
  if (planned.length > 0) {
    const lengths = new Map(
      (
        await tx
          .select({ id: workouts.id, plan: workouts.plan, planAt: workouts.planAt })
          .from(workouts)
          .where(and(eq(workouts.userId, userId), inArray(workouts.id, planned)))
      ).map((r) => [r.id, { length: r.plan.length, at: r.planAt }]),
    );
    for (const c of all) {
      const stored = c.field === "plan" ? lengths.get(c.id) : undefined;
      if (
        c.field === "plan" &&
        !problems.has(c.index) &&
        stored &&
        c.value.length < stored.length &&
        (!stored.at || Date.parse(clampAt(c.at, now)) > stored.at.getTime())
      )
        problems.set(c.index, "plan_shrank");
    }
  }
  for (const [index, reason] of problems) out.rejected.push({ index, reason });
  // A refused plan change: the stored session comes back, whatever the phone's cursor.
  for (const c of all) if (c.field === "plan" && problems.has(c.index)) out.workouts.add(c.id);
  const changes = all.filter((c) => !problems.has(c.index));
  if (changes.length === 0) return;
  const ids = [...new Set(changes.map((c) => c.id))];
  const read = () =>
    tx
      .select({
        id: workouts.id,
        plan: workouts.planAt,
        startedAt: workouts.startedAtAt,
        ended: workouts.endedAtAt,
        note: workouts.noteAt,
        exerciseNotes: workouts.exerciseNotesAt,
        removed: workouts.removedAt,
      })
      .from(workouts)
      .where(and(eq(workouts.userId, userId), inArray(workouts.id, ids)));
  const before = new Set((await read()).map((r) => r.id));
  const kept = await createMissing(
    ctx,
    changes,
    before,
    (c) => c.field === "start",
    (sp, c) =>
      c.field !== "start"
        ? Promise.resolve([])
        : sp
            .insert(workouts)
            .values({
              id: c.id,
              userId,
              sessionCode: c.sessionCode,
              // Written once with the start, never checked: a start is never refused for it, and
              // it is only read within this account.
              sessionId: c.sessionId ?? null,
              plan: c.plan,
              startedAt: new Date(clampWorkoutTime(c.startedAt, now)),
            })
            .onConflictDoNothing({ target: workouts.id })
            .returning({ id: workouts.id }),
  );
  for (const c of kept) if (c.field === "start" && before.has(c.id)) out.workouts.add(c.id);
  const fields = kept.filter(
    (c): c is Indexed<Exclude<WorkoutChange, { field: "start" }>> => c.field !== "start",
  );
  const stored = new Map(
    (await read()).flatMap((r) => [
      [`${r.id}|plan`, iso(r.plan)],
      [`${r.id}|startedAt`, iso(r.startedAt)],
      [`${r.id}|ended`, iso(r.ended)],
      [`${r.id}|note`, iso(r.note)],
      [`${r.id}|exerciseNotes`, iso(r.exerciseNotes)],
      [`${r.id}|removed`, iso(r.removed)],
    ]),
  );
  const key = (c: (typeof fields)[number]) => `${c.id}|${c.field}`;
  for (const k of staleKeys(stored, fields, key, now)) out.workouts.add(k.split("|")[0]!);
  await guarded(
    ctx,
    mergeFields(stored, fields, key, now),
    async (sp, batch) => {
      for (const c of batch) {
        const at = new Date(c.at);
        await sp
          .update(workouts)
          .set({
            ...(c.field === "plan"
              ? { plan: c.value, planAt: at }
              : c.field === "startedAt"
                ? { startedAt: new Date(clampWorkoutTime(c.value, now)), startedAtAt: at }
                : c.field === "ended"
                  ? {
                      endedAt: c.value === null ? null : new Date(clampWorkoutTime(c.value, now)),
                      endedAtAt: at,
                    }
                  : c.field === "note"
                    ? { note: c.value, noteAt: at }
                    : c.field === "exerciseNotes"
                      ? { exerciseNotes: c.value, exerciseNotesAt: at }
                      : { removed: c.value, removedAt: at }),
            serverSeq: nextSeq,
            updatedAt: sql`now()`,
          })
          .where(and(eq(workouts.id, c.id), eq(workouts.userId, userId)));
      }
    },
    (c) => out.workouts.add(c.id),
  );
}

// A set is created once with all its fields; its load, count and RIR then change together, and
// its removal on its own. It must name a session of this account and an exercise of the library,
// be counted in that exercise's measure (reps or seconds), and a session keeps 150 sets at most.
async function writeSets(ctx: Ctx, changes: Indexed<SetChange>[]) {
  const { tx, userId, now, out } = ctx;
  if (changes.length === 0) return;
  const sessions = [...new Set(changes.map((c) => c.workoutId))];
  const mine = new Set(
    (
      await tx
        .select({ id: workouts.id })
        .from(workouts)
        .where(and(eq(workouts.userId, userId), inArray(workouts.id, sessions)))
    ).map((r) => r.id),
  );
  unknown(
    out,
    changes.filter((c) => !mine.has(c.workoutId)),
  );
  const refuse = (c: Indexed<SetChange>, reason: Rejected["reason"]) =>
    out.rejected.push({ index: c.index, reason });
  const ids = [...new Set(changes.map((c) => c.id))];
  const read = () =>
    tx
      .select({
        id: workoutSets.id,
        exerciseId: workoutSets.exerciseId,
        values: workoutSets.fieldsAt,
        removed: workoutSets.removedAt,
        gone: workoutSets.removed,
      })
      .from(workoutSets)
      .where(and(eq(workoutSets.userId, userId), inArray(workoutSets.id, ids)));
  const storedSets = await read();
  const known = new Set(storedSets.map((r) => r.id));
  const gone = new Set(storedSets.filter((r) => r.gone).map((r) => r.id));
  // Each session's sets still in place, then the new ones one by one: past 150, refused, and
  // so is every other change of that set.
  const count = new Map(
    (
      await tx
        .select({ workoutId: workoutSets.workoutId, n: sql<number>`count(*)::int` })
        .from(workoutSets)
        .where(
          and(
            eq(workoutSets.userId, userId),
            inArray(workoutSets.workoutId, [...mine]),
            eq(workoutSets.removed, false),
          ),
        )
        .groupBy(workoutSets.workoutId)
    ).map((r) => [r.workoutId, r.n]),
  );
  const refused = new Map<string, Rejected["reason"]>();
  // The exercise of each set: the stored one, or the one its creation names.
  const exerciseOf = new Map(storedSets.map((r) => [r.id, r.exerciseId]));
  for (const c of changes)
    if (c.field === "create" && !exerciseOf.has(c.id)) exerciseOf.set(c.id, c.exerciseId);
  for (const c of changes) {
    if (c.field !== "create" && c.field !== "values") continue;
    const measure = exerciseById(exerciseOf.get(c.id) ?? "")?.measure;
    if (measure && (c.reps === null) !== (measure === "seconds"))
      refused.set(c.id, "wrong_measure");
  }
  for (const c of changes) {
    if (!mine.has(c.workoutId) || refused.has(c.id)) continue;
    // A removed set put back counts as a new live one.
    const restored = c.field === "removed" && !c.value && gone.has(c.id);
    if (!restored && (c.field !== "create" || known.has(c.id))) continue;
    if (c.field === "create" && !isKnownExercise(c.exerciseId))
      refused.set(c.id, "unknown_exercise");
    else if ((count.get(c.workoutId) ?? 0) >= MAX_SETS) refused.set(c.id, "too_many_sets");
    else count.set(c.workoutId, (count.get(c.workoutId) ?? 0) + 1);
  }
  const rest: Indexed<SetChange>[] = [];
  for (const c of changes) {
    if (!mine.has(c.workoutId)) continue;
    const reason = refused.get(c.id);
    if (reason) refuse(c, reason);
    else rest.push(c);
  }
  const kept = await createMissing(
    ctx,
    rest,
    known,
    (c) => c.field === "create",
    (sp, c) =>
      c.field !== "create"
        ? Promise.resolve([])
        : sp
            .insert(workoutSets)
            .values({
              id: c.id,
              userId,
              workoutId: c.workoutId,
              slotIndex: c.slotIndex,
              position: c.position,
              exerciseId: c.exerciseId,
              warmup: c.warmup,
              weightKg: c.weightKg,
              reps: c.reps,
              seconds: c.seconds ?? null,
              rir: c.rir,
              doneAt: new Date(clampWorkoutTime(c.doneAt, now)),
              fieldsAt: new Date(clampAt(c.at, now)),
            })
            .onConflictDoNothing({ target: workoutSets.id })
            .returning({ id: workoutSets.id }),
  );
  const fields = kept.filter(
    (c): c is Indexed<Exclude<SetChange, { field: "create" }>> => c.field !== "create",
  );
  const stored = new Map(
    (await read()).flatMap((r) => [
      [`${r.id}|values`, iso(r.values)],
      [`${r.id}|removed`, iso(r.removed)],
    ]),
  );
  const key = (c: (typeof fields)[number]) => `${c.id}|${c.field}`;
  for (const k of staleKeys(stored, fields, key, now)) out.sets.add(k.split("|")[0]!);
  await guarded(
    ctx,
    mergeFields(stored, fields, key, now),
    async (sp, batch) => {
      for (const c of batch)
        await sp
          .update(workoutSets)
          .set({
            ...(c.field === "values"
              ? {
                  weightKg: c.weightKg,
                  reps: c.reps,
                  seconds: c.seconds ?? null,
                  rir: c.rir,
                  fieldsAt: new Date(c.at),
                }
              : { removed: c.value, removedAt: new Date(c.at) }),
            serverSeq: nextSeq,
            updatedAt: sql`now()`,
          })
          .where(and(eq(workoutSets.id, c.id), eq(workoutSets.userId, userId)));
    },
    (c) => out.sets.add(c.id),
  );
}

// Every row a phone may receive, tagged with its table and sequence number.
type Item =
  | { seq: bigint; t: "body"; row: typeof bodyMetrics.$inferSelect }
  | { seq: bigint; t: "intake"; row: typeof intakeLogs.$inferSelect }
  | { seq: bigint; t: "supplement"; row: typeof supplements.$inferSelect }
  | { seq: bigint; t: "log"; row: typeof supplementLogs.$inferSelect }
  | { seq: bigint; t: "annotation"; row: typeof annotations.$inferSelect }
  | { seq: bigint; t: "steps"; row: typeof dailySteps.$inferSelect }
  | { seq: bigint; t: "activity"; row: typeof activities.$inferSelect }
  | { seq: bigint; t: "workout"; row: typeof workouts.$inferSelect }
  | { seq: bigint; t: "set"; row: typeof workoutSets.$inferSelect }
  | { seq: bigint; t: "program"; row: typeof programs.$inferSelect }
  | { seq: bigint; t: "pointer"; row: typeof activePrograms.$inferSelect }
  | { seq: bigint; t: "session"; row: typeof programSessions.$inferSelect }
  | { seq: bigint; t: "slot"; row: typeof programSlots.$inferSelect };
const tag =
  <T extends Item["t"]>(t: T) =>
  (row: Extract<Item, { t: T }>["row"]) =>
    ({ seq: row.serverSeq, t, row }) as Extract<Item, { t: T }>;

async function readSince(
  tx: Tx,
  userId: string,
  cursor: bigint,
  out: Outcome,
): Promise<SyncResponse> {
  // Each table's next page, one row more than a page: sorted by sequence, the first MAX_ROWS of
  // them all are the first MAX_ROWS of the person's rows past the cursor.
  const after = (t: { userId: PgColumn; serverSeq: PgColumn }) =>
    and(eq(t.userId, userId), gt(t.serverSeq, cursor));
  const limit = MAX_ROWS + 1;
  const items: Item[] = [
    ...(
      await tx
        .select()
        .from(bodyMetrics)
        .where(after(bodyMetrics))
        .orderBy(asc(bodyMetrics.serverSeq))
        .limit(limit)
    ).map(tag("body")),
    ...(
      await tx
        .select()
        .from(intakeLogs)
        .where(after(intakeLogs))
        .orderBy(asc(intakeLogs.serverSeq))
        .limit(limit)
    ).map(tag("intake")),
    ...(
      await tx
        .select()
        .from(supplements)
        .where(after(supplements))
        .orderBy(asc(supplements.serverSeq))
        .limit(limit)
    ).map(tag("supplement")),
    ...(
      await tx
        .select()
        .from(supplementLogs)
        .where(after(supplementLogs))
        .orderBy(asc(supplementLogs.serverSeq))
        .limit(limit)
    ).map(tag("log")),
    ...(
      await tx
        .select()
        .from(annotations)
        .where(after(annotations))
        .orderBy(asc(annotations.serverSeq))
        .limit(limit)
    ).map(tag("annotation")),
    ...(
      await tx
        .select()
        .from(dailySteps)
        .where(after(dailySteps))
        .orderBy(asc(dailySteps.serverSeq))
        .limit(limit)
    ).map(tag("steps")),
    ...(
      await tx
        .select()
        .from(activities)
        .where(after(activities))
        .orderBy(asc(activities.serverSeq))
        .limit(limit)
    ).map(tag("activity")),
    ...(
      await tx
        .select()
        .from(workouts)
        .where(after(workouts))
        .orderBy(asc(workouts.serverSeq))
        .limit(limit)
    ).map(tag("workout")),
    ...(
      await tx
        .select()
        .from(workoutSets)
        .where(after(workoutSets))
        .orderBy(asc(workoutSets.serverSeq))
        .limit(limit)
    ).map(tag("set")),
    ...(
      await tx
        .select()
        .from(programs)
        .where(after(programs))
        .orderBy(asc(programs.serverSeq))
        .limit(limit)
    ).map(tag("program")),
    ...(
      await tx
        .select()
        .from(activePrograms)
        .where(after(activePrograms))
        .orderBy(asc(activePrograms.serverSeq))
        .limit(limit)
    ).map(tag("pointer")),
    ...(
      await tx
        .select()
        .from(programSessions)
        .where(after(programSessions))
        .orderBy(asc(programSessions.serverSeq))
        .limit(limit)
    ).map(tag("session")),
    ...(
      await tx
        .select()
        .from(programSlots)
        .where(after(programSlots))
        .orderBy(asc(programSlots.serverSeq))
        .limit(limit)
    ).map(tag("slot")),
  ].sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
  const hasMore = items.length > MAX_ROWS;
  const sent = items.slice(0, MAX_ROWS);

  // The stored rows sent back whatever the cursor: a change lost against them, or was refused.
  const mine = (t: { userId: PgColumn }) => eq(t.userId, userId);
  const back: Item[] = [
    ...(out.days.size === 0
      ? []
      : await tx
          .select()
          .from(bodyMetrics)
          .where(and(mine(bodyMetrics), inArray(bodyMetrics.date, [...out.days])))
    ).map(tag("body")),
    ...(out.intake.size === 0
      ? []
      : await tx
          .select()
          .from(intakeLogs)
          .where(and(mine(intakeLogs), inArray(intakeLogs.date, [...out.intake])))
    ).map(tag("intake")),
    ...(out.supplements.size === 0
      ? []
      : await tx
          .select()
          .from(supplements)
          .where(and(mine(supplements), inArray(supplements.id, [...out.supplements])))
    ).map(tag("supplement")),
    ...(out.logs.size === 0
      ? []
      : await tx
          .select()
          .from(supplementLogs)
          .where(
            and(
              mine(supplementLogs),
              or(
                ...[...out.logs].map((k) => {
                  const [id, date] = k.split("|");
                  return and(eq(supplementLogs.supplementId, id!), eq(supplementLogs.date, date!));
                }),
              ),
            ),
          )
    ).map(tag("log")),
    ...(out.annotations.size === 0
      ? []
      : await tx
          .select()
          .from(annotations)
          .where(and(mine(annotations), inArray(annotations.id, [...out.annotations])))
    ).map(tag("annotation")),
    ...(out.steps.size === 0
      ? []
      : await tx
          .select()
          .from(dailySteps)
          .where(and(mine(dailySteps), inArray(dailySteps.date, [...out.steps])))
    ).map(tag("steps")),
    ...(out.activities.size === 0
      ? []
      : await tx
          .select()
          .from(activities)
          .where(and(mine(activities), inArray(activities.id, [...out.activities])))
    ).map(tag("activity")),
    ...(out.workouts.size === 0
      ? []
      : await tx
          .select()
          .from(workouts)
          .where(and(mine(workouts), inArray(workouts.id, [...out.workouts])))
    ).map(tag("workout")),
    ...(out.sets.size === 0
      ? []
      : await tx
          .select()
          .from(workoutSets)
          .where(and(mine(workoutSets), inArray(workoutSets.id, [...out.sets])))
    ).map(tag("set")),
    ...(out.programs.size === 0
      ? []
      : await tx
          .select()
          .from(programs)
          .where(and(mine(programs), inArray(programs.id, [...out.programs])))
    ).map(tag("program")),
    ...(!out.active ? [] : await tx.select().from(activePrograms).where(mine(activePrograms))).map(
      tag("pointer"),
    ),
    ...(out.sessions.size === 0
      ? []
      : await tx
          .select()
          .from(programSessions)
          .where(and(mine(programSessions), inArray(programSessions.id, [...out.sessions])))
    ).map(tag("session")),
    ...(out.slots.size === 0
      ? []
      : await tx
          .select()
          .from(programSlots)
          .where(and(mine(programSlots), inArray(programSlots.id, [...out.slots])))
    ).map(tag("slot")),
  ];

  const [me] = await tx.select().from(users).where(eq(users.id, userId));
  let next = sent.at(-1)?.seq ?? cursor;
  // While pages remain, the cursor stops at the last row sent: the range and profile come again.
  if (!hasMore && me && me.serverSeq > next) next = me.serverSeq;
  return {
    cursor: next.toString(),
    ...rowsOf([...sent, ...back]),
    ...userRows(me && (me.serverSeq > cursor || out.user) ? me : undefined),
    rejected: out.rejected,
    hasMore,
  };
}

// The answer's arrays, one entry per key: a row both past the cursor and sent back appears once.
function rowsOf(items: Item[]) {
  const weights = new Map<string, WeightRow>();
  const measures = new Map<string, MeasureRow>();
  const intake = new Map<string, IntakeRow>();
  const supplementRows = new Map<string, SupplementRow>();
  const logs = new Map<string, SupplementLogRow>();
  const annotationRows = new Map<string, AnnotationRow>();
  const workoutRows = new Map<string, WorkoutRow>();
  const setRows = new Map<string, SetRow>();
  const stepsRows = new Map<string, StepsRow>();
  const activityRows = new Map<string, ActivityRow>();
  const programRows = new Map<string, ProgramRow>();
  const sessionRows = new Map<string, ProgramSessionRow>();
  const slotRows = new Map<string, ProgramSlotRow>();
  let activeProgram: ActiveProgramRow | undefined;
  for (const item of items) {
    if (item.t === "program") {
      programRows.set(item.row.id, programRow(item.row));
      continue;
    }
    if (item.t === "pointer") {
      activeProgram = pointerRow(item.row);
      continue;
    }
    if (item.t === "session") {
      sessionRows.set(item.row.id, sessionRow(item.row));
      continue;
    }
    if (item.t === "slot") {
      slotRows.set(item.row.id, slotRow(item.row));
      continue;
    }
    if (item.t === "steps") {
      const r = item.row;
      stepsRows.set(r.date, { date: r.date, steps: r.steps, stepsAt: iso(r.stepsAt) });
      continue;
    }
    if (item.t === "activity") {
      const r = item.row;
      activityRows.set(r.id, {
        id: r.id,
        date: r.date,
        type: r.kind as ActivityRow["type"],
        durationMin: r.durationMin,
        cardioType: r.cardioType as ActivityRow["cardioType"],
        climbStyle: r.climbStyle as ActivityRow["climbStyle"],
        climbRuns: r.climbRuns,
        climbGrade: r.climbGrade,
        climbColor: r.climbColor as ActivityRow["climbColor"],
        fieldsAt: r.fieldsAt.toISOString(),
        removed: r.removed,
        removedAt: iso(r.removedAt),
      });
      continue;
    }
    if (item.t === "workout") {
      const r = item.row;
      workoutRows.set(r.id, {
        id: r.id,
        sessionCode: r.sessionCode,
        // Only when it recorded one: an older phone reads the row as before.
        ...(r.sessionId !== null && { sessionId: r.sessionId }),
        plan: r.plan,
        planAt: iso(r.planAt),
        startedAt: r.startedAt.toISOString(),
        startedAtAt: iso(r.startedAtAt),
        endedAt: iso(r.endedAt),
        endedAtAt: iso(r.endedAtAt),
        note: r.note,
        noteAt: iso(r.noteAt),
        exerciseNotes: r.exerciseNotes ?? {},
        exerciseNotesAt: iso(r.exerciseNotesAt),
        removed: r.removed,
        removedAt: iso(r.removedAt),
      });
      continue;
    }
    if (item.t === "set") {
      const r = item.row;
      setRows.set(r.id, {
        id: r.id,
        workoutId: r.workoutId,
        slotIndex: r.slotIndex,
        position: r.position,
        exerciseId: r.exerciseId,
        warmup: r.warmup,
        weightKg: r.weightKg,
        reps: r.reps,
        seconds: r.seconds,
        rir: r.rir,
        doneAt: r.doneAt.toISOString(),
        fieldsAt: r.fieldsAt.toISOString(),
        removed: r.removed,
        removedAt: iso(r.removedAt),
      });
      continue;
    }
    const { t, row: r } = item;
    if (t === "body") {
      // A day that holds no weight (never weighed, only measured) is not a weigh-in.
      if (r.weightAt)
        weights.set(r.date, { date: r.date, weightKg: r.weightKg, at: r.weightAt.toISOString() });
      if (r.waistAt || r.neckAt || r.hipAt)
        measures.set(r.date, {
          date: r.date,
          waistCm: r.waistCm,
          waistAt: iso(r.waistAt),
          neckCm: r.neckCm,
          neckAt: iso(r.neckAt),
          hipCm: r.hipCm,
          hipAt: iso(r.hipAt),
        });
    } else if (t === "intake") {
      intake.set(r.date, {
        date: r.date,
        kcal: r.kcal,
        kcalAt: iso(r.kcalAt),
        proteinG: r.proteinG,
        proteinAt: iso(r.proteinAt),
      });
    } else if (t === "supplement") {
      supplementRows.set(r.id, {
        id: r.id,
        name: r.name,
        nameAt: r.nameAt.toISOString(),
        kind: r.kind as SupplementRow["kind"],
        removed: r.removed,
        removedAt: iso(r.removedAt),
      });
    } else if (t === "log") {
      logs.set(`${r.supplementId}|${r.date}`, {
        supplementId: r.supplementId,
        date: r.date,
        taken: r.taken,
        at: r.takenAt.toISOString(),
      });
    } else {
      annotationRows.set(r.id, {
        id: r.id,
        date: r.date,
        type: r.kind as AnnotationRow["type"],
        label: r.label,
        fieldsAt: r.fieldsAt.toISOString(),
        removed: r.removed,
        removedAt: iso(r.removedAt),
      });
    }
  }
  return {
    weights: [...weights.values()],
    measures: [...measures.values()],
    intake: [...intake.values()],
    supplements: [...supplementRows.values()],
    supplementLogs: [...logs.values()],
    annotations: [...annotationRows.values()],
    steps: [...stepsRows.values()],
    activities: [...activityRows.values()],
    workouts: [...workoutRows.values()],
    sets: [...setRows.values()],
    // Only what there is to send: an answer with no program row reads as an older server's.
    ...(activeProgram && { activeProgram }),
    ...(programRows.size > 0 && { programs: [...programRows.values()] }),
    ...(sessionRows.size > 0 && { programSessions: [...sessionRows.values()] }),
    ...(slotRows.size > 0 && { programSlots: [...slotRows.values()] }),
  };
}

// The range and the profile, both on the person's row.
function userRows(me: typeof users.$inferSelect | undefined) {
  if (!me) return { target: null, profile: null };
  return {
    target: { minPct: me.targetMinPct, maxPct: me.targetMaxPct, at: iso(me.targetAt) },
    profile: {
      formula: me.formula as ProfileRow["formula"],
      formulaAt: iso(me.formulaAt),
      birthYear: me.birthYear,
      birthYearAt: iso(me.birthYearAt),
      heightCm: me.heightCm,
      heightAt: iso(me.heightAt),
    },
  };
}
