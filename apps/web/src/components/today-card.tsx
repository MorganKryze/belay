import { type ISODate, toISODate } from "@belay/shared/body/dates";
import type { Weighing } from "@belay/shared/body/weighings";
import {
  estimatedMinutes,
  nextSession,
  plannedWorkSets,
  sessionByCode,
} from "@belay/shared/training/program";
import { liveSets, openWorkout } from "@belay/shared/training/rules";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Dumbbell, type LucideIcon, Pill, Scale, Utensils } from "lucide-react";
import { lazy, type ReactNode, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatKg, formatNumber, sessionTitle } from "@/lib/format";
import {
  type OpenAccount,
  useHistory,
  useIntake,
  useRecord,
  useSupplementLogs,
  useSupplements,
} from "@/sync/account";
import { type Entry, Toast, useWriter } from "./weigh-in";

// Lazy: the sheets, their steppers and their strings load the first time one opens.
const WeighInSheet = lazy(() =>
  import("./weigh-in-sheet").then((m) => ({ default: m.WeighInSheet })),
);
const IntakeSheet = lazy(() => import("./intake-sheet").then((m) => ({ default: m.IntakeSheet })));
const SupplementsSheet = lazy(() =>
  import("./supplements-sheet").then((m) => ({ default: m.SupplementsSheet })),
);

type Gesture = "weighIn" | "intake" | "supplements";

// Home's "Today" card (D1): the day's session first, then one line per gesture of the day with
// where it stands; a tap starts or resumes the session, or opens the gesture's sheet.
export function TodayCard({
  account,
  weighings,
  today,
}: {
  account: OpenAccount;
  weighings: Weighing[];
  today: ISODate;
}) {
  const { t, i18n } = useTranslation();
  const intake = useIntake(account).data ?? [];
  const supplements = useSupplements(account).data ?? [];
  const logs = useSupplementLogs(account).data ?? [];
  const { write, toast, error, clearError, dismiss } = useWriter(account);
  const record = useRecord(account);
  const [open, setOpen] = useState<Gesture | null>(null);
  const [date, setDate] = useState<ISODate | null>(null); // null: today, whatever the clock says
  const [tickError, setTickError] = useState<string>();
  const day = date ?? today;
  // "Today" is read when the person saves: the sheet may have been opened yesterday evening.
  const when = () => date ?? toISODate(new Date());
  const close = () => {
    setOpen(null);
    setDate(null);
    clearError();
    setTickError(undefined);
  };
  const save = async (entries: Entry[], previous: Entry[], text: string) => {
    if (await write(entries, previous, text)) close();
  };

  const weighed = weighings.find((w) => w.date === today);
  const own = intake.find((l) => l.date === today);
  const active = supplements.filter((s) => !s.removed);
  const ticked = logs.filter(
    (l) => l.date === today && active.some((s) => s.id === l.supplementId),
  );
  const kcal = (v: number) => formatNumber(v, i18n.language, { digits: 0 });
  const intakeText = !own
    ? t("today.intakeEmpty")
    : [
        own.kcal !== null && `${kcal(own.kcal)} kcal`,
        own.proteinG !== null && `${kcal(own.proteinG)} g`,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <>
      <section
        aria-labelledby="today"
        className="flex flex-col rounded-card border border-border bg-card px-4 pt-3 pb-1"
      >
        <h2
          id="today"
          tabIndex={-1}
          data-focus-fallback
          className="border-b border-border pb-2 text-[15px] font-semibold outline-none"
        >
          {t("today.title")}
        </h2>
        <SessionRow account={account} />
        <Row
          icon={Scale}
          title={t("today.weighIn")}
          status={
            weighed
              ? t("today.weighInDone", { value: formatKg(weighed.weightKg, i18n.language) })
              : t("today.weighInEmpty")
          }
          onClick={() => setOpen("weighIn")}
        />
        <Row
          icon={Utensils}
          title={t("today.intake")}
          status={intakeText}
          onClick={() => setOpen("intake")}
        />
        {active.length > 0 ? (
          <Row
            icon={Pill}
            title={t("today.supplements")}
            status={t("today.supplementsDone", { taken: ticked.length, count: active.length })}
            onClick={() => setOpen("supplements")}
          />
        ) : (
          <RowShell icon={Pill}>
            <Link
              to="/settings/supplements"
              className="flex min-h-14 flex-1 items-center justify-between gap-2 font-semibold text-primary"
            >
              {t("today.addSupplements")}
              <ChevronRight aria-hidden className="size-5 shrink-0" />
            </Link>
          </RowShell>
        )}
      </section>
      <Suspense fallback={null}>
        {open === "weighIn" && (
          <WeighInSheet
            onClose={close}
            weighings={weighings}
            today={today}
            date={day}
            onDate={setDate}
            onSave={(_, kg) => {
              const at = when();
              const previous = weighings.find((w) => w.date === at)?.weightKg ?? null;
              void save(
                [{ kind: "weight", date: at, weightKg: kg }],
                [{ kind: "weight", date: at, weightKg: previous }],
                t("weighIn.toastSaved"),
              );
            }}
            onDelete={(at) => {
              const previous = weighings.find((w) => w.date === at)?.weightKg ?? null;
              void save(
                [{ kind: "weight", date: at, weightKg: null }],
                [{ kind: "weight", date: at, weightKg: previous }],
                t("weighIn.toastDeleted"),
              );
            }}
            error={error}
          />
        )}
        {open === "intake" && (
          <IntakeSheet
            onClose={close}
            logs={intake}
            today={today}
            date={day}
            onDate={setDate}
            onWrite={(entries, previous, deleted) =>
              void save(
                entries.map((e) => ({ ...e, date: when() }) as Entry),
                previous.map((e) => ({ ...e, date: when() }) as Entry),
                t(deleted ? "today.intakeDeleted" : "today.intakeSaved"),
              )
            }
            error={error}
          />
        )}
        {open === "supplements" && (
          <SupplementsSheet
            onClose={close}
            supplements={supplements}
            logs={logs}
            today={today}
            date={day}
            onDate={setDate}
            onToggle={(supplementId, taken) =>
              record({
                kind: "supplementLog",
                supplementId,
                date: when(),
                taken,
                at: new Date().toISOString(),
              }).then(
                () => {
                  setTickError(undefined);
                  return true;
                },
                () => {
                  setTickError(t("weighIn.saveFailed"));
                  return false;
                },
              )
            }
            error={tickError}
          />
        )}
      </Suspense>
      <Toast toast={toast} onDone={dismiss} />
    </>
  );
}

