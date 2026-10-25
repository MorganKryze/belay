import { addDays, type ISODate } from "@belay/shared/body/dates";
import type { Activity } from "@belay/shared/training/activities";
import { planFor } from "@belay/shared/training/plan";
import { chooseActive, programOrder } from "@belay/shared/training/program-edits";
import { estimatedMinutes, plannedWorkSets } from "@belay/shared/training/program";
import { type History, lastFinished, openWorkout, workSetsOf } from "@belay/shared/training/rules";
import { type Weekday, weekdayOf } from "@belay/shared/training/schedule";
import { type WeekCard, weekOrder } from "@belay/shared/training/schedule-week";
import {
  byPosition,
  type LetteredTemplate,
  nextInRotation,
  type Program,
  rotationOf,
  startedAs,
  type StoredPrograms,
} from "@belay/shared/training/stored-program";
import { Link } from "@tanstack/react-router";
import { Check, PenLine } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { GroupedList, RowButton, RowLink } from "@/components/grouped-list";
import { SessionCard, SessionHeading } from "@/components/session-card";
import { Sheet } from "@/components/sheet";
import { cardSurface, groupCard, groupSurface } from "@/components/surfaces";
import { Button } from "@/components/ui/button";
import { programName, rotationTitle, sessionName, weekdayName, whenText } from "@/lib/format";
import { useToday } from "@/lib/today";
import { type OpenAccount, useActivities, useHistory, useProgram, useRecord } from "@/sync/account";
import { dayOf } from "./history-panel";
import { RhythmRow } from "./rhythm-sheet";

// Program (spec D13, §4.5): the active program's rotation as cards, the next one first with « See
// the session »; every other card opens its session's preview on a tap anywhere. While a session
// is open, its card resumes it and the others open their preview, which says what is open.
// Without an account nothing is next, so every card opens the starting program's preview. A
// session set aside is not in the rotation, so it has no card: it is listed under the cards; with
// no active program there is no card at all. Above the cards, a row names the active program and
// opens the sheet that picks another; under the cards, a row sets the program's rhythm. The program
// is edited on a computer, where the note under the list becomes the editor's entry.
export function ProgramPanel({ account }: { account: OpenAccount | null }) {
  const { t } = useTranslation();
  const program = useProgram(account).data;
  // The rhythm of a live active program with sessions; on a computer the editor's entry joins
  // its group, and on a phone the note follows it.
  const rhythm = account && program && program.rotation.length > 0;
  const edit = (
    <RowLink
      to="/workouts/program"
      icon={PenLine}
      label={t("workouts.program.edit")}
      sub={t("workouts.program.editSub")}
      trailing="push"
    />
  );
  return (
    <div className="flex flex-col gap-3">
      {account && program && <ActiveProgram account={account} programs={program.programs} />}
      {program &&
        (account ? (
          <Cards account={account} program={program} />
        ) : (
          <List history={null} activities={[]} {...program} />
        ))}
      {program && <SetAside programs={program.programs} />}
      {rhythm && (
        <div className={groupSurface}>
          <RhythmRow account={account} {...program} />
          <div className="hidden border-t border-border lg:block">{edit}</div>
        </div>
      )}
      <p className="mx-0.5 text-sm text-muted-foreground lg:hidden">
        {t("workouts.program.editNote")}
      </p>
      {!rhythm && <div className={`hidden lg:block ${groupCard}`}>{edit}</div>}
    </div>
  );
}

// A program's sessions as its rotation letters them, the ones the cards show once it is active:
// a session with no exercise is left out.
const sessionsOf = (programs: StoredPrograms, programId: string) =>
  rotationOf({ ...programs, activeId: programId }).length;

// The row naming the active program, and its sheet: one tap on another program makes it active
// (one change, written at once) and closes; on the active one it only closes. With no live
// active program (removed on another device) the row still opens the sheet to pick one.
function ActiveProgram({ account, programs }: { account: OpenAccount; programs: StoredPrograms }) {
  const { t } = useTranslation();
  const write = useRecord(account);
  const [sheet, setSheet] = useState(false);
  const active = programs.programs.find((p) => p.id === programs.activeId && !p.removed);
  return (
    <>
      <div className={groupCard}>
        <RowButton
          label={active ? programName(active, t) : t("workouts.program.sheetTitle")}
          sub={
            active
              ? t("workouts.program.active", { count: sessionsOf(programs, active.id) })
              : undefined
          }
          trailing="push"
          onClick={() => setSheet(true)}
        />
      </div>
      {sheet && (
        <ProgramSheet
          programs={programs}
          activeId={active?.id ?? null}
          onPick={async (id, close) => {
            const changes = chooseActive(programs, id, new Date().toISOString());
            if (changes) await write(changes);
            close();
          }}
          onClose={() => setSheet(false)}
        />
      )}
    </>
  );
}

