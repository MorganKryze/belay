import type { ISODate } from "@belay/shared/body/dates";
import { planFor } from "@belay/shared/training/plan";
import {
  estimatedMinutes,
  nextSession,
  plannedWorkSets,
  sessionByCode,
} from "@belay/shared/training/program";
import { finishedOn, openWorkout, workSetsOf } from "@belay/shared/training/rules";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { formatMinutes } from "@/lib/activities";
import { sessionTitle } from "@/lib/format";
import { type OpenAccount, useActivities, useHistory } from "@/sync/account";
import { SessionCard } from "./session-card";

// Accueil's session: the one open and how far it is, else the one done today and the next one
// named quietly under it, else the next of the program. Session C
// counts the slots its rule adds in a week with no climbing. Nothing until the history and the
// activities are read, so the card never shows a state it does not know.
export function TodaySession({ account, today }: { account: OpenAccount; today: ISODate }) {
  const { t } = useTranslation();
  const history = useHistory(account).data;
  const activities = useActivities(account).data;
  if (!history || !activities) return null;
  const open = openWorkout(history.workouts, { sets: history.sets, now: new Date() });
  if (open) {
    const code = open.sessionCode;
    const done = workSetsOf(history, open.id);
    return (
      <SessionCard
        code={code}
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
  const code = nextSession(history.workouts);
  const done = finishedOn(history, today);
  if (done) {
    return (
      <SessionCard
        code={done.workout.sessionCode}
        done
        detail={`${t("sessionCard.doneToday")} · ${t("sessionCard.doneLine", {
          duration: formatMinutes(Math.round(done.durationMs / 60_000), t),
          count: done.workSets,
        })}`}
      >
        <Link
          to="/workouts/session/$code"
          params={{ code }}
          search={{ from: "home" }}
          className="press-tint -mx-4 -mb-3 flex min-h-12 items-center gap-2 rounded-b-card border-t border-border px-4 text-muted-foreground outline-ring focus-visible:outline-2"
        >
          <span className="flex-1">
            {t("sessionCard.nextLink")}{" "}
            <b className="font-semibold text-foreground">{sessionTitle(code, t)}</b>
          </span>
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      </SessionCard>
    );
  }
  const session = sessionByCode(code);
  if (!session) return null;
  const plan = planFor(session, activities, today);
  return (
    <SessionCard
      code={code}
      lead={t("sessionCard.next")}
      detail={t("sessionCard.size", {
        count: plan.length,
        minutes: estimatedMinutes({ slots: plan }),
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
