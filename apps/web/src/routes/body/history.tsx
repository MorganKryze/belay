import "@/i18n/lazy";
import type { ISODate } from "@belay/shared/body/dates";
import type { IntakeLog } from "@belay/shared/body/intake";
import { MEASURE_FIELDS, type Measure, measureOf } from "@belay/shared/body/measures";
import type { Weighing } from "@belay/shared/body/weighings";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { groupCard, sectionLabel } from "@/components/surfaces";
import { dayLabel } from "@/components/weigh-in";
import { formatNumber } from "@/lib/format";
import { bodyWeightText } from "@/lib/units";

// Two columns: the day's lines, then the chevron's 16 px, kept empty on a day without a weigh-in so
// every weight ends at the same right edge.
const row =
  "grid min-h-14 w-full grid-cols-[minmax(0,1fr)_16px] items-center gap-x-3 px-4 py-2 text-left";

// The chevron, or its spacer, spans the second line only when there is one: a lone line would
// otherwise share the row's height with an empty second track and sit above the middle.
const span = (rest: string[]) => (rest.length > 0 ? "row-span-2" : "");

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
      ...MEASURE_FIELDS.map((f) => {
        const cm = m ? measureOf(m, f) : null;
        return cm !== null && t(`body.dayParts.${f}`, { value: number(cm) });
      }),
    ].filter((part): part is string => typeof part === "string");
  };
  return (
    <section aria-labelledby="history" className="flex flex-col gap-2">
      <h2 id="history" className={sectionLabel}>
        {t("body.history")}
      </h2>
      <ul className={groupCard}>
        {days.map((date) => {
          const w = weighings.find((x) => x.date === date);
          const rest = parts(date);
          const content = (
            <>
              <span className="col-start-1 flex items-baseline justify-between gap-x-3 text-[15px] font-semibold">
                <span>{dayLabel(date, today, t, i18n.language)}</span>
                {w && (
                  <b className="font-semibold text-foreground tabular-nums">
                    {bodyWeightText(w.weightKg, i18n.language)}
                  </b>
                )}
              </span>
              {rest.length > 0 && (
                // A line only breaks between two parts, never inside one.
                <span className="col-start-1 flex flex-wrap gap-x-1.5 text-[13px] text-muted-foreground tabular-nums">
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
            <li key={date}>
              {w ? (
                <button
                  type="button"
                  className={`press-tint ${row} outline-ring focus-visible:outline-2 focus-visible:-outline-offset-2`}
                  onClick={() => onSelect(date)}
                >
                  {content}
                  <ChevronRight
                    aria-hidden="true"
                    className={`col-start-2 row-start-1 size-4 text-muted-foreground ${span(rest)}`}
                  />
                </button>
              ) : (
                <div className={row}>
                  {content}
                  <span
                    aria-hidden="true"
                    className={`col-start-2 row-start-1 size-4 ${span(rest)}`}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