// §4.1: the next session of the program, or the one in progress and how far it is.
function SessionRow({ account }: { account: OpenAccount }) {
  const { t } = useTranslation();
  const history = useHistory(account).data;
  if (!history) return null;
  const open = openWorkout(history.workouts, { sets: history.sets, now: new Date() });
  const code = open?.sessionCode ?? nextSession(history.workouts);
  const session = sessionByCode(code);
  if (!open && !session) return null;
  let status: string;
  if (open) {
    const done = liveSets(history).filter((s) => s.workoutId === open.id && !s.warmup).length;
    status = t("today.sessionOpen", { count: done, total: plannedWorkSets(open.plan) });
  } else {
    status = t("today.sessionPlanned", {
      count: session!.slots.length,
      minutes: estimatedMinutes(session!),
    });
  }
  return (
    <RowShell icon={Dumbbell}>
      <Link
        to="/workout"
        search={{ start: code }}
        className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-2 py-2 text-left"
      >
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold">{sessionTitle(code, t)}</span>
          <span className="text-[13px] text-muted-foreground">{status}</span>
        </span>
        <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      </Link>
    </RowShell>
  );
}

function RowShell({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-t border-border first-of-type:border-t-0">
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary-soft text-primary-ink"
      >
        <Icon className="size-5" />
      </span>
      {children}
    </div>
  );
}

// One gesture: its name, where it stands today, and a chevron; the whole line opens the sheet.
function Row({
  icon,
  title,
  status,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  status: string;
  onClick: () => void;
}) {
  return (
    <RowShell icon={icon}>
      <button
        type="button"
        className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-2 py-2 text-left"
        onClick={onClick}
      >
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold">{title}</span>
          <span className="text-[13px] text-muted-foreground">{status}</span>
        </span>
        <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      </button>
    </RowShell>
  );
}
