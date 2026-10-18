import "@/i18n/lazy";
import { toISODate } from "@belay/shared/body/dates";
import { exerciseById } from "@belay/shared/exercises/catalog";
import type { Measure } from "@belay/shared/exercises/library";
import type { Activity } from "@belay/shared/training/activities";
import { planFor } from "@belay/shared/training/plan";
import { estimatedMinutes, plannedWorkSets, sessionByCode } from "@belay/shared/training/program";
import { type History, lastFinished, lastTopSet, openWorkout } from "@belay/shared/training/rules";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { groupCard, RowLink } from "@/components/grouped-list";
import { BackLink, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { formatWeekday, sessionTitle } from "@/lib/format";
import { useToday } from "@/lib/today";
import { type OpenAccount, useAccount, useActivities, useHistory } from "@/sync/account";
import { formatDuration, formatLoad, formatRir, formatSets } from "@/workouts/format";

// A session of the program before it starts: what it holds today, how long it
// takes, how it went last time, and the one action that starts it. Without an account it reads
// the same, with nothing to start.
export function SessionPreview() {
  const account = useAccount();
  if (account.kind === "loading") return null;
  return account.kind === "open" ? (
    <WithData account={account} />
  ) : (
    <Preview history={null} activities={[]} />
  );
}

function WithData({ account }: { account: OpenAccount }) {
  const history = useHistory(account).data;
  const activities = useActivities(account).data;
  if (!history || !activities) return null;
  return <Preview history={history} activities={activities} />;
}

function Preview({
  history,
  activities,
}: {
  history: History | null;
  activities: readonly Activity[];
}) {
  const { t, i18n } = useTranslation();
  const { code } = useParams({ from: "/workouts/session/$code" });
  const { from } = useSearch({ from: "/workouts/session/$code" });
  const today = useToday();
  const listId = useId();
  // The route lets only a known code through.
  const plan = planFor(sessionByCode(code)!, activities, today);
  const last = history && lastFinished(history.workouts, code);
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
        title={sessionTitle(code, t)}
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
        (open && open.sessionCode !== code ? (
          <div className="flex flex-col gap-3">
            <p className="text-body">
              {t("preview.otherOpen", { title: sessionTitle(open.sessionCode, t) })}
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
                  leading={<RowNumber n={i + 1} />}
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

// The 28 px tile that numbers a row.
function RowNumber({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="grid size-7 place-items-center rounded-icon bg-track text-[13px] font-semibold text-muted-foreground tabular-nums"
    >
      {n}
    </span>
  );
}
