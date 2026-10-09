import { groupOf } from "@belay/shared/training/program";
import type { Slot } from "@belay/shared/training/workout";
import type { TFunction } from "i18next";

// "6–8", or "2" when both ends are equal.
export const formatRange = ([min, max]: readonly [number, number]) =>
  min === max ? String(min) : `${min}–${max}`;

// "4 × 6–8", never broken across two lines.
export const formatSets = (slot: Slot) => `${slot.sets}\u00a0×\u00a0${formatRange(slot.repRange)}`;

export const formatRir = (slot: Slot, t: TFunction) =>
  t("workouts.rir", { range: formatRange(slot.rirTarget) });

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
