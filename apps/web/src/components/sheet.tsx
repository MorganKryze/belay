import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import {
  type AnimationEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { motion } from "@/lib/motion";
import { useSwipeToClose } from "./sheet-swipe";

// The longest a close may take when the exit animation never reports its end: the 260 ms exit
// plus room for a busy frame.
const EXIT_LIMIT_MS = 400;

// The close contract shared by every sheet. Any request (close button, overlay, Escape, the
// owner's open={false}) starts the exit once; the owner hears about it once, when the exit has
// played, at once when no exit will play, and at the latest 400 ms after the request.
export function useSheetExit(open: boolean, onClose: () => void) {
  const [dialogOpen, setDialogOpen] = useState(open);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const leaving = useRef(false);
  const told = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latestOnClose = useRef(onClose);
  useEffect(() => {
    latestOnClose.current = onClose;
  });

  const finish = useCallback(() => {
    if (told.current) return;
    told.current = true;
    clearTimeout(timer.current);
    latestOnClose.current();
  }, []);

  const request = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    const animates = motion.exitWillAnimate(contentRef.current);
    setDialogOpen(false);
    if (animates) timer.current = setTimeout(finish, EXIT_LIMIT_MS);
    else finish();
  }, [finish]);

  useEffect(() => {
    if (!open) request();
  }, [open, request]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onAnimationEnd = useCallback(
    (e: AnimationEvent) => {
      // Only the card's own exit counts, not an animation bubbling up from its content.
      if (leaving.current && e.target === e.currentTarget) finish();
    },
    [finish],
  );

  return { dialogOpen, request, contentRef, onAnimationEnd };
}

// The opener may be gone (Delete removes what opened it) or never have been focused (Safari does
// not focus a clicked button): focus then falls back to the page's heading.
export function focusBack(opener: HTMLElement | null) {
  const target =
    opener && opener !== document.body && opener.isConnected
      ? opener
      : document.querySelector<HTMLElement>("[data-focus-fallback]");
  target?.focus();
}

// The sheet of every entry (§4.2): on a phone a card rising from the bottom, on a computer a
// centred dialog. The title sits on the left, the day chip on the right of the same line, then
// the fields and the main button right under them. Focus lands on the title when it opens and
// goes back to what opened it once the exit has played. On a phone it also closes by a swipe down.
export function Sheet({
  title,
  chip,
  open = true,
  onClose,
  children,
}: {
  title: string;
  chip?: ReactNode;
  open?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const opener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // The sheet stays mounted through its exit and leaves the page when the owner is told, even
  // if the owner keeps rendering it closed.
  const [gone, setGone] = useState(false);
  const exit = useSheetExit(open, () => {
    setGone(true);
    onClose();
  });
  useSwipeToClose(exit.contentRef, exit.request, exit.dialogOpen);
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
            // A leaving card takes no tap nor key: a second Save during the exit would write
            // again and leave Undo with the first save as its "before".
            inert={!exit.dialogOpen}
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => {
              opener.current = document.activeElement as HTMLElement | null;
              e.preventDefault();
              heading.current?.focus();
            }}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              focusBack(opener.current);
            }}
            className="fixed inset-x-2 bottom-2 z-40 mx-auto flex max-h-[calc(100dvh-1rem)] max-w-xl flex-col gap-3 touch-pan-x touch-pan-down touch-pinch-zoom overflow-y-auto rounded-sheet bg-surface px-4.5 pt-2 pb-[max(1.375rem,env(safe-area-inset-bottom))] shadow-sheet data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in lg:inset-0 lg:m-auto lg:h-fit lg:max-h-[85dvh] lg:w-[480px] lg:max-w-none lg:touch-auto lg:rounded-bar lg:pt-4.5 lg:data-[state=closed]:animate-fade-out lg:data-[state=open]:animate-dialog-in dark:border dark:border-border"
          >
            <div
              aria-hidden
              className="mx-auto h-1.25 w-10 shrink-0 rounded-round bg-border lg:hidden"
            />
            <div className="flex items-center gap-2">
              <Dialog.Title
                ref={heading}
                tabIndex={-1}
                className="line-clamp-2 min-w-0 flex-1 text-title-compact text-foreground outline-none"
              >
                {title}
              </Dialog.Title>
              {chip && <div className="shrink-0">{chip}</div>}
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label={t("weighIn.close")}
                  className="-mr-2 grid size-11 shrink-0 place-items-center rounded-chip text-muted-foreground"
                >
                  <X aria-hidden className="size-5" />
                </button>
              </Dialog.Close>
            </div>
            {children}
          </Dialog.Content>
        </Dialog.Portal>
      )}
    </Dialog.Root>
  );
}
