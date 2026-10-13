import { addDays, type ISODate, toISODate } from "@belay/shared/body/dates";
import type { Weighing } from "@belay/shared/body/weighings";
import type { Change } from "@belay/shared/sync/schema";
import { isRecordable } from "@belay/shared/sync/valid";
import type { TFunction } from "i18next";
import { CircleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatWeekday } from "@/lib/format";
import { usePresence } from "@/lib/presence";
import { type OpenAccount, useRecord } from "@/sync/account";

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

export type ToastState = {
  id: number;
  text: string;
  undo?: () => Promise<boolean>;
  error?: boolean;
};
// Changes without their time: the time is taken when they are written.
export type Entry = Change extends infer C ? (C extends Change ? Omit<C, "at"> : never) : never;

// Writes entries and offers to undo them for 5 seconds: the undo writes new entries that put
// the previous values back (or their absence).
export function useWriter(account: OpenAccount) {
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
  // connection, a full disk) or an entry is not recordable: nothing is announced as saved.
  const write = useCallback(
    async (entries: readonly Entry[], previous: readonly Entry[], text: string) => {
      // The clock now, not the screen's: the day may have changed since it was drawn.
      const now = new Date();
      const stamp = (e: Entry) => ({ ...e, at: now.toISOString() }) as Change;
      const changes = entries.map(stamp);
      const failed = t("weighIn.saveFailed");
      if (!changes.every((c) => isRecordable(c, toISODate(now)))) {
        setError(failed);
        return false;
      }
      try {
        await record(changes);
      } catch {
        setError(failed);
        return false;
      }
      setError(null);
      const undo = async () => {
        const at = new Date().toISOString();
        try {
          await record(previous.map((e) => ({ ...e, at }) as Change));
          return true;
        } catch {
          setToast((current) => current && { id: current.id, text: failed, error: true });
          return false;
        }
      };
      setToast({ id: now.getTime(), text, undo });
      return true;
    },
    [record, t],
  );
  return {
    write,
    toast,
    error: error ?? undefined,
    clearError: () => setError(null),
    dismiss: () => setToast(null),
  };
}

// Above the tab bar on a phone, centred near the bottom from 1 024 px; mounted for good so the
// message is announced. The card stays drawn while it fades out.
export function Toast({ toast, onDone }: { toast: ToastState | null; onDone: () => void }) {
  const { t } = useTranslation();
  const { shown, leaving, onAnimationEnd } = usePresence(toast);
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-[var(--chrome-bottom,calc(5.5rem+env(safe-area-inset-bottom)))] z-20 mx-auto flex max-w-xl px-4 lg:bottom-6 lg:w-[400px] lg:px-0"
    >
      {shown && (
        <div
          key={shown.id}
          onAnimationEnd={onAnimationEnd}
          className={`pointer-events-auto flex w-full flex-wrap items-center justify-end gap-x-3 rounded-field bg-foreground py-1 pr-1 pl-4 text-body text-background shadow-float ${leaving ? "animate-fade-out" : "animate-rise-in"}`}
        >
          {shown.error && <CircleAlert aria-hidden className="size-5 shrink-0 text-toast-icon" />}
          <span className="min-w-0 grow py-2.5">{shown.text}</span>
          {shown.undo && !shown.error && (
            <button
              type="button"
              className="min-h-11 min-w-11 rounded-chip px-3 font-bold text-toast-action"
              onClick={() => {
                void shown.undo?.().then((ok) => ok && onDone());
              }}
            >
              {t("weighIn.undo")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
