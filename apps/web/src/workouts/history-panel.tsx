import { type ISODate, toISODate } from "@belay/shared/body/dates";
import type { Activity } from "@belay/shared/training/activities";
import type { Workout } from "@belay/shared/training/workout";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Plus } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { type Entry, Toast, useWriter } from "@/components/weigh-in";
import { activityText } from "@/lib/activities";
import { formatWeekday, sessionTitle } from "@/lib/format";
import { useToday } from "@/lib/today";
import { type OpenAccount, useAccount, useActivities, useHistory, useSteps } from "@/sync/account";
import { formatDuration } from "./format";
import { LogSessionSheet } from "./log-session-sheet";
import { MonthCalendar } from "./month-calendar";

const ActivitySheet = lazy(() =>
  import("@/components/activity-sheet").then((m) => ({ default: m.ActivitySheet })),
);

// A session belongs to the day it started, where the person is: one begun at 23:30 and
// finished after midnight stays on its first day.
export const dayOf = (w: Pick<Workout, "startedAt">): ISODate => toISODate(new Date(w.startedAt));

// History (§4.4): the month's calendar, then the sessions and activities of that month, newest
// first; a session logged afterwards from here, an activity reopened in its sheet.
export function HistoryPanel() {
  const { t } = useTranslation();
  const account = useAccount();
  if (account.kind === "open") return <History account={account} />;
  return (
    <div className="flex flex-col gap-4">
      {account.kind === "unavailable" && <p>{t("account.unavailable")}</p>}
      {account.kind === "signed-out" && (
        <>
          <p>{t("history.signedOut")}</p>
          <Button asChild className="self-start">
            <a href={`/auth/login?returnTo=${encodeURIComponent("/workouts")}`}>
              {t("home.signIn")}
            </a>
          </Button>
        </>
      )}
    </div>
  );
}

function History({ account }: { account: OpenAccount }) {
  const { t, i18n } = useTranslation();
  const today = useToday();
  const current = today.slice(0, 7);
  const [month, setMonth] = useState(current);
  const history = useHistory(account).data;
  const activities = useActivities(account).data;
  const steps = useSteps(account).data ?? [];
  const navigate = useNavigate();
  const { write, toast, error, clearError, dismiss } = useWriter(account);
  const [logging, setLogging] = useState(false);
  const [opened, setOpened] = useState<ISODate | null>(null); // the day of the activity sheet
  if (!history || !activities) return null;
  const finished = history.workouts
    .filter((w) => !w.removed && w.endedAt !== null)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  // The month's sessions and activities, newest day first; on one day, the sessions (newest
  // first, as they come) before the activities. The sort keeps that order inside a day.
  type Item = { day: ISODate; workout: Workout } | { day: ISODate; activity: Activity };
  const items: Item[] = [
    ...finished.map((w) => ({ day: dayOf(w), workout: w })),
    ...activities.map((a) => ({ day: a.date, activity: a })),
  ]
    .filter((i) => i.day.startsWith(month))
    .sort((a, b) => (a.day === b.day ? 0 : a.day < b.day ? 1 : -1));
  const close = () => {
    setOpened(null);
    clearError();
  };
  const [y, m] = month.split("-").map(Number) as [number, number];
  const monthName = new Intl.DateTimeFormat(i18n.language, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
  const line = "flex min-h-15 w-full items-center justify-between gap-3 py-2 text-left";
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => setLogging(true)}
        className="-mr-1 inline-flex min-h-11 items-center gap-1 self-end px-1 font-semibold text-primary"
      >
        <Plus aria-hidden className="size-4" />
        {t("history.log.button")}
      </button>
      <MonthCalendar
        month={month}
        current={current}
        marked={new Set(finished.map(dayOf))}
        circled={new Set(activities.map((a) => a.date))}
        onMonth={setMonth}
      />
      <section aria-labelledby="sessions" className="flex flex-col">
        <h2 id="sessions" className="mx-0.5 text-[15px] font-semibold first-letter:uppercase">
          {month === current ? t("history.recent") : monthName}
        </h2>
        {items.length === 0 ? (
          <p className="mx-0.5 mt-2 text-sm text-muted-foreground">
            {finished.length === 0 ? t("history.first") : t("history.none")}
          </p>
        ) : (
          <ul className="flex flex-col">
            {items.map((item) => (
              <li
                key={"workout" in item ? item.workout.id : item.activity.id}
                className="border-t border-border first:border-t-0"
              >
                {"workout" in item ? (
                  <Link
                    to="/workouts/$workoutId"
                    params={{ workoutId: item.workout.id }}
                    className={line}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="font-semibold">
                        {formatWeekday(item.day, i18n.language, today)}
                      </span>
                      <span className="truncate text-[13px] text-muted-foreground">
                        {sessionTitle(item.workout.sessionCode, t)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 font-semibold tabular-nums">
                      {formatDuration(
                        Date.parse(item.workout.endedAt!) - Date.parse(item.workout.startedAt),
                        t,
                      )}
                      <ChevronRight aria-hidden className="size-5 text-muted-foreground" />
                    </span>
                  </Link>
                ) : (
                  <button type="button" className={line} onClick={() => setOpened(item.day)}>
                    <span className="flex min-w-0 flex-col">
                      <span className="font-semibold">
                        {formatWeekday(item.day, i18n.language, today)}
                      </span>
                      <span className="truncate text-[13px] text-muted-foreground">
                        {activityText(item.activity, t)}
                      </span>
                    </span>
                    <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {logging && (
        <LogSessionSheet
          today={today}
          workouts={history.workouts}
          activities={activities}
          onClose={() => setLogging(false)}
          onOpen={(code, date, minutes) =>
            void navigate({ to: "/workout/edit", search: { code, date, minutes } })
          }
        />
      )}
      <Suspense fallback={null}>
        {opened && (
          <ActivitySheet
            onClose={close}
            activities={activities}
            steps={steps}
            today={today}
            date={opened}
            onDate={setOpened}
            onWrite={(entries: Entry[], previous: Entry[], kind) =>
              void write(entries, previous, t(`today.activityToast.${kind}`)).then(
                (ok) => ok && close(),
              )
            }
            error={error}
          />
        )}
      </Suspense>
      <Toast toast={toast} onDone={dismiss} />
    </div>
  );
}
