import type { ISODate } from "@belay/shared/body/dates";
import { exerciseById } from "@belay/shared/exercises/catalog";
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
import { formatSets, groupKind } from "./format";
import { dayOf } from "./history-panel";
import { seeList } from "./tabs";

const card = "rounded-card border border-border bg-card";

// Program (spec D13, §4.5): the sessions as cards, the next one first with Start; the others say
// when each was last done, with See (its slots, read only) and Start. While a session is open,
// every card offers to resume it instead. Without an account, the program reads the same, with
// nothing to start.
// The sessions opened with See live in the URL (`see`), so Back from an exercise finds them open.
export function ProgramPanel({
  account,
  see,
  onSee,
}: {
  account: OpenAccount | null;
  see: string | undefined;
  onSee: (code: string, open: boolean) => void;
}) {
  const { t } = useTranslation();
  const opened = { see, onSee };
  return (
    <div className="flex flex-col gap-3">
      {account ? (
        <Cards account={account} {...opened} />
      ) : (
        <List history={null} activities={[]} {...opened} />
      )}
      <p className="mx-0.5 text-sm text-muted-foreground">{t("workouts.program.editNote")}</p>
    </div>
  );
}

type Opened = { see: string | undefined; onSee: (code: string, open: boolean) => void };

function Cards({ account, ...opened }: { account: OpenAccount } & Opened) {
  const history = useHistory(account).data;
  const activities = useActivities(account).data;
  if (!history || !activities) return null;
  return <List history={history} activities={activities} {...opened} />;
}

function List({
  history,
  activities,
  see,
  onSee,
}: {
  history: History | null;
  activities: readonly Activity[];
} & Opened) {
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
      start={history ? (open?.sessionCode ?? s.code) : null}
      resume={open !== null}
      see={see}
      seeing={seeList(see).includes(s.code)}
      onSee={(seeing) => onSee(s.code, seeing)}
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

function SessionCard({
  session,
  next,
  lastDay,
  activities,
  today,
  start,
  resume,
  see,
  seeing,
  onSee,
}: {
  session: SessionTemplate;
  next: boolean;
  lastDay: ISODate | null | undefined;
  activities: readonly Activity[];
  today: ISODate;
  start: string | null; // the session Start opens; null: nothing to start (no account)
  resume: boolean;
  see: string | undefined;
  seeing: boolean;
  onSee: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
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
  const startButton = start !== null && (
    <Button asChild variant={next && !resume ? "primary" : "secondary"} className="flex-1">
      <Link to="/workout" search={{ start }}>
        {resume ? t("workouts.program.resume") : t("workouts.program.start")}
      </Link>
    </Button>
  );
  return (
    <section aria-labelledby={id} className={`${card} flex flex-col gap-3 px-4 py-3`}>
      <div className="flex flex-col">
        <h2 id={id} className="text-[17px] font-semibold">
          {sessionTitle(session.code, t)}
        </h2>
        <p className="text-[13px] text-muted-foreground">
          {when && (
            <span className={next ? "font-semibold text-primary-ink" : undefined}>{when} · </span>
          )}
          {size}
        </p>
      </div>
      {seeing && (
        <ul className="flex flex-col">
          {plan.map((slot, i) => {
            const kind = groupKind(plan, i);
            return (
              <li key={i} className="border-t border-border">
                <Link
                  to="/exercises/$exerciseId"
                  params={{ exerciseId: slot.exerciseId }}
                  search={{ from: "program", see }}
                  className="press-tint flex min-h-14 flex-col justify-center py-2"
                >
                  <span className="font-medium">{exerciseById(slot.exerciseId)?.name}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {formatSets(slot)}
                    {kind && ` · ${t(`workouts.program.${kind}`)}`}
                    {slot.rule && ` · ${t("workouts.program.noClimbing")}`}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex gap-2">
        {(!next || start === null) && (
          <Button
            variant="secondary"
            aria-expanded={seeing}
            className="flex-1"
            onClick={() => onSee(!seeing)}
          >
            {t(seeing ? "workouts.program.hide" : "workouts.program.see")}
          </Button>
        )}
        {startButton}
      </div>
    </section>
  );
}
