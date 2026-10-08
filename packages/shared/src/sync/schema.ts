// The POST /api/sync contract, read by the phone and the server alike. Zod Mini: the phone loads
// it at startup, and the full Zod build would take half of the initial-bundle headroom.
import * as z from "zod/mini";
import { isTargetRange } from "../body/target";
import { isWeighingKg, MIN_WEIGH_IN_DATE } from "../body/weighings";
import { MAX_CHANGES } from "./limits";

const isoDate = z.iso.date();
// A weigh-in is never older than the floor (see MIN_WEIGH_IN_DATE).
const weighInDate = z.iso.date().check(z.refine((d) => d >= MIN_WEIGH_IN_DATE));
// UTC with a Z, as Date#toISOString() writes it.
const isoDateTime = z.iso.datetime();
// null deletes the weigh-in of that day (a tombstone the other devices learn from).
const weightKg = z.nullable(z.number().check(z.refine(isWeighingKg)));
// The server's sequence as text, "0" at first; 18 digits at most stays inside a bigint.
const cursor = z.string().check(z.regex(/^(0|[1-9]\d{0,17})$/));

export const WeightChangeSchema = z.object({
  kind: z.literal("weight"),
  date: weighInDate,
  weightKg,
  at: isoDateTime,
});
// Both bounds travel together under one timestamp: they constrain each other.
export const TargetChangeSchema = z
  .object({ kind: z.literal("target"), minPct: z.number(), maxPct: z.number(), at: isoDateTime })
  .check(z.refine(isTargetRange));
export const ChangeSchema = z.discriminatedUnion("kind", [WeightChangeSchema, TargetChangeSchema]);

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
  at: z.nullable(isoDateTime), // null: the defaults, never written
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
  target: z.nullable(TargetRowSchema), // when written since that cursor, or sent back as above
  rejected: z.array(RejectedSchema),
  hasMore: z.boolean(), // more than MAX_ROWS rows were waiting: call again
});

export type WeightChange = z.infer<typeof WeightChangeSchema>;
export type TargetChange = z.infer<typeof TargetChangeSchema>;
export type Change = z.infer<typeof ChangeSchema>;
export type SyncRequest = z.infer<typeof SyncRequestSchema>;
export type WeightRow = z.infer<typeof WeightRowSchema>;
export type TargetRow = z.infer<typeof TargetRowSchema>;
export type Rejected = z.infer<typeof RejectedSchema>;
export type SyncResponse = z.infer<typeof SyncResponseSchema>;
