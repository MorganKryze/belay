// The POST /api/sync contract, read by the phone and the server alike. Zod Mini: the phone loads
// it at startup, and the full Zod build would take half of the initial-bundle headroom.
import * as z from "zod/mini";
import { isAnnotationLabel } from "../body/annotations";
import { isKcal, isProteinG } from "../body/intake";
import { isMeasureCm } from "../body/measures";
import { isProfileHeight } from "../body/profile";
import { isSupplementName } from "../body/supplements";
import { isTargetRange } from "../body/target";
import { isWeighingKg, MIN_WEIGH_IN_DATE } from "../body/weighings";
import { EXERCISE_ID } from "../exercises/library";
import {
  ACTIVITY_KINDS,
  CARDIO_TYPES,
  CLIMB_COLORS,
  CLIMB_STYLES,
  isActivityFields,
  isSteps,
} from "../training/activities";
import {
  isExerciseNotes,
  isNote,
  isPlan,
  isReps,
  isRir,
  isSeconds,
  isSessionCode,
  isSetKg,
  MAX_POSITION,
  MAX_SLOTS,
  MIN_TIME,
  type Slot,
} from "../training/workout";
import { MAX_CHANGES } from "./limits";

const isoDate = z.iso.date();
// No entry is dated before the floor (see MIN_WEIGH_IN_DATE).
const weighInDate = z.iso.date().check(z.refine((d) => d >= MIN_WEIGH_IN_DATE));
// UTC with a Z, as Date#toISOString() writes it.
const isoDateTime = z.iso.datetime();
const at = isoDateTime;
// When a field was written; null: never.
const writtenAt = z.nullable(isoDateTime);
// null deletes the weigh-in of that day (a tombstone the other devices learn from).
const weightKg = z.nullable(z.number().check(z.refine(isWeighingKg)));
// The server's sequence as text, "0" at first; 18 digits at most stays inside a bigint.
const cursor = z.string().check(z.regex(/^(0|[1-9]\d{0,17})$/));
const formula = z.enum(["female", "male"]);
const annotationType = z.enum(["deload", "diet_break", "note"]);
const label = z.nullable(z.string().check(z.refine(isAnnotationLabel)));
const name = z.string().check(z.refine(isSupplementName));
// The server's own year, give or take one: a phone checks the exact range against its own date
// (see valid.ts), and the year may turn between its check and this one.
const birthYear = z.int().check(
  z.refine((y) => {
    const year = new Date().getUTCFullYear();
    return y >= year - 101 && y <= year - 14;
  }),
);

export const WeightChangeSchema = z.object({
  kind: z.literal("weight"),
  date: weighInDate,
  weightKg,
  at,
});
// Both bounds travel together under one timestamp: they constrain each other.
export const TargetChangeSchema = z
  .object({ kind: z.literal("target"), minPct: z.number(), maxPct: z.number(), at })
  .check(z.refine(isTargetRange));
// One measurement of one day; null deletes it.
export const MeasureChangeSchema = z
  .object({
    kind: z.literal("measure"),
    date: weighInDate,
    field: z.enum(["waist", "neck", "hip"]),
    value: z.nullable(z.number()),
    at,
  })
  .check(z.refine((c) => c.value === null || isMeasureCm(c.field, c.value)));
// One value of a day's intake; null deletes it.
export const IntakeChangeSchema = z
  .object({
    kind: z.literal("intake"),
    date: weighInDate,
    field: z.enum(["kcal", "protein"]),
    value: z.nullable(z.number()),
    at,
  })
  .check(z.refine((c) => c.value === null || (c.field === "kcal" ? isKcal : isProteinG)(c.value)));
// One fact of the profile; null clears it (« Effacer »).
export const ProfileChangeSchema = z.discriminatedUnion("field", [
  z.object({
    kind: z.literal("profile"),
    field: z.literal("formula"),
    value: z.nullable(formula),
    at,
  }),
  z.object({
    kind: z.literal("profile"),
    field: z.literal("birthYear"),
    value: z.nullable(birthYear),
    at,
  }),
  z.object({
    kind: z.literal("profile"),
    field: z.literal("height"),
    value: z.nullable(z.int().check(z.refine(isProfileHeight))),
    at,
  }),
]);
// A supplement of the person's list, by the id the phone gave it: its name, or its removal.
export const SupplementChangeSchema = z.discriminatedUnion("field", [
  z.object({
    kind: z.literal("supplement"),
    id: z.uuid(),
    field: z.literal("name"),
    value: name,
    at,
  }),
  z.object({
    kind: z.literal("supplement"),
    id: z.uuid(),
    field: z.literal("removed"),
    value: z.boolean(),
    at,
  }),
]);
// A box of the day ticked, or unticked.
export const SupplementLogChangeSchema = z.object({
  kind: z.literal("supplementLog"),
  supplementId: z.uuid(),
  date: weighInDate,
  taken: z.boolean(),
  at,
});
// An annotation: its day, type and text travel together (one block), its removal on its own.
export const AnnotationChangeSchema = z.discriminatedUnion("field", [
  z.object({
    kind: z.literal("annotation"),
    id: z.uuid(),
    field: z.literal("fields"),
    date: weighInDate,
    type: annotationType,
    label,
    at,
  }),
  z.object({
    kind: z.literal("annotation"),
    id: z.uuid(),
    field: z.literal("removed"),
    value: z.boolean(),
    at,
  }),
]);

