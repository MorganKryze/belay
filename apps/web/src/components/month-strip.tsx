import { useTranslation } from "react-i18next";

export type MonthCell = {
  key: string;
  label: string;
  // Shown above January when the strip crosses a new year, so "janv." is never ambiguous.
  year: string | null;
  // Filled part of the month, as fractions of its width.
  from: number;
  to: number;
};

const MAX_CELLS = 8;
const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();
const daysIn = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

// Months from today's to the one after the window; when that is too long, start the month
// before the window instead. More than MAX_CELLS months even then: null, the sentence suffices.
export function monthCells(today: Date, low: Date, high: Date, locale: string): MonthCell[] | null {
  const end = monthIndex(high) + 1;
  let start = monthIndex(today);
  if (end - start + 1 > MAX_CELLS) start = Math.max(start, monthIndex(low) - 1);
  if (end - start + 1 > MAX_CELLS) return null;
  const crossesYear = Math.floor(start / 12) !== Math.floor(end / 12);
  const name = new Intl.DateTimeFormat(locale, { month: "short" });
  const cells: MonthCell[] = [];
  for (let i = start; i <= end; i++) {
    const year = Math.floor(i / 12);
    const month = i % 12;
    const days = daysIn(year, month);
    const from = i < monthIndex(low) ? 1 : i === monthIndex(low) ? (low.getDate() - 1) / days : 0;
    const to = i > monthIndex(high) ? 0 : i === monthIndex(high) ? high.getDate() / days : 1;
    cells.push({
      key: `${year}-${month}`,
      label: name.format(new Date(year, month, 1)),
      year: crossesYear && month === 0 ? String(year) : null,
      from: Math.min(from, to),
      to,
    });
  }
  return cells;
}

export function MonthStrip({ today, low, high }: { today: Date; low: Date; high: Date }) {
  const { t, i18n } = useTranslation();
  const cells = monthCells(today, low, high, i18n.language);
  if (cells === null) return null;
  const long = new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" });
  return (
    <div
      role="img"
      aria-label={t("projection.strip", { from: long.format(low), to: long.format(high) })}
      className="my-2 grid auto-cols-fr grid-flow-col gap-1"
    >
      {cells.map((c) => {
        const filled = c.to > c.from;
        return (
          <div
            key={c.key}
            className={
              filled
                ? "text-center text-xs font-bold"
                : "text-center text-xs font-semibold text-muted-foreground"
            }
          >
            <div className="h-4 text-[11px] font-normal text-muted-foreground">{c.year}</div>
            {c.label}
            <div className="relative mt-1 h-2.5 overflow-hidden rounded-full bg-track">
              {filled && (
                <i
                  className="absolute inset-y-0 rounded-full bg-primary"
                  style={{ left: `${c.from * 100}%`, right: `${(1 - c.to) * 100}%` }}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
