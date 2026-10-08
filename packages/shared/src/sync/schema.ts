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

export const ChangeSchema = z.discriminatedUnion("kind", [
  WeightChangeSchema,
  TargetChangeSchema,
  MeasureChangeSchema,
  IntakeChangeSchema,
  ProfileChangeSchema,
  SupplementChangeSchema,
  SupplementLogChangeSchema,
  AnnotationChangeSchema,
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

// A change the server could not take although its shape is valid: its place in the request, and
// why. The phone drops it from its queue and keeps a trace the person can read.
export const RejectedSchema = z.object({
  index: z.int().check(z.minimum(0)),
  reason: z.enum(["unknown", "refused"]), // unknown: it names something the account does not have
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
export type Rejected = z.infer<typeof RejectedSchema>;
export type SyncResponse = z.infer<typeof SyncResponseSchema>;