// The day's steps; null deletes them.
export const StepsChangeSchema = z.object({
  kind: z.literal("steps"),
  date: weighInDate,
  value: z.nullable(z.int().check(z.refine(isSteps))),
  at,
});
const activityType = z.enum(ACTIVITY_KINDS);
// An activity: its day, type and fields travel together (one block), its removal on its own.
export const ActivityChangeSchema = z.discriminatedUnion("field", [
  z
    .object({
      kind: z.literal("activity"),
      id: z.uuid(),
      field: z.literal("fields"),
      date: weighInDate,
      type: activityType,
      durationMin: z.int(),
      cardioType: z.nullable(z.enum(CARDIO_TYPES)),
      climbStyle: z.nullable(z.enum(CLIMB_STYLES)),
      climbRuns: z.nullable(z.int()),
      climbGrade: z.nullable(z.string()),
      climbColor: z.nullable(z.enum(CLIMB_COLORS)),
      at,
    })
    .check(z.refine((c) => isActivityFields({ ...c, kind: c.type }))),
  z.object({
    kind: z.literal("activity"),
    id: z.uuid(),
    field: z.literal("removed"),
    value: z.boolean(),
    at,
  }),
]);

// A session's times: from 1900 on. One more than 5 minutes ahead of the server's clock is brought
// back to it when written (apps/server/src/api/sync.ts), never refused: a phone whose clock runs
// ahead would otherwise lose a whole session.
const workoutTime = isoDateTime.check(z.refine((t) => t >= MIN_TIME));
const note = z.string().check(z.refine(isNote));
// The plan is checked by the same rules as on the phone (bounds of every slot, 16 KiB).
const plan = z.custom<Slot[]>(isPlan);
const exerciseNotes = z.custom<Record<string, string>>(isExerciseNotes);
const setKg = z.number().check(z.refine(isSetKg));
const reps = z.nullable(z.int().check(z.refine(isReps)));
// Absent from a set queued before timed sets existed: counted in reps.
const seconds = z.optional(z.nullable(z.int().check(z.refine(isSeconds))));
const rir = z.nullable(z.int().check(z.refine(isRir)));
// A set counts repetitions or seconds, never both, never neither.
const oneMeasure = (c: { reps: number | null; seconds?: number | null }) =>
  (c.reps === null) !== ((c.seconds ?? null) === null);

// A session: its code, plan and start travel together and are written once (a replay, or a
// second start of the same id, changes nothing); every other field is merged on its own. The
// session's copy of the plan (an exercise replaced, a slot skipped or added) and its start time
// (a session corrected afterwards) change later as whole fields: the last write wins.
export const WorkoutChangeSchema = z.discriminatedUnion("field", [
  z.object({
    kind: z.literal("workout"),
    id: z.uuid(),
    field: z.literal("start"),
    sessionCode: z.string().check(z.refine(isSessionCode)),
    plan,
    startedAt: workoutTime,
    at,
  }),
  z.object({
    kind: z.literal("workout"),
    id: z.uuid(),
    field: z.literal("plan"),
    value: plan,
    at,
  }),
  z.object({
    kind: z.literal("workout"),
    id: z.uuid(),
    field: z.literal("startedAt"),
    value: workoutTime,
    at,
  }),
  z.object({
    kind: z.literal("workout"),
    id: z.uuid(),
    field: z.literal("ended"),
    value: z.nullable(workoutTime),
    at,
  }),
  z.object({
    kind: z.literal("workout"),
    id: z.uuid(),
    field: z.literal("note"),
    value: z.nullable(note),
    at,
  }),
  z.object({
    kind: z.literal("workout"),
    id: z.uuid(),
    field: z.literal("exerciseNotes"),
    value: exerciseNotes,
    at,
  }),
  z.object({
    kind: z.literal("workout"),
    id: z.uuid(),
    field: z.literal("removed"),
    value: z.boolean(),
    at,
  }),
]);
// A set: created once with everything; then its load, count (reps or seconds) and RIR change
// together, or it goes.
export const SetChangeSchema = z.discriminatedUnion("field", [
  z
    .object({
      kind: z.literal("set"),
      id: z.uuid(),
      workoutId: z.uuid(),
      field: z.literal("create"),
      slotIndex: z.int().check(z.minimum(0), z.maximum(MAX_SLOTS - 1)),
      position: z.int().check(z.minimum(0), z.maximum(MAX_POSITION)),
      exerciseId: z.string().check(z.regex(EXERCISE_ID)),
      warmup: z.boolean(),
      weightKg: setKg,
      reps,
      seconds,
      rir,
      doneAt: workoutTime,
      at,
    })
    .check(z.refine(oneMeasure)),
  z
    .object({
      kind: z.literal("set"),
      id: z.uuid(),
      workoutId: z.uuid(),
      field: z.literal("values"),
      weightKg: setKg,
      reps,
      seconds,
      rir,
      at,
    })
    .check(z.refine(oneMeasure)),
  z.object({
    kind: z.literal("set"),
    id: z.uuid(),
    workoutId: z.uuid(),
    field: z.literal("removed"),
    value: z.boolean(),
    at,
  }),
]);

