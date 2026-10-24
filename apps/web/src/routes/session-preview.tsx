import "@/i18n/lazy";
import { toISODate } from "@belay/shared/body/dates";
import { exerciseById } from "@belay/shared/exercises/catalog";
import type { Measure } from "@belay/shared/exercises/library";
import type { Activity } from "@belay/shared/training/activities";
import { planFor } from "@belay/shared/training/plan";
import { estimatedMinutes, plannedWorkSets } from "@belay/shared/training/program";
import { type History, lastFinished, lastTopSet, openWorkout } from "@belay/shared/training/rules";
import {
  type LetteredTemplate,
  type ProgramSession,
  startedAs,
} from "@belay/shared/training/stored-program";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { groupCard, NumberTile, RowLink } from "@/components/grouped-list";
import { LoopThumb } from "@/components/loop-thumb";
import { BackLink, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { formatWeekday, rotationTitle, workoutTitle } from "@/lib/format";
import { readMedia } from "@/lib/media-flag";
import { useToday } from "@/lib/today";
import {
  type OpenAccount,
  useAccount,
  useActivities,
  useHistory,
  useProgram,
} from "@/sync/account";
import { formatDuration, formatLoad, formatRir, formatSets } from "@/workouts/format";
import { NotFound } from "./fallbacks";

// A session of the active program's rotation before it starts: what it holds today, how long it
// takes, how it went last time, and the one action that starts it. Without an account it reads
// the starting program the same way, with nothing to start. A letter the rotation does not hold
// (a session set aside or removed, or an old link) is not found.
export function SessionPreview() {
  const account = useAccount();
  if (account.kind === "loading") return null;
  return account.kind === "open" ? <WithData account={account} /> : <WithoutAccount />;
}

function WithData({ account }: { account: OpenAccount }) {
  const history = useHistory(account).data;
  const activities = useActivities(account).data;
  const program = useProgram(account).data;
  if (!history || !activities || !program) return null;
  return (
    <Preview
      history={history}
      activities={activities}
      rotation={program.rotation}
      sessions={program.programs.sessions}
    />
  );
}

function WithoutAccount() {
  const program = useProgram(null).data;
  return program ? (
    <Preview
      history={null}
      activities={[]}
      rotation={program.rotation}
      sessions={program.programs.sessions}
    />
  ) : null;
}

function Preview({
  history,
  activities,
  rotation,
  sessions,
}: {
  history: History | null;
  activities: readonly Activity[];
  rotation: readonly LetteredTemplate[];
  sessions: readonly ProgramSession[];
}) {
  const { t, i18n } = useTranslation();
  const { code } = useParams({ from: "/workouts/session/$code" });
  const { from } = useSearch({ from: "/workouts/session/$code" });
  const today = useToday();
  const listId = useId();
  // Where the instance serves loops, each row's still takes a 44 px place and the row's padding
  // gives way, so the row stays 56 px; elsewhere the rows are as they were.
  const media = readMedia() === "on";
  const session = rotation.find((s) => s.code === code);
  if (!session) return <NotFound />;
  const plan = planFor(session, activities, today);
  const last = history && lastFinished(history.workouts, session);
  const open = history && openWorkout(history.workouts, { sets: history.sets, now: new Date() });
  const top = (exerciseId: string, measure: Measure) =>
    history && lastTopSet(history, exerciseId, measure);
  // Replaced, so lowering the session lands where the preview was opened from.
  const startLink = (start: string, label: string) => (
    <Button asChild className="w-full">
      <Link to="/workout" search={{ start }} replace>
        <Play aria-hidden className="size-5" />
        {label}
      </Link>
    </Button>
  );

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title={rotationTitle(session, t)}
        back={
          from === "home" ? (
            <BackLink to="/">{t("nav.home")}</BackLink>
          ) : (
            <BackLink to="/workouts" search={{ tab: "program" }}>
              {t("workouts.tabs.program")}
            </BackLink>
          )
        }
      >
        <p className="text-body text-muted-foreground">
          {t("preview.size", {
            count: plan.length,
            sets: plannedWorkSets(plan),
            minutes: estimatedMinutes({ slots: plan }),
          })}
        </p>
        {last && (
          <p className="text-body text-muted-foreground">
            {t("preview.last", {
              day: formatWeekday(toISODate(new Date(last.startedAt)), i18n.language, today, {
                startOfLine: false,
                long: true,
              }),
              duration: formatDuration(Date.parse(last.endedAt) - Date.parse(last.startedAt), t),
            })}
          </p>
        )}
      </PageHeader>
      {history &&
        (open && !startedAs(open, session) ? (
          <div className="flex flex-col gap-3">
            <p className="text-body">
              {t("preview.otherOpen", { title: workoutTitle(open, sessions, t) })}
            </p>
            {startLink(open.sessionCode, t("preview.resumeOther"))}
          </div>
        ) : (
          startLink(code, t(open ? "preview.resume" : "preview.start"))
        ))}
      <section aria-labelledby={listId} className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3 px-4">
          <h2 id={listId} className="text-section text-muted-foreground">
            {t("preview.exercises")}
          </h2>
          <span className="truncate text-section text-muted-foreground">
            {t("preview.columns")}
          </span>
        </div>
        <ul className={groupCard}>
          {plan.map((slot, i) => {
            const best = top(slot.exerciseId, slot.measure ?? "reps");
            return (
              <li key={i}>
                <RowLink
                  to="/exercises/$exerciseId"
                  params={{ exerciseId: slot.exerciseId }}
                  search={{ session: code, ...(from && { from }) }}
                  className={media ? "py-1.5" : undefined}
                  leading={
                    media ? (
                      <LoopThumb exerciseId={slot.exerciseId} fallback={<NumberTile n={i + 1} />} />
                    ) : (
                      <NumberTile n={i + 1} />
                    )
                  }
                  label={exerciseById(slot.exerciseId)?.name ?? slot.exerciseId}
                  sub={[
                    formatSets(slot),
                    formatRir(slot, t),
                    ...(best ? [formatLoad(best, t, i18n.language)] : []),
                  ].join(" · ")}
                />
              </li>
            );
          })}
        </ul>
        <p className="px-4 text-(length:--text-secondary) leading-(--text-secondary--line-height) text-muted-foreground">
          {t("preview.note")}
        </p>
      </section>
    </section>
  );
}
