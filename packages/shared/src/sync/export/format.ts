// The file a person keeps of their records and gives back to any Belay app: the sync contract's
// rows, with their tombstones and field times, in an envelope saying where they come from.
import * as z from "zod/mini";
import {
  ActiveProgramRowSchema,
  ActivityRowSchema,
  AnnotationRowSchema,
  ChangeSchema,
  IntakeRowSchema,
  MeasureRowSchema,
  ProfileRowSchema,
  ProgramRowSchema,
  ProgramSessionRowSchema,
  ProgramSlotRowSchema,
  SetRowSchema,
  StepsRowSchema,
  SupplementLogRowSchema,
  SupplementRowSchema,
  TargetRowSchema,
  WeightRowSchema,
  WorkoutRowSchema,
} from "../schema";
import { CLOCK_SLACK_MS } from "../../training/workout";
import type { Change } from "../schema";
import { isValidChange } from "../valid";
import { changesFromRows, type ExportRows } from "./changes";

export const EXPORT_FORMAT = "belay-export";
export const EXPORT_VERSION = 1;

// As Date#toISOString() writes it, milliseconds included: the contract takes no other form.
const isoDateTime = z.iso.datetime().check(z.refine((t) => new Date(t).toISOString() === t));

export const ExportRowsSchema = z.object({
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
  programs: z.array(ProgramRowSchema),
  programSessions: z.array(ProgramSessionRowSchema),
  programSlots: z.array(ProgramSlotRowSchema),
  activeProgram: z.nullable(ActiveProgramRowSchema),
  target: z.nullable(TargetRowSchema),
  profile: z.nullable(ProfileRowSchema),
  // The effort felt per session, kept by the iPhone only: no write time of its own.
  efforts: z.optional(z.array(z.object({ workoutId: z.uuid(), floor: z.nullable(z.number()) }))),
});

export const ExportFileSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  // Every version up to this app's: each is read through the one path there is today.
  version: z.int().check(z.minimum(1), z.maximum(EXPORT_VERSION)),
  exportedAt: isoDateTime,
  app: z.object({ platform: z.enum(["ios", "android", "web"]), version: z.string() }),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("instance"), origin: z.string(), account: z.uuid() }),
    z.object({ kind: z.literal("local"), id: z.uuid() }),
  ]),
  // The last complete sync; null: never, or local mode.
  lastSync: z.nullable(isoDateTime),
  rows: ExportRowsSchema,
});

export type ExportFile = z.infer<typeof ExportFileSchema>;
export type ReadExport =
  | { ok: true; file: ExportFile }
  | { ok: false; reason: "not_belay" | "later_version" | "refused"; kind?: string; date?: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// The day a row belongs to, as the person reads it: its own, or its session's for a set.
function dayOf(rows: Record<string, unknown>, row: unknown): string | undefined {
  if (!isRecord(row)) return undefined;
  if (typeof row.date === "string") return row.date;
  if (typeof row.startedAt === "string") return row.startedAt.slice(0, 10);
  const workouts = Array.isArray(rows.workouts) ? rows.workouts : [];
  const session: unknown = workouts.find((w) => isRecord(w) && w.id === row.workoutId);
  return isRecord(session) && typeof session.startedAt === "string"
    ? session.startedAt.slice(0, 10)
    : undefined;
}

function refused(rows: Record<string, unknown>, kind: string, row: unknown): ReadExport {
  const date = dayOf(rows, row);
  return { ok: false, reason: "refused", kind, ...(date !== undefined && { date }) };
}

// The server keeps a session's times up to its clock slack ahead of now, while it brings write
// times back to now: a row it sends may hold a start, an end or a set's time a little after its
// write time. Checked as if at that write time, the change itself unaltered.
function asChecked(c: Change): Change {
  const near = (time: string | null) =>
    time !== null && time > c.at && Date.parse(time) <= Date.parse(c.at) + CLOCK_SLACK_MS
      ? c.at
      : time;
  if (c.kind === "workout" && c.field === "start") return { ...c, startedAt: near(c.startedAt)! };
  if (c.kind === "workout" && (c.field === "startedAt" || c.field === "ended"))
    return { ...c, value: near(c.value)! };
  if (c.kind === "set" && c.field === "create") return { ...c, doneAt: near(c.doneAt)! };
  return c;
}

// The whole file is checked before anything is written: a Belay export, of a version this app
// reads, every row in its shape, then every change it gives taken by the contract.
export function readExportFile(text: string): ReadExport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not_belay" };
  }
  if (
    !isRecord(data) ||
    data.format !== EXPORT_FORMAT ||
    !Number.isInteger(data.version) ||
    (data.version as number) < 1
  )
    return { ok: false, reason: "not_belay" };
  if ((data.version as number) > EXPORT_VERSION) return { ok: false, reason: "later_version" };
  const parsed = ExportFileSchema.safeParse(data);
  if (!parsed.success) {
    const [where, kind, index] = parsed.error.issues[0]!.path;
    if (where !== "rows" || typeof kind !== "string" || !isRecord(data.rows))
      return { ok: false, reason: "not_belay" };
    const list = data.rows[kind];
    return refused(data.rows, kind, typeof index === "number" ? (list as unknown[])[index] : list);
  }
  const file = parsed.data;
  const rows = file.rows as ExportRows & Record<string, unknown>;
  for (const kind of Object.keys(ExportRowsSchema.def.shape)) {
    if (kind === "efforts") continue;
    const value = rows[kind];
    for (const row of Array.isArray(value) ? value : value ? [value] : []) {
      const one: Record<string, unknown> = {
        ...Object.fromEntries(
          Object.entries(rows).map(([k, v]) => [k, Array.isArray(v) ? [] : null]),
        ),
        [kind]: Array.isArray(value) ? [row] : row,
      };
      const changes = changesFromRows(one as ExportRows, file.exportedAt);
      if (!changes.every((c) => ChangeSchema.safeParse(c).success && isValidChange(asChecked(c))))
        return refused(rows, kind, row);
    }
  }
  return { ok: true, file };
}

// « Belay — tes données — 26 nov. 2026.json »: the date as the app writes it, in its language.
// The extension lets the share sheet, the save picker and the import filter know the file.
export function exportFileName(date: Date, lang: "fr" | "en"): string {
  const day = new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  return lang === "fr" ? `Belay — tes données — ${day}.json` : `Belay — your data — ${day}.json`;
}
