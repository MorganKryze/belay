import { type ISODate, toISODate } from "@belay/shared/body/dates";
import type { Activity } from "@belay/shared/training/activities";
import type { Workout } from "@belay/shared/training/workout";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Activity as ActivityIcon, Dumbbell, Plus } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  EmptyState,
  groupCard,
  groupSurface,
  RowButton,
  RowLink,
  sectionLabel,
} from "@/components/grouped-list";
import { Button } from "@/components/ui/button";
import { type Entry, Toast, useWriter } from "@/components/weigh-in";
import { activityText } from "@/lib/activities";
import { readHistoryActivities } from "@/lib/display-prefs";
import { formatWeekday, workoutTitle } from "@/lib/format";
import { useToday } from "@/lib/today";
import { cn } from "@/lib/utils";
import {
  type OpenAccount,
  useAccount,
  useActivities,
  useHistory,
  useProgram,
  useSteps,
} from "@/sync/account";
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
  // The month shown lives in the address (?month=), never past the current one; the current
  // month leaves it out.
  const asked = useSearch({ from: "/workouts" }).month;
  const month = asked && asked < current ? asked : current;
  // « Séances seules » keeps the history to gym sessions; read once, when the screen opens.
  const [withActivities] = useState(() => readHistoryActivities() === "shown");
  const history = useHistory(account).data;
  const activities = useActivities(account).data;
  const steps = useSteps(account).data ?? [];
  // Each session done is titled by the session it recorded: the list waits for the programs, or
  // a custom name would show as its bare letter for an instant.
  const sessions = useProgram(account).data?.programs.sessions;
  const navigate = useNavigate();
  const setMonth = (next: string) =>
    void navigate({
      to: "/workouts",
      search: (prev) => ({ tab: prev.tab, ...(next < current && { month: next }) }),
      replace: true,
    });
  const { write, toast, error, clearError, dismiss } = useWriter(account);
  const [logging, setLogging] = useState(false);
  const [opened, setOpened] = useState<ISODate | null>(null); // the day of the activity sheet
  // A saved sheet plays its exit over the screen that already shows the record.
  const [leaving, setLeaving] = useState(false);
  if (!history || !activities || !sessions) return null;
  const listed = withActivities ? activities : [];
  const finished = history.workouts
    .filter((w) => !w.removed && w.endedAt !== null)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  // The month's sessions and activities, newest day first; on one day, the sessions (newest
  // first, as they come) before the activities. The sort keeps that order inside a day.
  type Item = { day: ISODate; workout: Workout } | { day: ISODate; activity: Activity };
  const items: Item[] = [
    ...finished.map((w) => ({ day: dayOf(w), workout: w })),
    ...listed.map((a) => ({ day: a.date, activity: a })),
  ]
    .filter((i) => i.day.startsWith(month))
    .sort((a, b) => (a.day === b.day ? 0 : a.day < b.day ? 1 : -1));
  const close = () => {
    setOpened(null);
    setLeaving(false);
    clearError();
  };
  const [y, m] = month.split("-").map(Number) as [number, number];
  const monthName = new Intl.DateTimeFormat(i18n.language, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
  return (
    <div className="flex flex-col gap-4">
      <MonthCalendar
        month={month}
        current={current}
        marked={new Set(finished.map(dayOf))}
        circled={new Set(listed.map((a) => a.date))}
        activities={withActivities}
        onMonth={setMonth}
      />
      <ul className={groupCard}>
        <li>
          <RowButton
            icon={Plus}
            label={t("history.log.button")}
            sub={t("history.log.sub")}
            trailing="push"
            onClick={() => setLogging(true)}
          />
        </li>
      </ul>
      <section aria-labelledby="sessions" className="flex flex-col gap-2">
        <h2 id="sessions" className={`${sectionLabel} first-letter:uppercase`}>
          {month === current ? t("history.recent") : monthName}
        </h2>
        {items.length === 0 ? (
          finished.length === 0 ? (
            <div className={groupSurface}>
              <EmptyState
                sentence={t("history.first")}
                precision={t("history.firstHow")}
                action={null}
                quiet
              />
            </div>
          ) : (
            <p className={cn(groupSurface, "p-4 text-body text-muted-foreground")}>
              {t("history.none")}
            </p>
          )
        ) : (
          <ul className={groupCard}>
            {items.map((item) => (
              <li key={"workout" in item ? item.workout.id : item.activity.id}>
                {"workout" in item ? (
                  <RowLink
                    to="/workouts/$workoutId"
                    params={{ workoutId: item.workout.id }}
                    icon={Dumbbell}
                    label={`${formatWeekday(item.day, i18n.language, today)} · ${formatDuration(
                      Date.parse(item.workout.endedAt!) - Date.parse(item.workout.startedAt),
                      t,
                    )}`}
                    sub={workoutTitle(item.workout, sessions, t)}
                    trailing="push"
                  />
                ) : (
                  <RowButton
                    icon={ActivityIcon}
                    label={formatWeekday(item.day, i18n.language, today)}
                    sub={activityText(item.activity, t)}
                    trailing="push"
                    onClick={() => setOpened(item.day)}
                  />
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
            open={!leaving}
            activities={activities}
            steps={steps}
            today={today}
            date={opened}
            onDate={setOpened}
            onWrite={(entries: Entry[], previous: Entry[], kind) =>
              void write(entries, previous, t(`today.activityToast.${kind}`)).then(
                (ok) => ok && setLeaving(true),
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
