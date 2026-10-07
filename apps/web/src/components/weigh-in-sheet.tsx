import type { ISODate } from "@belay/shared/body/dates";
import type { Weighing } from "@belay/shared/body/weighings";
import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { formatWeekday } from "@/lib/format";
import { Button } from "./ui/button";
import { WeighInForm } from "./weigh-in";

// The edit sheet (§4.4): the entry form for one day, plus Delete when that day has a weigh-in.
// Lazy on Home, so the dialog code stays out of the initial bundle.
export function WeighInSheet({
  open,
  onClose,
  weighings,
  today,
  date,
  onDate,
  onSave,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  weighings: readonly Weighing[];
  today: ISODate;
  date: ISODate;
  onDate: (date: ISODate) => void;
  onSave: (date: ISODate, kg: number) => void;
  onDelete: (date: ISODate) => void;
}) {
  const { t, i18n } = useTranslation();
  // Focus goes back to what opened the sheet: a button, a history row or the chart.
  const opener = useRef<HTMLElement | null>(null);
  const title =
    date === today
      ? t("weighIn.title")
      : t("weighIn.titleFor", {
          day: formatWeekday(date, i18n.language, today, { startOfLine: false }),
        });
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-foreground/35" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            opener.current = document.activeElement as HTMLElement | null;
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            opener.current?.focus();
          }}
          className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-xl flex-col gap-2 rounded-t-[22px] bg-card px-4 pt-2.5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-lg"
        >
          <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-border" />
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-[15px] font-semibold text-primary-ink">
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={t("weighIn.close")}
                className="-mr-2 grid size-11 place-items-center rounded-chip text-muted-foreground"
              >
                <X aria-hidden className="size-5" />
              </button>
            </Dialog.Close>
          </div>
          <WeighInForm
            key={date}
            weighings={weighings}
            today={today}
            date={date}
            onDate={onDate}
            onSave={onSave}
          >
            {weighings.some((w) => w.date === date) && (
              <Button
                variant="outline"
                className="h-12 rounded-field text-base font-semibold"
                onClick={() => onDelete(date)}
              >
                {t("weighIn.delete")}
              </Button>
            )}
          </WeighInForm>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
