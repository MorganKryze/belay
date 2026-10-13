import "@/i18n/lazy";
import { exerciseById } from "@belay/shared/exercises/catalog";
import { sessionProgress } from "@belay/shared/training/rules";
import type { Workout, WorkoutSet } from "@belay/shared/training/workout";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatClock, useNow } from "@/workouts/hooks";

// The open session above the tabs: the exercise holding the next set, where the session stands
// and the time since it started. It loads on demand, so the catalogue stays out of the shell.
export function SessionBar({
  workout,
  sets,
  leaving = false,
  onAnimationEnd,
}: {
  workout: Workout;
  sets: readonly WorkoutSet[];
  leaving?: boolean;
  onAnimationEnd?: () => void;
}) {
  const { t } = useTranslation();
  // Its own clock, so the shell around it does not render again every second.
  const now = useNow();
  const { next } = sessionProgress(workout.plan, sets);
  const code = workout.sessionCode;
  const slot = next && workout.plan[next.slotIndex];
  const running = t("sessionBar.running");
  const letter = t("sessionBar.session", { code });
  return (
    <Link
      to="/workout"
      // Takes up the open session, as Home's session row does, on a device that never had it.
      search={{ start: code }}
      onAnimationEnd={onAnimationEnd}
      className={`${leaving ? "animate-fade-out" : "animate-rise-in"} flex min-h-13 w-full items-center gap-2.5 rounded-card bg-foreground py-1 pr-0 pl-3.5 text-background lg:hidden`}
    >
      <span className="flex min-w-0 flex-1 flex-col text-sm leading-tight">
        {slot ? (
          <>
            <span className="truncate font-semibold">
              {exerciseById(slot.exerciseId)?.name ?? slot.exerciseId}
            </span>
            <span className="hidden truncate text-secondary opacity-80 min-[390px]:block">
              {[
                running,
                t("sessionBar.setOf", { n: next.round + 1, total: slot.sets }),
                letter,
              ].join(" · ")}
            </span>
            <span className="truncate text-secondary opacity-80 min-[390px]:hidden">
              {[running, t("sessionBar.setShort", { n: next.round + 1, total: slot.sets })].join(
                " · ",
              )}
            </span>
          </>
        ) : (
          <>
            <span className="truncate font-semibold">{letter}</span>
            <span className="truncate text-secondary opacity-80">{running}</span>
          </>
        )}
      </span>
      <span className="flex items-center gap-1.5 font-bold tabular-nums">
        <Timer aria-hidden className="size-5 text-toast-icon" />
        {formatClock(now - Date.parse(workout.startedAt), Math.floor)}
      </span>
      <span aria-hidden className="grid size-11 place-items-center">
        <ChevronRight className="size-5" />
      </span>
    </Link>
  );
}
