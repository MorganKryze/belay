import type { ISODate } from "@belay/shared/body/dates";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

// "2026-10" → the days of that month, Monday first: null for the blanks before the 1st.
export function monthGrid(month: string): (ISODate | null)[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const blanks = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [
    ...Array.from({ length: blanks }, () => null),
    ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
}

export const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

// The month's calendar, the days with a session marked (a tint, and words for screen readers),
// the month before and after one tap away; never past the current month.
export function MonthCalendar({
  month,
  marked,
  current,
  onMonth,
}: {
  month: string;
  marked: ReadonlySet<ISODate>;
  current: string;
  onMonth: (month: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [y, m] = month.split("-").map(Number) as [number, number];
  const title = new Intl.DateTimeFormat(i18n.language, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
  const weekday = (style: "narrow" | "long") =>
    Array.from({ length: 7 }, (_, i) =>
      new Intl.DateTimeFormat(i18n.language, { weekday: style, timeZone: "UTC" }).format(
        new Date(Date.UTC(2026, 9, 5 + i)), // a Monday, then the week
      ),
    );
  const narrow = weekday("narrow");
  const long = weekday("long");
  const cells = monthGrid(month);
  const weeks = Array.from({ length: Math.ceil(cells.length / 7) }, (_, w) =>
    cells.slice(w * 7, w * 7 + 7),
  );
  const nav =
    "grid size-11 place-items-center rounded-chip text-foreground disabled:text-muted-foreground disabled:opacity-40";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <button
          type="button"
          className={nav}
          aria-label={t("history.previousMonth")}
          onClick={() => onMonth(shiftMonth(month, -1))}
        >
          <ChevronLeft aria-hidden className="size-5" />
        </button>
        <span aria-live="polite" className="font-semibold first-letter:uppercase">
          {title}
        </span>
        <button
          type="button"
          className={nav}
          aria-label={t("history.nextMonth")}
          disabled={month >= current}
          onClick={() => onMonth(shiftMonth(month, 1))}
        >
          <ChevronRight aria-hidden className="size-5" />
        </button>
      </div>
      <table className="w-full table-fixed text-center text-[13px]">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr>
            {narrow.map((d, i) => (
              <th
                key={i}
                scope="col"
                abbr={long[i]}
                className="pb-1 text-xs font-semibold text-muted-foreground"
              >
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, w) => (
            <tr key={w}>
              {week.map((day, i) => (
                <td key={i} className="py-0.5">
                  {day && (
                    <span
                      className={
                        marked.has(day)
                          ? "mx-auto grid size-9 place-items-center rounded-full bg-primary-soft font-bold text-primary-ink tabular-nums"
                          : "mx-auto grid size-9 place-items-center tabular-nums"
                      }
                    >
                      {Number(day.slice(8))}
                      {marked.has(day) && (
                        <span className="sr-only">, {t("history.sessionDay")}</span>
                      )}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
