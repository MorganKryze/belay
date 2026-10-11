import type { Activity, DaySummary } from "@belay/shared/training/activities";
import type { TFunction } from "i18next";
import { formatNumber } from "./format";

// "45 min", "1 h", "1 h 30".
export function formatMinutes(minutes: number, t: TFunction): string {
  if (minutes < 60) return t("activities.minutes", { m: minutes });
  const rest = minutes % 60;
  return rest === 0
    ? t("activities.hoursOnly", { h: minutes / 60 })
    : t("activities.hours", { h: Math.floor(minutes / 60), mm: String(rest).padStart(2, "0") });
}

// "Escalade · 1 h 30 · 6b+", "Escalade · 1 h 30 · bleu", "Vélo · 45 min".
export function activityText(a: Activity, t: TFunction): string {
  if (a.kind === "cardio")
    return `${t(`activities.cardio.${a.cardioType ?? "other"}`)} · ${formatMinutes(a.durationMin, t)}`;
  const hardest = a.climbGrade ?? (a.climbColor && t(`activities.colors.${a.climbColor}`));
  return [
    t("activities.climbing"),
    formatMinutes(a.durationMin, t),
    ...(hardest ? [hardest] : []),
  ].join(" · ");
}

// What Home's « Activité » line says about the day.
export function daySummaryText(summary: DaySummary, t: TFunction, locale: string): string {
  switch (summary.kind) {
    case "none":
      return t("today.activityEmpty");
    case "steps":
      return t("activities.steps", { value: formatNumber(summary.steps, locale, { digits: 0 }) });
    case "activity":
      return activityText(summary.activity, t);
    case "many":
      return t("today.activityMany", { count: summary.count });
  }
}