export const ChangeSchema = z.discriminatedUnion("kind", [
  WeightChangeSchema,
  TargetChangeSchema,
  MeasureChangeSchema,
  IntakeChangeSchema,
  ProfileChangeSchema,
  SupplementChangeSchema,
  SupplementLogChangeSchema,
  AnnotationChangeSchema,
  StepsChangeSchema,
  ActivityChangeSchema,
  WorkoutChangeSchema,
  SetChangeSchema,
]);

export const SyncRequestSchema = z.object({
  // The account whose queue this is. The server refuses it under any other session: a queue
  // never lands in another account, even when someone else signed in on this browser meanwhile.
  account: z.uuid(),
  cursor,
  changes: z.array(ChangeSchema).check(z.maxLength(MAX_CHANGES)),
});

export const WeightRowSchema = z.object({ date: isoDate, weightKg, at: isoDateTime });
export const TargetRowSchema = z.object({
  minPct: z.number(),
  maxPct: z.number(),
  at: writtenAt, // null: the defaults, never written
});
// Every field with its own time, null when it was never written.
export const MeasureRowSchema = z.object({
  date: isoDate,
  waistCm: z.nullable(z.number()),
  waistAt: writtenAt,
  neckCm: z.nullable(z.number()),
  neckAt: writtenAt,
  hipCm: z.nullable(z.number()),
  hipAt: writtenAt,
});
export const IntakeRowSchema = z.object({
  date: isoDate,
  kcal: z.nullable(z.number()),
  kcalAt: writtenAt,
  proteinG: z.nullable(z.number()),
  proteinAt: writtenAt,
});
export const ProfileRowSchema = z.object({
  formula: z.nullable(formula),
  formulaAt: writtenAt,
  birthYear: z.nullable(z.number()),
  birthYearAt: writtenAt,
  heightCm: z.nullable(z.number()),
  heightAt: writtenAt,
});
export const SupplementRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  nameAt: isoDateTime,
  kind: z.enum(["creatine", "other"]),
  removed: z.boolean(),
  removedAt: writtenAt,
});
export const SupplementLogRowSchema = z.object({
  supplementId: z.uuid(),
  date: isoDate,
  taken: z.boolean(),
  at: isoDateTime,
});
export const AnnotationRowSchema = z.object({
  id: z.uuid(),
  date: isoDate,
  type: annotationType,
  label: z.nullable(z.string()),
  fieldsAt: isoDateTime,
  removed: z.boolean(),
  removedAt: writtenAt,
});

export const StepsRowSchema = z.object({
  date: isoDate,
  steps: z.nullable(z.number()),
  stepsAt: writtenAt,
});
export const ActivityRowSchema = z.object({
  id: z.uuid(),
  date: isoDate,
  type: activityType,
  durationMin: z.number(),
  cardioType: z.nullable(z.enum(CARDIO_TYPES)),
  climbStyle: z.nullable(z.enum(CLIMB_STYLES)),
  climbRuns: z.nullable(z.number()),
  climbGrade: z.nullable(z.string()),
  climbColor: z.nullable(z.enum(CLIMB_COLORS)),
  fieldsAt: isoDateTime,
  removed: z.boolean(),
  removedAt: writtenAt,
});

