import "@/i18n/lazy";
import { exerciseById } from "@belay/shared/exercises/catalog";
import { sessionProgress } from "@belay/shared/training/rules";
import type { Workout, WorkoutSet } from "@belay/shared/training/workout";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type OpenAccount, useSessionView } from "@/sync/account";
import { formatClock, useNow } from "@/workouts/hooks";

// The open session above the tabs: the exercise holding the next set, where the session stands
// and the time since it started, or the rest counted down while one runs. It loads on demand, so
// the catalogue stays out of the shell.
export function SessionBar({
  account,
  workout,
  sets,
  leaving = false,
  onAnimationEnd,
}: {
  account: OpenAccount;
  workout: Workout;
  sets: readonly WorkoutSet[];
  leaving?: boolean;
  onAnimationEnd?: () => void;
}) {
  const { t } = useTranslation();
  // Its own clock, so the shell around it does not render again on each tick. A quarter second,
  // as the session's rest bar, so the end of a rest shows when it comes.
  const now = useNow(250);
  // The rest lives in this device's open session, only for this session.
  const active = useSessionView(account).data?.active;
  const end =
    active?.workoutId === workout.id && active.restEndsAt ? Date.parse(active.restEndsAt) : null;
  const resting = end !== null && end > now;
  const announced = useRestOver(end, resting);
  const { next } = sessionProgress(workout.plan, sets);
  const code = workout.sessionCode;
  const slot = next && workout.plan[next.slotIndex];
  const running = t(resting ? "sessionBar.rest" : "sessionBar.running");
  const letter = t("sessionBar.session", { code });
  // The 13 px step: a bare `text-secondary` is the colour token of the same name. Muted through
  // opacity, since no muted colour token reads on the foreground-coloured backing.
  const status =
    "truncate text-(length:--text-secondary) leading-(--text-secondary--line-height) opacity-80";
  return (
    <>
      {/* Beside the link, so its name never takes the announcement in. */}
      <span role="status" className="sr-only">
        {announced ? t("session.restOver") : ""}
      </span>
      <Link
        to="/workout"
        // Takes up the open session, as Home's session row does, on a device that never had it.
        search={{ start: code }}
        onAnimationEnd={onAnimationEnd}
        className={`${leaving ? "animate-fade-out" : "animate-session-bar-in"} press flex min-h-13 w-full items-center gap-2.5 rounded-card bg-foreground py-1 pr-0 pl-3.5 text-background lg:hidden`}
      >
        <span className="flex min-w-0 flex-1 flex-col text-sm leading-tight">
          {slot ? (
            <>
              <span className="truncate font-semibold">
                {exerciseById(slot.exerciseId)?.name ?? slot.exerciseId}
              </span>
              <span className={`hidden ${status} min-[390px]:block`}>
                {[
                  running,
                  t("sessionBar.setOf", { n: next.round + 1, total: slot.sets }),
                  letter,
                ].join(" · ")}
              </span>
              <span className={`${status} min-[390px]:hidden`}>
                {[running, t("sessionBar.setShort", { n: next.round + 1, total: slot.sets })].join(
                  " · ",
                )}
              </span>
            </>
          ) : (
            <>
              <span className="truncate font-semibold">{letter}</span>
              <span className={status}>{running}</span>
            </>
          )}
        </span>
        <span className="flex items-center gap-1.5 font-bold tabular-nums">
          <Timer aria-hidden className="size-5 text-toast-icon" />
          {resting ? (
            // A timer never read out each second.
            <span role="timer" aria-live="off">
              {formatClock(end - now)}
            </span>
          ) : (
            formatClock(now - Date.parse(workout.startedAt), Math.floor)
          )}
        </span>
        <span aria-hidden className="grid size-11 place-items-center">
          <ChevronRight className="size-5" />
        </span>
      </Link>
    </>
  );
}

// The rest's end as the session's rest bar marks it: a short vibration where the phone can and a
// polite « Rest over », once, when the countdown crosses zero while the bar is up. A bar shown
// after the rest ended, or a rest put away early, says nothing.
function useRestOver(end: number | null, resting: boolean): boolean {
  const [announced, setAnnounced] = useState(false);
  const running = useRef<number | null>(null);
  useEffect(() => {
    if (resting) {
      running.current = end;
      setAnnounced(false);
      return;
    }
    if (end !== null && running.current === end) {
      navigator.vibrate?.(200);
      setAnnounced(true);
    }
    running.current = null;
  }, [end, resting]);
  return announced;
}
