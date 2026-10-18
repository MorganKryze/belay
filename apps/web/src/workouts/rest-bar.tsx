import { type PauseStops, restClock } from "@belay/shared/training/pause";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatClock, useNow } from "./hooks";

// §4.3: the rest, counted down from its end time (right even after the app slept), +30 s and
// Skip. At zero: a short vibration where the phone can, "Back to it", a polite announcement,
// and the bar goes at the next tap anywhere. The countdown is a timer never read out each second.
// The line along the bottom is the rest left out of the rest planned: data set on each tick, never
// an animation. Measured against the plan, not the time since the set, so a resume that moves the
// end later leaves it where it stood; +30 s past the plan fills it again.
export function RestBar({
  endsAt,
  planned,
  next,
  pausedAt,
  stops,
  onChange,
}: {
  endsAt: string;
  planned: number; // the rest planned after the last work set, in ms
  next: string; // "Rest · set 3 next"
  pausedAt: string | null;
  stops: PauseStops; // a pause that stops everything holds the rest left where it stood
  onChange: (endsAt: string | null) => void;
}) {
  const { t } = useTranslation();
  const now = restClock(pausedAt, useNow(250), stops);
  const end = Date.parse(endsAt);
  const left = end - now;
  const over = left <= 0;
  const span = Math.max(planned, left);
  const fraction = span > 0 ? Math.min(1, Math.max(0, left / span)) : over ? 0 : 1;
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

  const action =
    "press grid min-h-11 place-items-center rounded-[12px] bg-background/15 px-3.5 text-sm font-semibold whitespace-nowrap";
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <p role="status" className="sr-only">
        {announced ? t("session.restOver") : ""}
      </p>
      <div className="relative flex min-h-17 animate-rise-in items-center justify-between gap-2 overflow-hidden rounded-[22px] bg-foreground py-3 pr-3 pl-4 text-background">
        {over ? (
          <span className="text-lg font-bold">{t("session.backToIt")}</span>
        ) : (
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-xs opacity-80">{next}</span>
            <span
              role="timer"
              aria-live="off"
              className="text-[30px] leading-tight font-bold tracking-tight tabular-nums"
            >
              {formatClock(left)}
            </span>
          </div>
        )}
        {!over && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => onChange(new Date(end + 30_000).toISOString())}
              className={action}
            >
              {t("session.plus30")}
            </button>
            <button type="button" onClick={() => onChange(null)} className={action}>
              {t("session.skip")}
            </button>
          </div>
        )}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1 origin-left bg-toast-icon"
          style={{ transform: `scaleX(${fraction})` }}
        />
      </div>
    </div>
  );
}
