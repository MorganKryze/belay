import type { ISODate } from "@belay/shared/body/dates";
import { MIN_WEIGH_IN_DATE } from "@belay/shared/body/weighings";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { dayLabel } from "./weigh-in";

// The day of an entry, in a sheet's header: "Today ›", "Yesterday ›", "Mon, Oct 5 ›". A tap opens
// the phone's own date picker, past days only, never before 1900.
export function DayChip({
  date,
  today,
  onChange,
  label,
}: {
  date: ISODate;
  today: ISODate;
  onChange: (date: ISODate) => void;
  label: string; // what the date is of, for screen readers
}) {
  const { t, i18n } = useTranslation();
  return (
    <label className="relative inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-chip border border-input px-3 text-sm font-medium whitespace-nowrap has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2">
      {dayLabel(date, today, t, i18n.language)}
      <ChevronRight aria-hidden className="size-4" />
      {/* Invisible over the chip: a tap opens the phone's own date picker. */}
      <input
        type="date"
        aria-label={label}
        value={date}
        min={MIN_WEIGH_IN_DATE}
        max={today}
        required
        className="absolute inset-0 cursor-pointer opacity-0"
        onClick={(e) => {
          try {
            e.currentTarget.showPicker();
          } catch {
            // Not allowed here (or not supported): the field itself still works.
          }
        }}
        onChange={(e) => {
          const v = e.target.value;
          if (v && v >= MIN_WEIGH_IN_DATE && v <= today) onChange(v);
        }}
      />
    </label>
  );
}
