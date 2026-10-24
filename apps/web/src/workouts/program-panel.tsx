import type { ISODate } from "@belay/shared/body/dates";
import type { Activity } from "@belay/shared/training/activities";
import { planFor } from "@belay/shared/training/plan";
import {
  estimatedMinutes,
  plannedWorkSets,
  type SessionTemplate,
} from "@belay/shared/training/program";
import { type History, lastFinished, openWorkout, workSetsOf } from "@belay/shared/training/rules";
import {
  type LetteredTemplate,
  nextInRotation,
  type StoredPrograms,
} from "@belay/shared/training/stored-program";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { SessionCard, SessionHeading } from "@/components/session-card";
import { cardSurface } from "@/components/surfaces";
import { Button } from "@/components/ui/button";
import { useToday } from "@/lib/today";
import { type OpenAccount, useActivities, useHistory, useProgram } from "@/sync/account";
import { dayOf } from "./history-panel";

// Program (spec D13, §4.5): the active program's rotation as cards, the next one first with « See
// the session »; every other card opens its session's preview on a tap anywhere. While a session
// is open, its card resumes it and the others open their preview, which says what is open.
// Without an account nothing is next, so every card opens the starting program's preview. A
// session set aside is not in the rotation, so it has no card; with no active program there is
// none at all.
export function ProgramPanel({ account }: { account: OpenAccount | null }) {
  const { t } = useTranslation();
  const program = useProgram(account).data;
  return (
    <div className="flex flex-col gap-3">
      {program &&
        (account ? (
          <Cards account={account} program={program} />
        ) : (
          <List history={null} activities={[]} {...program} />
        ))}
      <p className="mx-0.5 text-sm text-muted-foreground">{t("workouts.program.editNote")}</p>
    </div>
  );
}

// What useProgram reads: the programs and the active rotation, lettered.
interface ProgramRead {
  programs: StoredPrograms;
  rotation: readonly LetteredTemplate[];
}

function Cards({ account, program }: { account: OpenAccount; program: ProgramRead }) {
  const history = useHistory(account).data;
  const activities = useActivities(account).data;
  if (!history || !activities) return null;
  return <List history={history} activities={activities} {...program} />;
}

function List({
  history,
  activities,
  programs,
  rotation,
}: ProgramRead & {
  history: History | null;
  activities: readonly Activity[];
}) {
  const today = useToday();
  const next = history ? nextInRotation(history.workouts, rotation, programs.activeAt) : null;
  const open = history
    ? openWorkout(history.workouts, { sets: history.sets, now: new Date() })
    : null;
  // The next session first (one of the rotation's own), then the rotation's order from there.
  const at = next ? rotation.indexOf(next) : 0;
  const ordered = [...rotation.slice(at), ...rotation.slice(0, at)];
  // How far the open session is: its work sets logged over the ones its plan holds.
  const progress =
    history && open
      ? { count: workSetsOf(history, open.id), total: plannedWorkSets(open.plan) }
      : null;
  return ordered.map((s) => (
    <ProgramCard
      key={s.sessionId}
      session={s}
      next={s === next}
      lastDay={history ? lastDayOf(history, s.code) : undefined}
      activities={activities}
      today={today}
      see={!open && s === next}
      progress={open?.sessionCode === s.code ? progress : null}
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

// With progress: the open session's card, with how far it is; see: the next card's button to the
// preview; else the whole card is a link to the preview.
function ProgramCard({
  session,
  next,
  lastDay,
  activities,
  today,
  see,
  progress,
}: {
  session: SessionTemplate;
  next: boolean;
  lastDay: ISODate | null | undefined;
  activities: readonly Activity[];
  today: ISODate;
  see: boolean;
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
  if (progress) {
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
  if (see) {
    return (
      <SessionCard code={code} lead={t("sessionCard.next")} detail={size}>
        <Button asChild variant="primary">
          <Link to="/workouts/session/$code" params={{ code }}>
            {t("sessionCard.see")}
          </Link>
        </Button>
      </SessionCard>
    );
  }
  const when =
    lastDay === undefined
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
        lead={next ? t("sessionCard.next") : undefined}
        detail={when && !next ? `${when} · ${size}` : size}
      />
    </Link>
  );
}
