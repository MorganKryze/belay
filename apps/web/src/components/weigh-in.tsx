import { addDays, type ISODate, toISODate } from "@belay/shared/body/dates";
import { isWeighingKg, WEIGHING_RANGE_KG, type Weighing } from "@belay/shared/body/weighings";
import { isRecordableWeight } from "@belay/shared/sync/valid";
import { roundTo } from "@belay/shared/tools/round";
import type { TFunction } from "i18next";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatWeekday } from "@/lib/format";
import { type OpenAccount, useRecord } from "@/sync/account";
import { NumberStepper } from "./number-stepper";
import { Button } from "./ui/button";

// "Today", "Yesterday", then "Wed, Sep 30".
export function dayLabel(date: ISODate, today: ISODate, t: TFunction, locale: string): string {
  if (date === today) return t("weighIn.today");
  if (date === addDays(today, -1)) return t("weighIn.yesterday");
  return formatWeekday(date, locale, today);
}

// The day's own weigh-in, else the last one up to today (one tap when it is right), else empty.
export function startingWeight(
  weighings: readonly Weighing[],
  date: ISODate,
  today: ISODate,
): { kg: number | null; prefilled: boolean } {
  const own = weighings.find((w) => w.date === date);
  if (own) return { kg: own.weightKg, prefilled: false };
  const last = weighings
    .filter((w) => w.date <= today)
    .reduce<Weighing | undefined>((a, w) => (a && a.date > w.date ? a : w), undefined);
  return last ? { kg: last.weightKg, prefilled: true } : { kg: null, prefilled: false };
}

// The stepper, the day chip (a native date picker, never after today) and Save. Give it a
// `key` of the date: the value starts again from that day. Until the person edits it, the
// value follows the data, so the first sync on a new phone still fills it in.
export function WeighInForm({
  weighings,
  today,
  date,
  onDate,
  onSave,
  error,
  children,
}: {
  weighings: readonly Weighing[];
  today: ISODate;
  date: ISODate;
  onDate: (date: ISODate) => void;
  onSave: (date: ISODate, kg: number) => void;
  error?: string;
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const start = startingWeight(weighings, date, today);
  const [edited, setEdited] = useState<number | null | undefined>(undefined);
  const value = edited === undefined ? start.kg : edited;
  const kg = value === null ? null : roundTo(value, WEIGHING_RANGE_KG.step);
  const invalid = kg !== null && !isWeighingKg(kg);
  return (
    <div className="flex flex-col gap-2.5">
      <NumberStepper
        label={t("weighIn.weight")}
        labelHidden
        value={value}
        onChange={setEdited}
        min={WEIGHING_RANGE_KG.min}
        max={WEIGHING_RANGE_KG.max}
        step={WEIGHING_RANGE_KG.step}
        unit="kg"
        optional
        clampTyped={false}
        error={invalid ? t("weighIn.outOfRange") : undefined}
      />
      <div className="flex items-center gap-2">
        <label className="relative inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-chip border border-input px-3 text-sm font-medium has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2">
          {dayLabel(date, today, t, i18n.language)}
          <ChevronRight aria-hidden className="size-4" />
          {/* Invisible over the chip: a tap opens the phone's own date picker. */}
          <input
            type="date"
            aria-label={t("weighIn.date")}
            value={date}
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
              if (e.target.value && e.target.value <= today) onDate(e.target.value);
            }}
          />
        </label>
        {start.prefilled && edited === undefined && (
          <span className="text-xs leading-tight text-muted-foreground">
            {t("weighIn.prefilled")}
          </span>
        )}
      </div>
      <Button
        className="h-12 rounded-field text-base font-semibold"
        disabled={kg === null || invalid}
        onClick={() => kg !== null && onSave(date, kg)}
      >
        {t("weighIn.save")}
      </Button>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      {children}
    </div>
  );
}

export type ToastState = { id: number; text: string; undo: () => Promise<boolean> };

// Writes a weigh-in (or deletes it with null) and offers to undo it for 5 seconds: the undo is
// a new entry that puts the previous value of the day back (or its absence).
export function useWeighInWriter(account: OpenAccount, weighings: readonly Weighing[]) {
  const { t } = useTranslation();
  const record = useRecord(account);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  // False, with the reason on screen, when the phone refuses the write (a lost IndexedDB
  // connection, a full disk) or the entry is not recordable: nothing is announced as saved.
  const write = useCallback(
    async (date: ISODate, weightKg: number | null) => {
      // The clock now, not the screen's: the date picker never goes past today, but the day may
      // have changed since the screen was drawn.
      const now = new Date();
      const change = { kind: "weight", date, weightKg, at: now.toISOString() } as const;
      const failed = t("weighIn.saveFailed");
      if (!isRecordableWeight(change, toISODate(now))) {
        setError(failed);
        return false;
      }
      const previous = weighings.find((w) => w.date === date)?.weightKg ?? null;
      try {
        await record(change);
      } catch {
        setError(failed);
        return false;
      }
      setError(null);
      const undo = async () => {
        try {
          await record({ ...change, weightKg: previous, at: new Date().toISOString() });
          return true;
        } catch {
          setToast((current) => current && { ...current, text: failed });
          return false;
        }
      };
      setToast({
        id: now.getTime(),
        text: t(weightKg === null ? "weighIn.toastDeleted" : "weighIn.toastSaved"),
        undo,
      });
      return true;
    },
    [record, t, weighings],
  );
  return { write, toast, error: error ?? undefined, dismiss: () => setToast(null) };
}

// Above the tab bar; mounted for good so the message is announced.
export function Toast({ toast, onDone }: { toast: ToastState | null; onDone: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-xl px-4"
    >
      {toast && (
        <div className="pointer-events-auto flex w-full items-center justify-between gap-3 rounded-field bg-foreground py-1 pr-1 pl-4 text-background shadow-lg">
          <span>{toast.text}</span>
          <button
            type="button"
            className="min-h-11 rounded-chip px-3 font-bold text-toast-action"
            onClick={() => {
              void toast.undo().then((ok) => ok && onDone());
            }}
          >
            {t("weighIn.undo")}
          </button>
        </div>
      )}
    </div>
  );
}
