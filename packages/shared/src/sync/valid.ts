import { isAnnotationLabel } from "../body/annotations";
import type { ISODate } from "../body/dates";
import { isKcal, isProteinG } from "../body/intake";
import { isMeasureCm } from "../body/measures";
import { isBirthYear, isProfileHeight } from "../body/profile";
import { isSupplementName } from "../body/supplements";
import { isTargetRange } from "../body/target";
import { isWeighingKg, MIN_WEIGH_IN_DATE } from "../body/weighings";
import { isExerciseId } from "../exercises/library";
import { isActivityFields, isSteps } from "../training/activities";
import {
  isPosition,
  isProgramName,
  isProgramSlot,
  isSchedule,
  isSessionName,
  isSlotValue,
  SLOT_FIELDS,
} from "../training/stored-program";
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
  MAX_WARMUPS,
  MIN_TIME,
} from "../training/workout";
import type { Change, WeightChange } from "./schema";

// The phone's own check before a change enters its queue, without Zod: this runs in the initial
// bundle. Stricter than ChangeSchema (a subset of what the server accepts), so a queued change
// is never refused for its shape, which would block the whole queue.
const isISODate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  s >= MIN_WEIGH_IN_DATE &&
  new Date(`${s}T00:00:00.000Z`).toISOString().startsWith(s);
const isISOTime = (s: string) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString() === s;
// Lower case, as the phone writes ids (UUID v7), and inside what z.uuid() accepts.
const isId = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
const isNullOr = <T>(value: T | null, ok: (v: T) => boolean) => value === null || ok(value);
const isInt = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
// A session's time is never before 1900, nor after the time of its change (the phone's clock).
const isTimeOf = (time: string, at: string) => isISOTime(time) && time >= MIN_TIME && time <= at;
// Reps or seconds, never both, and a timed set has no RIR. No seconds at all is a set in reps,
// as every set was before timed ones.
const isLoad = (c: {
  weightKg: number;
  reps: number | null;
  seconds?: number | null;
  rir: number | null;
}) =>
  isSetKg(c.weightKg) &&
  isRir(c.rir) &&
  (c.seconds == null
    ? c.reps !== null && isReps(c.reps)
    : c.reps === null && isSeconds(c.seconds) && c.rir === null);

// A session's place: a program, or none (set aside), and its position there.
const isPlace = (c: { programId: string | null; position: number }) =>
  isNullOr(c.programId, isId) && isPosition(c.position);
const isBool = (v: unknown) => typeof v === "boolean";
// null: counted in repetitions.
const isMeasure = (v: unknown): v is "seconds" | null => v === null || v === "seconds";

