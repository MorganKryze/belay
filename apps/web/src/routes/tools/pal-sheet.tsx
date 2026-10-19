import { PAL_LEVELS } from "@belay/shared/tools/energy";
import { Check } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sheet } from "@/components/sheet";
import { formatNumber } from "@/lib/format";

export type PalId = (typeof PAL_LEVELS)[number]["id"];

// The four activity levels in a sheet; a tap, Enter or Space picks one and closes, as a menu does;
// the arrows only move focus, so a key press never closes it by surprise. The pick is written
// first, then the sheet leaves through its own exit, so the row behind already says the new level.
export function PalSheet({
  value,
  onPick,
  onClose,
}: {
  value: PalId;
  onPick: (id: PalId) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(true);
  const [focused, setFocused] = useState(() =>
    Math.max(
      0,
      PAL_LEVELS.findIndex((l) => l.id === value),
    ),
  );
  const options = useRef<(HTMLButtonElement | null)[]>([]);

  const pick = (id: PalId) => {
    onPick(id);
    setOpen(false);
  };
  const move = (to: number) => {
    const i = Math.min(PAL_LEVELS.length - 1, Math.max(0, to));
    setFocused(i);
    options.current[i]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent, i: number, id: PalId) => {
    const to =
      e.key === "ArrowDown"
        ? i + 1
        : e.key === "ArrowUp"
          ? i - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? PAL_LEVELS.length - 1
              : null;
    if (to !== null) {
      e.preventDefault();
      move(to);
    } else if (e.key === "Enter" || e.key === " ") {
      // Handled here so the native click that follows the key never picks a second time.
      e.preventDefault();
      pick(id);
    }
  };

  return (
    <Sheet title={t("energy.activity")} open={open} onClose={onClose}>
      <div
        role="listbox"
        aria-label={t("energy.activity")}
        className="flex flex-col divide-y divide-border overflow-hidden rounded-group border border-border"
      >
        {PAL_LEVELS.map((l, i) => {
          const chosen = l.id === value;
          return (
            <button
              key={l.id}
              ref={(el) => {
                options.current[i] = el;
              }}
              type="button"
              role="option"
              aria-selected={chosen}
              tabIndex={i === focused ? 0 : -1}
              onClick={() => pick(l.id)}
              onKeyDown={(e) => onKeyDown(e, i, l.id)}
              onFocus={() => setFocused(i)}
              className="press-tint flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left outline-ring focus-visible:outline-2 focus-visible:-outline-offset-2"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-baseline justify-between gap-2.5">
                  <span className="text-body font-semibold">{t(`energy.levels.${l.id}.name`)}</span>{" "}
                  <span className="text-[14px] text-muted-foreground tabular-nums">
                    {formatNumber(l.pal, i18n.language, { digits: 2, minDigits: 2 })}
                  </span>
                </span>{" "}
                <span className="text-(length:--text-secondary) leading-(--text-secondary--line-height) text-muted-foreground">
                  {t(`energy.levels.${l.id}.description`)}
                </span>
              </span>
              <span className="grid w-5 shrink-0 place-items-center">
                {chosen && <Check aria-hidden className="size-5 text-primary-ink" />}
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