function ProgramSheet({
  programs,
  activeId,
  onPick,
  onClose,
}: {
  programs: StoredPrograms;
  activeId: string | null;
  onPick: (id: string, close: () => void) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const close = () => setOpen(false);
  const pick = (p: Program) => (p.id === activeId ? close() : void onPick(p.id, close));
  return (
    <Sheet title={t("workouts.program.sheetTitle")} open={open} onClose={onClose}>
      <ul className={groupCard}>
        {programOrder(programs).map((p) => (
          <li key={p.id}>
            <RowButton
              aria-current={p.id === activeId || undefined}
              label={programName(p, t)}
              sub={t("workouts.program.sessions", { count: sessionsOf(programs, p.id) })}
              value={
                p.id === activeId ? (
                  <Check aria-hidden className="size-5 text-primary" />
                ) : undefined
              }
              onClick={() => pick(p)}
            />
          </li>
        ))}
      </ul>
      <p className="px-1 text-(length:--text-secondary) leading-(--text-secondary--line-height) text-muted-foreground">
        {t("workouts.program.sheetNote")}
      </p>
    </Sheet>
  );
}

// The sessions set aside, out of the rotation: each one's normal slots sized as a card is, and a
// row to its preview by its id. Nothing when the collection is empty.
function SetAside({ programs }: { programs: StoredPrograms }) {
  const { t } = useTranslation();
  const aside = programs.sessions
    .filter((s) => s.programId === null && !s.removed)
    .sort(byPosition);
  if (aside.length === 0) return null;
  return (
    <GroupedList label={t("workouts.program.aside")}>
      {aside.map((session) => {
        const slots = programs.slots
          .filter((s) => s.sessionId === session.id && s.rule === null && !s.removed)
          .map((s) => ({ ...s, rule: undefined }));
        return (
          <RowLink
            key={session.id}
            to="/workouts/session/$code"
            params={{ code: session.id }}
            label={sessionName(session, t)}
            sub={t("sessionCard.size", {
              count: slots.length,
              minutes: estimatedMinutes({ slots }),
            })}
            trailing="push"
          />
        );
      })}
    </GroupedList>
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
  const { t, i18n } = useTranslation();
  const today = useToday();
  // On fixed days the cards follow the week from today, the planned session first; in rotation
  // the next session leads, then the rotation's order from there.
  const order = history ? weekOrder(history.workouts, programs, rotation, today) : null;
  const next = order
    ? (order[0]?.session ?? null)
    : history
      ? nextInRotation(history.workouts, rotation, programs.activeAt)
      : null;
  const at = next ? rotation.indexOf(next) : 0;
  const cards =
    order ??
    [...rotation.slice(at), ...rotation.slice(0, at)].map((session): WeekCard => ({
      session,
      next: null,
      days: [],
    }));
  const open = history
    ? openWorkout(history.workouts, { sets: history.sets, now: new Date() })
    : null;
  // How far the open session is: its work sets logged over the ones its plan holds.
  const progress =
    history && open
      ? { count: workSetsOf(history, open.id), total: plannedWorkSets(open.plan) }
      : null;
  return cards.map(({ session: s, next: day, days }) => (
    <ProgramCard
      key={s.sessionId}
      session={s}
      next={s === next}
      lastDay={history && !order ? lastDayOf(history, s) : undefined}
      when={
        s === next && day
          ? whenText(day, today, i18n.language, t, { tomorrowDay: true })
          : undefined
      }
      days={days.length > 0 ? daysText(days, today, i18n.language) : undefined}
      activities={activities}
      today={today}
      see={!open && s === next}
      progress={open && startedAs(open, s) ? progress : null}
    />
  ));
}

// The day this session was last done; null: never; undefined: no account.
function lastDayOf(history: History, session: LetteredTemplate): ISODate | null {
  const last = lastFinished(history.workouts, session);
  return last === null ? null : dayOf(last);
}

// A card's days, Monday first, as one line: « Lundi, jeudi ».
const daysText = (days: readonly Weekday[], today: ISODate, lang: string) =>
  days
    .map((d, i) =>
      weekdayName(addDays(today, d - weekdayOf(today)), lang, { startOfLine: i === 0 }),
    )
    .join(", ");

// Whole days between two calendar days (UTC midnights: no daylight-saving shift).
const daysBetween = (from: ISODate, to: ISODate) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// With progress: the open session's card, with how far it is; see: the next card's button to the
// preview; else the whole card is a link to the preview. On fixed days the next card leads with
// when it falls and the others name their days in place of when they were last done (lastDay
// undefined: no account, or fixed days).
function ProgramCard({
  session,
  next,
  lastDay,
  activities,
  today,
  see,
  progress,
  when,
  days,
}: {
  session: LetteredTemplate;
  next: boolean;
  lastDay: ISODate | null | undefined;
  when?: string;
  days?: string;
  activities: readonly Activity[];
  today: ISODate;
  see: boolean;
  progress: { count: number; total: number } | null;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { code } = session;
  const title = rotationTitle(session, t);
  const plan = planFor(session, activities, today);
  const size = t("sessionCard.size", {
    count: plan.length,
    minutes: estimatedMinutes({ slots: plan }),
  });
  const lead = when ?? t("sessionCard.next");
  if (progress) {
    return (
      <SessionCard
        title={title}
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
      <SessionCard title={title} lead={lead} detail={size}>
        <Button asChild variant="primary">
          <Link to="/workouts/session/$code" params={{ code }}>
            {t("sessionCard.see")}
          </Link>
        </Button>
      </SessionCard>
    );
  }
  const done =
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
      {days && !next ? (
        // The days in the title's ink, as Accueil names a session in its quiet line.
        <div className="flex flex-col">
          <h2 id={id} className="text-[17px] font-semibold">
            {title}
          </h2>{" "}
          <p className="text-[13px] text-muted-foreground">
            <b className="font-semibold text-foreground">{days}</b> · {size}
          </p>
        </div>
      ) : (
        <SessionHeading
          id={id}
          title={title}
          lead={next ? lead : undefined}
          detail={done && !next ? `${done} · ${size}` : size}
        />
      )}
    </Link>
  );
}
