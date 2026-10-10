import { type ISODate, toISODate } from "@belay/shared/body/dates";
import type { Workout } from "@belay/shared/training/workout";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { formatWeekday, sessionTitle } from "@/lib/format";
import { useToday } from "@/lib/today";
import { type OpenAccount, useAccount, useHistory } from "@/sync/account";
import { formatDuration } from "./format";
import { MonthCalendar } from "./month-calendar";

// A session belongs to the day it started, where the person is: one begun at 23:30 and
// finished after midnight stays on its first day.
export const dayOf = (w: Pick<Workout, "startedAt">): ISODate => toISODate(new Date(w.startedAt));

// History (§4.5): the month's calendar, then the sessions of that month, newest first.
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
  if (!history) return null;
  const finished = history.workouts
    .filter((w) => !w.removed && w.endedAt !== null)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const shown = finished.filter((w) => dayOf(w).startsWith(month));
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
        onMonth={setMonth}
      />
      <section aria-labelledby="sessions" className="flex flex-col">
        <h2 id="sessions" className="mx-0.5 text-[15px] font-semibold first-letter:uppercase">
          {month === current ? t("history.recent") : monthName}
        </h2>
        {shown.length === 0 ? (
          <p className="mx-0.5 mt-2 text-sm text-muted-foreground">
            {finished.length === 0 ? t("history.first") : t("history.none")}
          </p>
        ) : (
          <ul className="flex flex-col">
            {shown.map((w) => (
              <li key={w.id} className="border-t border-border first:border-t-0">
                <Link
                  to="/workouts/$workoutId"
                  params={{ workoutId: w.id }}
                  className="flex min-h-15 items-center justify-between gap-3 py-2"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">
                      {formatWeekday(dayOf(w), i18n.language, today)}
                    </span>
                    <span className="truncate text-[13px] text-muted-foreground">
                      {sessionTitle(w.sessionCode, t)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 font-semibold tabular-nums">
                    {formatDuration(Date.parse(w.endedAt!) - Date.parse(w.startedAt), t)}
                    <ChevronRight aria-hidden className="size-5 text-muted-foreground" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
