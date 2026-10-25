import { addDays, type ISODate } from "@belay/shared/body/dates";
import { planFor } from "@belay/shared/training/plan";
import { estimatedMinutes, plannedWorkSets } from "@belay/shared/training/program";
import { finishedOn, openWorkout, workSetsOf } from "@belay/shared/training/rules";
import { dayPlan } from "@belay/shared/training/schedule";
import type { LetteredTemplate } from "@belay/shared/training/stored-program";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { formatMinutes } from "@/lib/activities";
import { rotationTitle, weekdayName, whenText, workoutTitle } from "@/lib/format";
import { type OpenAccount, useActivities, useHistory, useProgram } from "@/sync/account";
import { SessionCard } from "./session-card";

// Accueil's session: the one open and how far it is, else the one done today and the next one
// named quietly under it, else what the active program asks of today. In rotation, the next of
// the rotation; on fixed days, today's session while it is due, a rest day, or today's session
// already done since the previous session day, each with the next session day named under it.
// A session day that passed without its session is never mentioned. Session C counts the slots
// its rule adds in a week with no climbing. Nothing until the history, the activities and the
// programs are read, so the card never shows a state it does not know. With no active program, or
// a rotation that offers nothing, there is no next session to show.
export function TodaySession({ account, today }: { account: OpenAccount; today: ISODate }) {
  const { t, i18n } = useTranslation();
  const history = useHistory(account).data;
  const activities = useActivities(account).data;
  const program = useProgram(account).data;
  if (!history || !activities || !program) return null;
  const { sessions } = program.programs;
  const open = openWorkout(history.workouts, { sets: history.sets, now: new Date() });
  if (open) {
    const code = open.sessionCode;
    const done = workSetsOf(history, open.id);
    return (
      <SessionCard
        title={workoutTitle(open, sessions, t)}
        lead={t("sessionCard.inProgress")}
        detail={t("sessionCard.sets", { count: done, total: plannedWorkSets(open.plan) })}
      >
        <Button asChild variant="primary">
          <Link to="/workout" search={{ start: code }}>
            {t("sessionCard.resume")}
          </Link>
        </Button>
      </SessionCard>
    );
  }
  const lang = i18n.language;
  const plan = dayPlan(history.workouts, program.programs, program.rotation, today);
  const doneLine = (ms: number, count: number) =>
    t("sessionCard.doneLine", { duration: formatMinutes(Math.round(ms / 60_000), t), count });
  // The next session as every screen names it: on fixed days today's while it is due, else the
  // next session day's, said with its day.
  const ahead =
    plan.kind === "rotation"
      ? null
      : plan.kind === "due"
        ? { session: plan.session, day: today }
        : plan.next;
  const link = ahead ? (
    <NextLink
      label={t("sessionCard.whenLink", { when: whenText(ahead.day, today, lang, t) })}
      session={ahead.session}
    />
  ) : (
    plan.kind === "rotation" &&
    plan.next && <NextLink label={t("sessionCard.nextLink")} session={plan.next} />
  );
  const done = finishedOn(history, today);
  if (done) {
    return (
      <SessionCard
        title={workoutTitle(done.workout, sessions, t)}
        tile="done"
        detail={`${t("sessionCard.doneToday")} · ${doneLine(done.durationMs, done.workSets)}`}
      >
        {link}
      </SessionCard>
    );
  }
  if (plan.kind === "rest") {
    return (
      <SessionCard title={t("sessionCard.rest")} tile="rest" detail={t("sessionCard.restLine")}>
        {link}
      </SessionCard>
    );
  }
  if (plan.kind === "done") {
    const { workout, on } = plan;
    const when =
      on === addDays(today, -1)
        ? t("sessionCard.doneYesterday")
        : t("sessionCard.doneOn", { day: weekdayName(on, lang, { startOfLine: false }) });
    // Counted only once it ended, which the type cannot follow.
    const ms = Date.parse(workout.endedAt!) - Date.parse(workout.startedAt);
    return (
      <SessionCard
        title={rotationTitle(plan.session, t)}
        tile="done"
        detail={`${when} · ${doneLine(ms, workSetsOf(history, workout.id))}`}
      >
        {link}
      </SessionCard>
    );
  }
  const next = plan.kind === "due" ? plan.session : plan.next;
  if (!next) return null;
  const { code } = next;
  const slots = planFor(next, activities, today);
  return (
    <SessionCard
      title={rotationTitle(next, t)}
      lead={
        plan.kind === "due"
          ? t("sessionCard.due", { day: weekdayName(today, lang, { startOfLine: false }) })
          : t("sessionCard.next")
      }
      detail={t("sessionCard.size", {
        count: slots.length,
        minutes: estimatedMinutes({ slots }),
      })}
    >
      <Button asChild variant="primary">
        <Link to="/workouts/session/$code" params={{ code }} search={{ from: "home" }}>
          {t("sessionCard.see")}
        </Link>
      </Button>
    </SessionCard>
  );
}

// The next session named quietly under a card, after « La prochaine : » or its day; it opens the
// session's preview from Accueil.
function NextLink({ label, session }: { label: string; session: LetteredTemplate }) {
  const { t } = useTranslation();
  return (
    <Link
      to="/workouts/session/$code"
      params={{ code: session.code }}
      search={{ from: "home" }}
      className="press-tint -mx-4 -mb-3 flex min-h-12 items-center gap-2 rounded-b-card border-t border-border px-4 text-muted-foreground outline-ring focus-visible:outline-2"
    >
      <span className="flex-1">
        {label} <b className="font-semibold text-foreground">{rotationTitle(session, t)}</b>
      </span>
      <ChevronRight className="size-4" aria-hidden="true" />
    </Link>
  );
}