export function isValidChange(change: Change): boolean {
  if (!isISOTime(change.at)) return false;
  switch (change.kind) {
    case "weight":
      return isISODate(change.date) && isNullOr(change.weightKg, isWeighingKg);
    case "target":
      return isTargetRange(change);
    case "measure":
      return (
        isISODate(change.date) &&
        ["waist", "neck", "hip"].includes(change.field) &&
        isNullOr(change.value, (v) => isMeasureCm(change.field, v))
      );
    case "intake":
      return (
        isISODate(change.date) &&
        ["kcal", "protein"].includes(change.field) &&
        isNullOr(change.value, change.field === "kcal" ? isKcal : isProteinG)
      );
    case "profile":
      // The birth year against the year of the change: the server allows one year either way.
      return change.field === "formula"
        ? isNullOr(change.value, (v) => v === "female" || v === "male")
        : change.field === "birthYear"
          ? isNullOr(change.value, (v) => isBirthYear(v, change.at.slice(0, 10)))
          : change.field === "height" && isNullOr(change.value, isProfileHeight);
    case "supplement":
      return (
        isId(change.id) &&
        (change.field === "name"
          ? typeof change.value === "string" &&
            isSupplementName(change.value) &&
            change.value === change.value.trim()
          : change.field === "removed" && typeof change.value === "boolean")
      );
    case "supplementLog":
      return (
        isId(change.supplementId) && isISODate(change.date) && typeof change.taken === "boolean"
      );
    case "annotation":
      return (
        isId(change.id) &&
        (change.field === "fields"
          ? isISODate(change.date) &&
            ["deload", "diet_break", "note"].includes(change.type) &&
            (change.label === null || typeof change.label === "string") &&
            isAnnotationLabel(change.label)
          : change.field === "removed" && typeof change.value === "boolean")
      );
    case "steps":
      return isISODate(change.date) && isNullOr(change.value, isSteps);
    case "activity":
      return (
        isId(change.id) &&
        (change.field === "fields"
          ? isISODate(change.date) && isActivityFields({ ...change, kind: change.type })
          : change.field === "removed" && typeof change.value === "boolean")
      );
    case "workout":
      if (!isId(change.id)) return false;
      switch (change.field) {
        case "start":
          return (
            isSessionCode(change.sessionCode) &&
            (change.sessionId == null || isId(change.sessionId)) &&
            isPlan(change.plan) &&
            isTimeOf(change.startedAt, change.at)
          );
        case "plan":
          return isPlan(change.value);
        case "startedAt":
          return isTimeOf(change.value, change.at);
        case "ended":
          return change.value === null || isTimeOf(change.value, change.at);
        case "note":
          return change.value === null || (isNote(change.value) && change.value.trim() !== "");
        case "exerciseNotes":
          return isExerciseNotes(change.value);
        case "removed":
          return typeof change.value === "boolean";
        default:
          return false;
      }
    case "set":
      if (!isId(change.id) || !isId(change.workoutId)) return false;
      switch (change.field) {
        case "create":
          // Positions 0 to 2 are the warm-ups (no RIR, in reps), the work sets come after them,
          // « + Série » beyond the plan up to position 49.
          return (
            isInt(change.slotIndex, 0, MAX_SLOTS - 1) &&
            isInt(change.position, 0, MAX_POSITION) &&
            change.warmup === change.position < MAX_WARMUPS &&
            isExerciseId(change.exerciseId) &&
            isLoad(change) &&
            (!change.warmup || (change.rir === null && change.seconds == null)) &&
            isTimeOf(change.doneAt, change.at)
          );
        case "values":
          return isLoad(change);
        case "removed":
          return typeof change.value === "boolean";
        default:
          return false;
      }
    case "program":
      return (
        isId(change.id) &&
        (change.field === "create"
          ? isProgramName(change.name) && isSchedule(change.schedule)
          : change.field === "name"
            ? isProgramName(change.value)
            : change.field === "schedule"
              ? isSchedule(change.value)
              : change.field === "removed" && isBool(change.value))
      );
    case "activeProgram":
      return isId(change.programId);
    case "programSession":
      return (
        isId(change.id) &&
        (change.field === "create"
          ? isSessionName(change.name) && isPlace(change)
          : change.field === "name"
            ? isSessionName(change.value)
            : change.field === "place"
              ? isPlace(change)
              : change.field === "removed" && isBool(change.value))
      );
    case "programSlot":
      return (
        isId(change.id) &&
        (change.field === "create"
          ? isId(change.sessionId) && isPosition(change.position) && isProgramSlot(change)
          : change.field === "exercise"
            ? isExerciseId(String(change.exerciseId)) &&
              isMeasure(change.measure) &&
              isSlotValue("reps", change.repRange, change.measure) &&
              isSlotValue("warmups", change.warmupSets, change.measure)
            : change.field === "reps" || change.field === "warmups"
              ? isMeasure(change.measure) && isSlotValue(change.field, change.value, change.measure)
              : change.field === "rule"
                ? change.value === null || change.value === "no_climbing"
                : change.field === "position"
                  ? isPosition(change.value)
                  : change.field === "main" || change.field === "removed"
                    ? isBool(change.value)
                    : Object.hasOwn(SLOT_FIELDS, change.field) &&
                      isSlotValue(change.field, change.value))
      );
    default:
      return false;
  }
}

// An entry is never dated after the phone's today (the server cannot know the timezone).
export function isRecordable(change: Change, today: ISODate): boolean {
  return isValidChange(change) && (!("date" in change) || change.date <= today);
}

export const isRecordableWeight = (change: WeightChange, today: ISODate) =>
  isRecordable(change, today);
