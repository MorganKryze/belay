import { isAnnotationLabel } from "../body/annotations";
import type { ISODate } from "../body/dates";
import { isKcal, isProteinG } from "../body/intake";
import { isMeasureCm } from "../body/measures";
import { isBirthYear, isProfileHeight } from "../body/profile";
import { isSupplementName } from "../body/supplements";
import { isTargetRange } from "../body/target";
import { isWeighingKg, MIN_WEIGH_IN_DATE } from "../body/weighings";
import { isExerciseId } from "../exercises/library";
import {
  isExerciseNotes,
  isNote,
  isPlan,
  isReps,
  isRir,
  isSessionCode,
  isSetKg,
  MAX_SLOTS,
  MAX_WARMUPS,
  MIN_TIME,
  SLOT_BOUNDS,
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
const isLoad = (c: { weightKg: number; reps: number; rir: number | null }) =>
  isSetKg(c.weightKg) && isReps(c.reps) && isRir(c.rir);

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
    case "workout":
      if (!isId(change.id)) return false;
      switch (change.field) {
        case "start":
          return (
            isSessionCode(change.sessionCode) &&
            isPlan(change.plan) &&
            isTimeOf(change.startedAt, change.at)
          );
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
          // Positions 0 to 2 are the warm-ups (no RIR), the work sets come after them.
          return (
            isInt(change.slotIndex, 0, MAX_SLOTS - 1) &&
            isInt(change.position, 0, MAX_WARMUPS + SLOT_BOUNDS.sets - 1) &&
            change.warmup === change.position < MAX_WARMUPS &&
            isExerciseId(change.exerciseId) &&
            isLoad(change) &&
            (!change.warmup || change.rir === null) &&
            isTimeOf(change.doneAt, change.at)
          );
        case "values":
          return isLoad(change);
        case "removed":
          return typeof change.value === "boolean";
        default:
          return false;
      }
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
