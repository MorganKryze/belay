import { type ISODate, toISODate } from "@belay/shared/body/dates";
import { exerciseById } from "@belay/shared/exercises/catalog";
import { groupOf } from "@belay/shared/training/program";
import type { Load, Summary } from "@belay/shared/training/rules";
import type { Slot } from "@belay/shared/training/workout";
import type { TFunction } from "i18next";
import { formatNumber, formatWeekday } from "@/lib/format";

// "6–8", or "2" when both ends are equal.
export const formatRange = ([min, max]: readonly [number, number]) =>
  min === max ? String(min) : `${min}–${max}`;

// "4 × 6–8", "3 × 30–60 s" for a timed exercise, never broken across two lines.
export const formatSets = (slot: Pick<Slot, "sets" | "repRange" | "measure">) =>
  `${slot.sets}\u00a0×\u00a0${formatRange(slot.repRange)}${slot.measure === "seconds" ? "\u00a0s" : ""}`;

export const formatRir = (slot: Slot, t: TFunction) =>
  t("workouts.rir", { range: formatRange(slot.rirTarget) });

// "80 kg × 8", "10 kg · 45 s" or "45 s": one set, as the history writes it.
export function formatLoad(load: Load, t: TFunction, locale: string): string {
  const kg = formatNumber(load.weightKg, locale, { digits: 2, grouping: false });
  if (load.seconds === null) return t("history.load", { kg, reps: load.reps });
  return load.weightKg > 0
    ? t("history.loadSeconds", { kg, seconds: load.seconds })
    : t("history.seconds", { seconds: load.seconds });
}

// "45 s", "2 min", "2 min 30".
export function formatRest(seconds: number, t: TFunction): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return t("workouts.restSec", { s: rest });
  return rest === 0
    ? t("workouts.restMin", { m: minutes })
    : t("workouts.restMinSec", { m: minutes, s: String(rest).padStart(2, "0") });
}

// "superset" for two slots in a group, "tri-set" for three or more; null for a slot alone.
export function groupKind(plan: readonly Slot[], slotIndex: number): "superset" | "triset" | null {
  const size = groupOf(plan, slotIndex).length;
  return size < 2 ? null : size === 2 ? "superset" : "triset";
}

// "58 min", "1 h 04".
export function formatDuration(ms: number, t: TFunction): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  return minutes < 60
    ? t("workouts.minutes", { m: minutes })
    : t("workouts.hours", {
        h: Math.floor(minutes / 60),
        mm: String(minutes % 60).padStart(2, "0"),
      });
}

// The duration as a figure card draws it: "48 min" → { value: "48", unit: "min" }; an hour or
// more stays whole, "1 h 04" → { value: "1 h 04" }.
export function durationParts(ms: number, t: TFunction): { value: string; unit?: string } {
  const text = formatDuration(ms, t);
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes >= 60) return { value: text };
  const value = String(minutes);
  return { value, unit: text.slice(text.indexOf(value) + value.length).trim() };
}

// "Record : Barbell bench press, 82,5 kg × 8", or "Record : Dead hang, 75 s" for a timed one.
export function recordText(r: Summary["records"][number], t: TFunction, locale: string): string {
  const exercise = exerciseById(r.exerciseId)?.name;
  const kg = formatNumber(r.weightKg, locale, { digits: 2 });
  if (r.seconds !== null)
    return r.weightKg > 0
      ? t("summary.recordLoadSeconds", { exercise, kg, seconds: r.seconds })
      : t("summary.recordSeconds", { exercise, seconds: r.seconds });
  return t("summary.record", { exercise, kg, reps: r.reps });
}

// The day a session started and its start time, on this device's clock: « Lundi 28 septembre ·
// 18 h 12 » (French writes the hour as the length writes « 1 h 02 »), "Monday, September 28 ·
// 6:12 PM".
export function formatStarted(startedAt: string, locale: string, today: ISODate, t: TFunction) {
  const start = new Date(startedAt);
  const clock = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
  const parts = clock.formatToParts(start);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return t("history.started", {
    day: formatWeekday(toISODate(start), locale, today, { long: true }),
    time: clock.format(start),
    h: part("hour"),
    mm: part("minute"),
  });
}
