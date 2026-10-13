import "@/i18n/lazy";
import { Dialog } from "radix-ui";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { focusBack, useSheetExit } from "@/components/sheet";

const card = "flex flex-col divide-y divide-border overflow-hidden rounded-group bg-surface";
// The card clips its overflow to keep its corners, so the focus ring is drawn inside the row and
// rounded like the card where the row meets its edge.
const row =
  "min-h-14 w-full px-4 text-button first:rounded-t-group last:rounded-b-group focus-visible:outline-2 focus-visible:-outline-offset-2";

// A question before something that cannot be taken back: a card with the question, what goes and
// the action in red, and a separate Cancel. It rises and leaves like a sheet and keeps its close
// contract; the action is written before the exit starts.
export function ActionSheet({
  title,
  body,
  confirm,
  onConfirm,
  onClose,
  open = true,
  busy = false,
}: {
  title: string;
  body: string;
  confirm: string;
  onConfirm: () => void;
  onClose: () => void;
  open?: boolean;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const opener = useRef<HTMLElement | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [gone, setGone] = useState(false);
  const exit = useSheetExit(open, () => {
    setGone(true);
    onClose();
  });
  return (
    <Dialog.Root open={exit.dialogOpen} onOpenChange={(o) => !o && exit.request()}>
      {!gone && (
        <Dialog.Portal forceMount>
          <Dialog.Overlay
            data-sheet-overlay
            className="fixed inset-0 z-30 bg-scrim data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in"
          />
          <Dialog.Content
            ref={exit.contentRef}
            onAnimationEnd={exit.onAnimationEnd}
            inert={!exit.dialogOpen}
            onOpenAutoFocus={(e) => {
              opener.current = document.activeElement as HTMLElement | null;
              // Cancel first: Enter right after opening must not remove anything.
              e.preventDefault();
              cancel.current?.focus();
            }}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              focusBack(opener.current);
            }}
            className="fixed inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-xl flex-col gap-2 data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in lg:inset-0 lg:m-auto lg:h-fit lg:w-[400px] lg:max-w-none lg:data-[state=closed]:animate-fade-out lg:data-[state=open]:animate-dialog-in"
          >
            <div data-action-card className={`${card} shadow-sheet dark:border dark:border-border`}>
              <div className="flex flex-col gap-1 px-4 py-3.5 text-center">
                <Dialog.Title className="text-body font-[650] text-foreground">
                  {title}
                </Dialog.Title>
                <Dialog.Description // The 13 px step by its length: a bare text-secondary would also paint the secondary color.
                  className="line-clamp-2 text-(length:--text-secondary) leading-(--text-secondary--line-height) text-muted-foreground"
                >
                  {body}
                </Dialog.Description>
              </div>
              <button
                type="button"
                disabled={busy}
                className={`${row} text-destructive disabled:opacity-50`}
                onClick={() => {
                  onConfirm();
                  exit.request();
                }}
              >
                {confirm}
              </button>
            </div>
            <div data-action-card className={`${card} shadow-sheet dark:border dark:border-border`}>
              <Dialog.Close asChild>
                <button ref={cancel} type="button" className={`${row} font-bold text-foreground`}>
                  {t("history.cancel")}
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  );
}
