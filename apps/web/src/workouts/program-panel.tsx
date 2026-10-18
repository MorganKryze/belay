import type { ISODate } from "@belay/shared/body/dates";
import type { Activity } from "@belay/shared/training/activities";
import { planFor } from "@belay/shared/training/plan";
import {
  estimatedMinutes,
  nextSession,
  type SessionTemplate,
  starterProgram,
} from "@belay/shared/training/program";
import { type History, openWorkout } from "@belay/shared/training/rules";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { sessionTitle } from "@/lib/format";
import { useToday } from "@/lib/today";
import { type OpenAccount, useActivities, useHistory } from "@/sync/account";
import { dayOf } from "./history-panel";

const card = "rounded-card border border-border bg-card px-4 py-3";

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
  return ordered.map((s) => (
    <SessionCard
      key={s.code}
      session={s}
      next={s.code === next}
      lastDay={history ? lastDayOf(history, s.code) : undefined}
      activities={activities}
      today={today}
      action={
        open ? (open.sessionCode === s.code ? "resume" : null) : s.code === next ? "see" : null
      }
    />
  ));
}

// The day a session of this code last ended; null: never; undefined: no account.
function lastDayOf(history: History, code: string): ISODate | null {
  const last = history.workouts
    .filter((w) => w.sessionCode === code && w.endedAt !== null && !w.removed)
    .reduce<string | null>((l, w) => (l === null || w.startedAt > l ? w.startedAt : l), null);
  return last === null ? null : dayOf({ startedAt: last });
}

// Whole days between two calendar days (UTC midnights: no daylight-saving shift).
const daysBetween = (from: ISODate, to: ISODate) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// "see": the next card's button to the preview; "resume": the open session's card; null: the
// whole card is a link to the preview.
function SessionCard({
  session,
  next,
  lastDay,
  activities,
  today,
  action,
}: {
  session: SessionTemplate;
  next: boolean;
  lastDay: ISODate | null | undefined;
  activities: readonly Activity[];
  today: ISODate;
  action: "see" | "resume" | null;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { code } = session;
  const plan = planFor(session, activities, today);
  const when = next
    ? t("workouts.program.next")
    : lastDay === undefined
      ? null
      : lastDay === null
        ? t("workouts.program.never")
        : lastDay === today
          ? t("workouts.program.today")
          : t("workouts.program.daysAgo", { count: daysBetween(lastDay, today) });
  const size = t("workouts.program.size", {
    count: plan.length,
    minutes: estimatedMinutes({ slots: plan }),
  });
  const heading = (
    <div className="flex flex-col">
      <h2 id={id} className="text-[17px] font-semibold">
        {sessionTitle(code, t)}
      </h2>
      {/* The space keeps the title and this line apart in the link's name. */}{" "}
      <p className="text-[13px] text-muted-foreground">
        {when && (
          <span className={next ? "font-semibold text-primary-ink" : undefined}>{when} · </span>
        )}
        {size}
      </p>
    </div>
  );
  if (action === null) {
    return (
      <Link
        to="/workouts/session/$code"
        params={{ code }}
        className={`${card} press-tint block outline-ring focus-visible:outline-2`}
      >
        {heading}
      </Link>
    );
  }
  return (
    <section aria-labelledby={id} className={`${card} flex flex-col gap-3`}>
      {heading}
      <Button asChild variant="primary">
        {action === "resume" ? (
          <Link to="/workout" search={{ start: code }}>
            {t("workouts.program.resume")}
          </Link>
        ) : (
          <Link to="/workouts/session/$code" params={{ code }}>
            {t("workouts.program.seeSession")}
          </Link>
        )}
      </Button>
    </section>
  );
}