// Every field with its own time (null: never written); exerciseNotes is {} when never written.
// The plan and the start were written with the start, and planAt and startedAtAt stay null
// until the session changes them.
export const WorkoutRowSchema = z.object({
  id: z.uuid(),
  sessionCode: z.string(),
  plan: z.custom<Slot[]>((v) => Array.isArray(v)),
  planAt: writtenAt,
  startedAt: isoDateTime,
  startedAtAt: writtenAt,
  endedAt: z.nullable(isoDateTime),
  endedAtAt: writtenAt,
  note: z.nullable(z.string()),
  noteAt: writtenAt,
  exerciseNotes: z.record(z.string(), z.string()),
  exerciseNotesAt: writtenAt,
  removed: z.boolean(),
  removedAt: writtenAt,
});
export const SetRowSchema = z.object({
  id: z.uuid(),
  workoutId: z.uuid(),
  slotIndex: z.int(),
  position: z.int(),
  exerciseId: z.string(),
  warmup: z.boolean(),
  weightKg: z.number(),
  reps: z.nullable(z.int()),
  seconds: z.nullable(z.int()),
  rir: z.nullable(z.int()),
  doneAt: isoDateTime,
  fieldsAt: isoDateTime,
  removed: z.boolean(),
  removedAt: writtenAt,
});

// A change the server could not take although its shape is valid: its place in the request, and
// why. The phone drops it from its queue and keeps a trace the person can read.
export const RejectedSchema = z.object({
  index: z.int().check(z.minimum(0)),
  // unknown: it names something the account does not have; unknown_exercise: a set, or a slot
  // of a plan, of an exercise the library lacks; too_many_sets: a session past 150 sets;
  // wrong_measure: reps for an exercise counted in seconds, or the other way round;
  // plan_shrank: a plan shorter than the stored one (a slot is never taken out).
  reason: z.enum([
    "unknown",
    "refused",
    "unknown_exercise",
    "too_many_sets",
    "wrong_measure",
    "plan_shrank",
  ]),
});

export const SyncResponseSchema = z.object({
  cursor,
  // Rows written since the cursor received, plus the stored row of every change that lost
  // against a later write or was refused, so the phone converges whatever its cursor.
  weights: z.array(WeightRowSchema),
  measures: z.array(MeasureRowSchema),
  intake: z.array(IntakeRowSchema),
  supplements: z.array(SupplementRowSchema),
  supplementLogs: z.array(SupplementLogRowSchema),
  annotations: z.array(AnnotationRowSchema),
  steps: z.array(StepsRowSchema),
  activities: z.array(ActivityRowSchema),
  workouts: z.array(WorkoutRowSchema),
  sets: z.array(SetRowSchema),
  target: z.nullable(TargetRowSchema), // when written since that cursor, or sent back as above
  profile: z.nullable(ProfileRowSchema), // likewise
  rejected: z.array(RejectedSchema),
  hasMore: z.boolean(), // more than MAX_ROWS rows were waiting: call again
});

export type WeightChange = z.infer<typeof WeightChangeSchema>;
export type TargetChange = z.infer<typeof TargetChangeSchema>;
export type MeasureChange = z.infer<typeof MeasureChangeSchema>;
export type IntakeChange = z.infer<typeof IntakeChangeSchema>;
export type ProfileChange = z.infer<typeof ProfileChangeSchema>;
export type SupplementChange = z.infer<typeof SupplementChangeSchema>;
export type SupplementLogChange = z.infer<typeof SupplementLogChangeSchema>;
export type AnnotationChange = z.infer<typeof AnnotationChangeSchema>;
export type StepsChange = z.infer<typeof StepsChangeSchema>;
export type ActivityChange = z.infer<typeof ActivityChangeSchema>;
export type WorkoutChange = z.infer<typeof WorkoutChangeSchema>;
export type SetChange = z.infer<typeof SetChangeSchema>;
export type Change = z.infer<typeof ChangeSchema>;
export type SyncRequest = z.infer<typeof SyncRequestSchema>;
export type WeightRow = z.infer<typeof WeightRowSchema>;
export type TargetRow = z.infer<typeof TargetRowSchema>;
export type MeasureRow = z.infer<typeof MeasureRowSchema>;
export type IntakeRow = z.infer<typeof IntakeRowSchema>;
export type ProfileRow = z.infer<typeof ProfileRowSchema>;
export type SupplementRow = z.infer<typeof SupplementRowSchema>;
export type SupplementLogRow = z.infer<typeof SupplementLogRowSchema>;
export type AnnotationRow = z.infer<typeof AnnotationRowSchema>;
export type StepsRow = z.infer<typeof StepsRowSchema>;
export type ActivityRow = z.infer<typeof ActivityRowSchema>;
export type WorkoutRow = z.infer<typeof WorkoutRowSchema>;
export type SetRow = z.infer<typeof SetRowSchema>;
export type Rejected = z.infer<typeof RejectedSchema>;
export type SyncResponse = z.infer<typeof SyncResponseSchema>;
