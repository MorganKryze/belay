import type { ISODate } from "@belay/shared/body/dates";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToday } from "@/lib/today";

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

// The month's calendar: a session day is a solid disc, an activity day a dot under the number
// (inside the disc when both), today a ring, never a fill, so it never reads as a session. Every
// mark is also said in words to screen readers and named in the legend under the grid; the month
// before and after one tap away, never past the current month.
export function MonthCalendar({
  month,
  marked,
  circled = new Set(),
  current,
  onMonth,
}: {
  month: string;
  marked: ReadonlySet<ISODate>;
  circled?: ReadonlySet<ISODate>;
  current: string;
  onMonth: (month: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const today = useToday();
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
  // The type step by its length: plain `text-secondary` names the secondary colour token first.
  const type = "text-(length:--text-secondary) leading-(--text-secondary--line-height)";
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
      <table className={`w-full table-fixed text-center ${type}`}>
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
                    <DayCell
                      day={day}
                      session={marked.has(day)}
                      activity={circled.has(day)}
                      today={day === today}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul
        aria-label={t("history.legendLabel")}
        className={`mx-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground ${type}`}
      >
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-full bg-primary" />
          {t("history.sessionDay")}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-1.25 rounded-full bg-primary-ink" />
          {t("history.activityDay")}
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-full ring-2 ring-foreground" />
          {t("history.today")}
        </li>
      </ul>
    </div>
  );
}

function DayCell({
  day,
  session,
  activity,
  today,
}: {
  day: ISODate;
  session: boolean;
  activity: boolean;
  today: boolean;
}) {
  const { t } = useTranslation();
  const look = session
    ? `bg-primary font-bold text-primary-foreground${today ? " outline-2 outline-offset-2 outline-foreground" : ""}`
    : today
      ? "font-bold text-foreground ring-2 ring-foreground ring-inset"
      : "text-foreground";
  return (
    <span
      data-day={day}
      className={`relative mx-auto grid size-11 place-items-center rounded-full tabular-nums ${look}`}
    >
      {Number(day.slice(8))}
      {session && <span className="sr-only">, {t("history.sessionDay")}</span>}
      {activity && <span className="sr-only">, {t("history.activityDay")}</span>}
      {today && <span className="sr-only">, {t("history.today")}</span>}
      {activity && (
        <span
          aria-hidden
          data-dot
          className={`absolute bottom-1.5 left-1/2 size-1.25 -translate-x-1/2 rounded-full ${
            session ? "bg-primary-foreground" : "bg-primary-ink"
          }`}
        />
      )}
    </span>
  );
}
