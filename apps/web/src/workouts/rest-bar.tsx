import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatClock, useNow } from "./hooks";

// §4.3: the rest, counted down from its end time (right even after the app slept), +30 s and
// Skip. At zero: a short vibration where the phone can, "Back to it", a polite announcement,
// and the bar goes at the next tap anywhere. The countdown is a timer never read out each second.
export function RestBar({
  endsAt,
  next,
  onChange,
}: {
  endsAt: string;
  next: string; // "Rest · set 3 next"
  onChange: (endsAt: string | null) => void;
}) {
  const { t } = useTranslation();
  const now = useNow(250);
  const left = Date.parse(endsAt) - now;
  const over = left <= 0;
  const [announced, setAnnounced] = useState(false);
  const wasRunning = useRef(!over);
  useEffect(() => {
    if (!over) {
      wasRunning.current = true;
      setAnnounced(false);
      return;
    }
    if (wasRunning.current) {
      wasRunning.current = false;
      navigator.vibrate?.(200);
      setAnnounced(true);
    }
    // Over: the next tap anywhere puts the bar away.
    const away = () => onChange(null);
    document.addEventListener("pointerdown", away, { once: true });
    return () => document.removeEventListener("pointerdown", away);
  }, [over, onChange]);

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <p role="status" className="sr-only">
        {announced ? t("session.restOver") : ""}
      </p>
      <div className="flex items-center justify-between gap-3 rounded-[18px] bg-foreground px-4 py-3 text-background">
        {over ? (
          <span className="text-lg font-bold">{t("session.backToIt")}</span>
        ) : (
          <div className="flex min-w-0 flex-col">
            <span className="text-xs opacity-80">{next}</span>
            <span
              role="timer"
              aria-live="off"
              className="text-[26px] leading-tight font-extrabold tabular-nums"
            >
              {formatClock(left)}
            </span>
          </div>
        )}
        {!over && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => onChange(new Date(Date.parse(endsAt) + 30_000).toISOString())}
              className="min-h-11 rounded-[10px] border border-background/40 px-3 font-semibold"
            >
              {t("session.plus30")}
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="min-h-11 rounded-[10px] border border-background/40 px-3 font-semibold"
            >
              {t("session.skip")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
