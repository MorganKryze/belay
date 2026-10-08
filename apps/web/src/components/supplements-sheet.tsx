import "@/i18n/lazy";
import type { ISODate } from "@belay/shared/body/dates";
import { creatineWindows } from "@belay/shared/body/supplements";
import type { SupplementLogRow, SupplementRow } from "@belay/shared/sync/schema";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DayChip } from "./day-chip";
import { Sheet } from "./sheet";

const daysBetween = (a: ISODate, b: ISODate) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// The day of a creatine course `date` falls on (1 on its first day), or null outside one.
export function creatineDay(
  supplements: readonly SupplementRow[],
  logs: readonly SupplementLogRow[],
  date: ISODate,
): number | null {
  const creatine = new Set(supplements.filter((s) => s.kind === "creatine").map((s) => s.id));
  const days = logs.filter((l) => l.taken && creatine.has(l.supplementId)).map((l) => l.date);
  const course = creatineWindows(days, date).find((w) => w.start <= date && date <= w.end);
  return course ? daysBetween(course.start, date) + 1 : null;
}

// The supplements sheet (§4.2): a native checkbox per supplement of the list; a tick is saved at
// once, with no button. Belay notes, it never advises (D2).
export function SupplementsSheet({
  onClose,
  supplements,
  logs,
  today,
  date,
  onDate,
  onToggle,
  error,
}: {
  onClose: () => void;
  supplements: readonly SupplementRow[];
  logs: readonly SupplementLogRow[];
  today: ISODate;
  date: ISODate;
  onDate: (date: ISODate) => void;
  // Resolves false when the phone refused the write: the box goes back.
  onToggle: (supplementId: string, taken: boolean) => Promise<boolean>;
  error?: string;
}) {
  const { t } = useTranslation();
  const saved = new Set(logs.filter((l) => l.date === date && l.taken).map((l) => l.supplementId));
  // A tick shows at once, before the phone has written it; per day, so a new date starts clean.
  const [ticking, setTicking] = useState<{ date: ISODate; boxes: Record<string, boolean> }>({
    date,
    boxes: {},
  });
  const boxes = ticking.date === date ? ticking.boxes : {};
  const isTaken = (id: string) => boxes[id] ?? saved.has(id);
  const toggle = (id: string, checked: boolean) => {
    setTicking({ date, boxes: { ...boxes, [id]: checked } });
    void onToggle(id, checked).then((ok) => {
      if (!ok)
        setTicking((t) => ({
          ...t,
          boxes: Object.fromEntries(Object.entries(t.boxes).filter(([k]) => k !== id)),
        }));
    });
  };
  const day = creatineDay(supplements, logs, date);
  return (
    <Sheet
      title={t("today.supplements")}
      onClose={onClose}
      chip={<DayChip date={date} today={today} onChange={onDate} label={t("supplements.date")} />}
    >
      <ul className="flex flex-col">
        {supplements
          .filter((s) => !s.removed)
          .map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 border-t border-border first:border-t-0"
            >
              <label className="flex min-h-12 min-w-0 flex-1 items-center gap-3 py-1">
                <input
                  type="checkbox"
                  checked={isTaken(s.id)}
                  onChange={(e) => toggle(s.id, e.target.checked)}
                  className="size-6 shrink-0 accent-primary"
                />
                <span className="min-w-0 break-words">{s.name}</span>
              </label>
              {s.kind === "creatine" && isTaken(s.id) && day !== null && (
                <span className="shrink-0 rounded-full bg-track px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-muted-foreground">
                  {t("supplements.since", { count: day })}
                </span>
              )}
            </li>
          ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      <Link
        to="/settings/supplements"
        className="-ml-1 inline-flex min-h-11 items-center gap-0.5 self-start font-medium text-primary"
      >
        {t("supplements.manage")}
        <ChevronRight aria-hidden className="size-5" />
      </Link>
    </Sheet>
  );
}
