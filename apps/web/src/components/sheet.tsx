import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { type ReactNode, useRef } from "react";
import { useTranslation } from "react-i18next";

// The bottom sheet of every entry (§4.2): the title on the left, the day chip on the right of
// the same line, then the fields and the main button right under them. Focus lands on the title
// when it opens and goes back to what opened it when it closes.
export function Sheet({
  title,
  chip,
  onClose,
  children,
}: {
  title: string;
  chip?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const opener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-30 bg-foreground/35" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            opener.current = document.activeElement as HTMLElement | null;
            e.preventDefault();
            heading.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            // The opener may be gone (Delete removes what opened it) or never have been focused
            // (Safari does not focus a clicked button): fall back to the page's heading.
            const o = opener.current;
            const target =
              o && o !== document.body && o.isConnected
                ? o
                : document.querySelector<HTMLElement>("[data-focus-fallback]");
            target?.focus();
          }}
          className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-h-[90dvh] max-w-xl flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-card px-4 pt-2.5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-lg"
        >
          <div aria-hidden className="mx-auto h-1 w-10 shrink-0 rounded-full bg-border" />
          <div className="flex items-center gap-2">
            <Dialog.Title
              ref={heading}
              tabIndex={-1}
              className="min-w-0 flex-1 text-[15px] font-semibold text-primary-ink outline-none"
            >
              {title}
            </Dialog.Title>
            {chip}
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
    </Dialog.Root>
  );
}
