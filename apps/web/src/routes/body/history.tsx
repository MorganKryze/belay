import type { ISODate } from "@belay/shared/body/dates";
import type { IntakeLog } from "@belay/shared/body/intake";
import { type Measure, measureOf } from "@belay/shared/body/measures";
import type { Weighing } from "@belay/shared/body/weighings";
import { useTranslation } from "react-i18next";
import { dayLabel } from "@/components/weigh-in";
import { formatKg, formatNumber } from "@/lib/format";

const sectionTitle = "text-[15px] font-bold";

// One line per day of the period that holds an entry, the most recent first, saying what was
// entered ("79.8 kg · 2,100 kcal", "waist 82 cm"); a day with a weigh-in opens its sheet.
// ponytail: "All" renders every line at once. Upgrade: show the latest hundred and a "More" button.
export function History({
  weighings,
  measures,
  intake,
  today,
  onSelect,
}: {
  weighings: Weighing[];
  measures: Measure[];
  intake: IntakeLog[];
  today: ISODate;
  onSelect: (date: ISODate) => void;
}) {
  const { t, i18n } = useTranslation();
  const days = [...new Set([...weighings, ...measures, ...intake].map((e) => e.date))].sort(
    (a, b) => (a < b ? 1 : -1),
  );
  if (days.length === 0) return null;
  const number = (v: number) => formatNumber(v, i18n.language, { digits: 1 });
  // The other parts of a day, apart from its weight: one line of their own under the day.
  const parts = (date: ISODate): string[] => {
    const l = intake.find((x) => x.date === date);
    const m = measures.find((x) => x.date === date);
    return [
      l?.kcal != null &&
        t("body.kcal", { value: formatNumber(l.kcal, i18n.language, { digits: 0 }) }),
      l?.proteinG != null &&
        t("body.dayParts.protein", {
          value: formatNumber(l.proteinG, i18n.language, { digits: 0 }),
        }),
      ...(["waist", "neck", "hip"] as const).map((f) => {
        const cm = m ? measureOf(m, f) : null;
        return cm !== null && t(`body.dayParts.${f}`, { value: number(cm) });
      }),
    ].filter((part): part is string => typeof part === "string");
  };
  const line = "flex min-h-11 w-full flex-col justify-center gap-0.5 py-2 text-left";
  return (
    <section aria-labelledby="history" className="flex flex-col gap-1">
      <h2 id="history" className={sectionTitle}>
        {t("body.history")}
      </h2>
      <ul>
        {days.map((date) => {
          const w = weighings.find((x) => x.date === date);
          const rest = parts(date);
          const content = (
            <>
              <span className="flex items-baseline justify-between gap-x-3">
                <span>{dayLabel(date, today, t, i18n.language)}</span>
                {w && (
                  <b className="tabular-nums">
                    {t("trend.kg", { value: formatKg(w.weightKg, i18n.language) })}
                  </b>
                )}
              </span>
              {rest.length > 0 && (
                // A line only breaks between two parts, never inside one.
                <span className="flex flex-wrap gap-x-1.5 text-sm text-muted-foreground tabular-nums">
                  {rest.map((part, i) => (
                    <span key={part} className="whitespace-nowrap">
                      {part}
                      {i < rest.length - 1 && " ·"}
                    </span>
                  ))}
                </span>
              )}
            </>
          );
          return (
            <li key={date} className="border-t border-border first:border-t-0">
              {w ? (
                <button type="button" className={line} onClick={() => onSelect(date)}>
                  {content}
                </button>
              ) : (
                <div className={line}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
