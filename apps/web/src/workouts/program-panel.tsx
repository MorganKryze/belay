import type { ISODate } from "@belay/shared/body/dates";
import type { Activity } from "@belay/shared/training/activities";
import { planFor } from "@belay/shared/training/plan";
import {
  estimatedMinutes,
  nextSession,
  plannedWorkSets,
  type SessionTemplate,
  starterProgram,
} from "@belay/shared/training/program";
import { type History, lastFinished, liveSets, openWorkout } from "@belay/shared/training/rules";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { SessionCard, SessionHeading } from "@/components/session-card";
import { cardSurface } from "@/components/surfaces";
import { Button } from "@/components/ui/button";
import { useToday } from "@/lib/today";
import { type OpenAccount, useActivities, useHistory } from "@/sync/account";
import { dayOf } from "./history-panel";

// Program (spec D13, §4.5): the sessions as cards, the next one first with « See the session »;
// every other card opens its session's preview on a tap anywhere. While a session is open, its
// card resumes it and the others open their preview, which says what is open. Without an
// account nothing is next, so every card opens its preview.
export function ProgramPanel({ account }: { account: OpenAccount | null }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3">
      {account ? <Cards account={account} /> : <List history={null} activities={[]} />}
      <p className="mx-0.5 text-sm text-muted-foreground">{t("workouts.program.editNote")}</p>
    </div>
  );
}

function Cards({ account }: { account: OpenAccount }) {
  const history = useHistory(account).data;
  const activities = useActivities(account).data;
  if (!history || !activities) return null;
  return <List history={history} activities={activities} />;
}

function List({
  history,
  activities,
}: {
  history: History | null;
  activities: readonly Activity[];
}) {
  const today = useToday();
  const next = history ? nextSession(history.workouts) : null;
  const open = history
    ? openWorkout(history.workouts, { sets: history.sets, now: new Date() })
    : null;
  // The next session first, then the program's order from there.
  const at = Math.max(
    0,
    starterProgram.findIndex((s) => s.code === next),
  );
  const ordered = [...starterProgram.slice(at), ...starterProgram.slice(0, at)];
  // How far the open session is: its work sets logged over the ones its plan holds.
  const progress =
    history && open
      ? {
          count: liveSets(history).filter((s) => s.workoutId === open.id && !s.warmup).length,
          total: plannedWorkSets(open.plan),
        }
      : null;
  return ordered.map((s) => (
    <ProgramCard
      key={s.code}
      session={s}
      next={s.code === next}
      lastDay={history ? lastDayOf(history, s.code) : undefined}
      activities={activities}
      today={today}
      action={
        open ? (open.sessionCode === s.code ? "resume" : null) : s.code === next ? "see" : null
      }
      progress={progress}
    />
  ));
}

// The day a session of this code last ended; null: never; undefined: no account.
function lastDayOf(history: History, code: string): ISODate | null {
  const last = lastFinished(history.workouts, code);
  return last === null ? null : dayOf(last);
}

// Whole days between two calendar days (UTC midnights: no daylight-saving shift).
const daysBetween = (from: ISODate, to: ISODate) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// "see": the next card's button to the preview; "resume": the open session's card, with how far
// it is; null: the whole card is a link to the preview.
function ProgramCard({
  session,
  next,
  lastDay,
  activities,
  today,
  action,
  progress,
}: {
  session: SessionTemplate;
  next: boolean;
  lastDay: ISODate | null | undefined;
  activities: readonly Activity[];
  today: ISODate;
  action: "see" | "resume" | null;
  progress: { count: number; total: number } | null;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { code } = session;
  const plan = planFor(session, activities, today);
  const size = t("sessionCard.size", {
    count: plan.length,
    minutes: estimatedMinutes({ slots: plan }),
  });
  if (action === "resume" && progress) {
    return (
      <SessionCard
        code={code}
        lead={t("sessionCard.inProgress")}
        detail={t("sessionCard.sets", progress)}
      >
        <Button asChild variant="primary">
          <Link to="/workout" search={{ start: code }}>
            {t("sessionCard.resume")}
          </Link>
        </Button>
      </SessionCard>
    );
  }
  if (action === "see") {
    return (
      <SessionCard code={code} lead={next ? t("sessionCard.next") : undefined} detail={size}>
        <Button asChild variant="primary">
          <Link to="/workouts/session/$code" params={{ code }}>
            {t("sessionCard.see")}
          </Link>
        </Button>
      </SessionCard>
    );
  }
  const when = next
    ? t("sessionCard.next")
    : lastDay === undefined
      ? null
      : lastDay === null
        ? t("workouts.program.never")
        : lastDay === today
          ? t("sessionCard.doneToday")
          : t("workouts.program.daysAgo", { count: daysBetween(lastDay, today) });
  return (
    <Link
      to="/workouts/session/$code"
      params={{ code }}
      className={`${cardSurface} press-tint block px-4 py-3 outline-ring focus-visible:outline-2`}
    >
      <SessionHeading
        id={id}
        code={code}
        lead={next ? when! : undefined}
        detail={when && !next ? `${when} · ${size}` : size}
      />
    </Link>
  );
}
