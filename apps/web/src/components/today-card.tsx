import { type ISODate, toISODate } from "@belay/shared/body/dates";
import type { Weighing } from "@belay/shared/body/weighings";
import { activitySummary } from "@belay/shared/training/activities";
import { type AsyncRouteComponent, Link, lazyRouteComponent } from "@tanstack/react-router";
import {
  Activity as ActivityIcon,
  Check,
  ChevronRight,
  type LucideIcon,
  Pill,
  Scale,
  Utensils,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { daySummaryText } from "@/lib/activities";
import { useFirstPull } from "@/lib/first-pull";
import { groupCard, sectionLabel } from "./surfaces";
import { preloadWhenIdle } from "@/lib/idle";
import { formatKg, formatNumber } from "@/lib/format";
import {
  type OpenAccount,
  useActivities,
  useIntake,
  useRecord,
  useSteps,
  useSupplementLogs,
  useSupplements,
  useWeighings,
} from "@/sync/account";
import { type Entry, Toast, useWriter } from "./weigh-in";

// Lazy: the sheets, their steppers and their strings stay out of the first load. They are fetched
// once Home has settled, or as soon as a finger lands on their row, so a sheet never waits on code.
const ActivitySheet = lazyRouteComponent(() => import("./activity-sheet"), "ActivitySheet");
const WeighInSheet = lazyRouteComponent(() => import("./weigh-in-sheet"), "WeighInSheet");
const IntakeSheet = lazyRouteComponent(() => import("./intake-sheet"), "IntakeSheet");
const SupplementsSheet = lazyRouteComponent(
  () => import("./supplements-sheet"),
  "SupplementsSheet",
);
const SHEETS = [ActivitySheet, WeighInSheet, IntakeSheet, SupplementsSheet];

type Gesture = "activity" | "weighIn" | "intake" | "supplements";

// Home's "Today" card (D1): one line per gesture of the day with where it stands; a tap opens the
// gesture's sheet.
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
  const intakeQuery = useIntake(account);
  const supplementsQuery = useSupplements(account);
  const activitiesQuery = useActivities(account);
  const stepsQuery = useSteps(account);
  const logsQuery = useSupplementLogs(account);
  const intake = intakeQuery.data ?? [];
  const supplements = supplementsQuery.data ?? [];
  const activities = activitiesQuery.data ?? [];
  const steps = stepsQuery.data ?? [];
  const logs = logsQuery.data ?? [];
  // Read here, not from the prop: when the first pull lands, Home may render the new weigh-ins a
  // moment after this card has stopped waiting, and the row would flash « pas encore saisie ».
  const latestWeighings = useWeighings(account).data ?? weighings;
  // A row says « pas encore saisi » only once it knows: its own reads are done, and a device
  // that never received the account's data has its first sync behind it.
  const firstPull = useFirstPull(account);
  const unknown = {
    activity: firstPull || activitiesQuery.isPending || stepsQuery.isPending,
    weighIn: firstPull,
    intake: firstPull || intakeQuery.isPending,
    supplements: firstPull || supplementsQuery.isPending || logsQuery.isPending,
  };
  const anyUnknown = Object.values(unknown).some(Boolean);
  const { write, toast, error, clearError, dismiss } = useWriter(account);
  const record = useRecord(account);
  const [open, setOpen] = useState<Gesture | null>(null);
  useEffect(() => preloadWhenIdle(SHEETS), []);
  const [date, setDate] = useState<ISODate | null>(null); // null: today, whatever the clock says
  const [tickError, setTickError] = useState<string>();
  // A saved sheet plays its exit over the screen that already shows the record.
  const [leaving, setLeaving] = useState(false);
  const day = date ?? today;
  // "Today" is read when the person saves: the sheet may have been opened yesterday evening.
  const when = () => date ?? toISODate(new Date());
  const close = () => {
    setOpen(null);
    setLeaving(false);
    setDate(null);
    clearError();
    setTickError(undefined);
  };
  const save = async (entries: Entry[], previous: Entry[], text: string) => {
    if (await write(entries, previous, text)) setLeaving(true);
  };

  const weighed = latestWeighings.find((w) => w.date === today);
  const own = intake.find((l) => l.date === today);
  const active = supplements.filter((s) => !s.removed);
  const ticked = logs.filter(
    (l) => l.date === today && active.some((s) => s.id === l.supplementId),
  );
  const kcal = (v: number) => formatNumber(v, i18n.language, { digits: 0 });
  const intakeText = !own
    ? { text: t("today.intakeEmpty"), done: false }
    : {
        done: true,
        text: [
          own.kcal !== null && `${kcal(own.kcal)} kcal`,
          own.proteinG !== null && `${kcal(own.proteinG)} g`,
        ]
          .filter(Boolean)
          .join(" · "),
      };
  const summary = activitySummary(activities, steps, today);

  return (
    <>
      <section
        aria-labelledby="today"
        aria-busy={anyUnknown || undefined}
        className="flex flex-col gap-2"
      >
        <h2 id="today" tabIndex={-1} data-focus-fallback className={`${sectionLabel} outline-none`}>
          {t("today.title")}
        </h2>
        <div className={groupCard}>
          <Row
            icon={ActivityIcon}
            title={t("today.activity")}
            status={
              unknown.activity
                ? null
                : {
                    text: daySummaryText(summary, t, i18n.language),
                    done: summary.kind !== "none",
                  }
            }
            onClick={() => setOpen("activity")}
            sheet={ActivitySheet}
          />
          <Row
            icon={Scale}
            title={t("today.weighIn")}
            status={
              unknown.weighIn
                ? null
                : weighed
                  ? {
                      text: t("trend.kg", { value: formatKg(weighed.weightKg, i18n.language) }),
                      done: true,
                    }
                  : { text: t("today.weighInEmpty"), done: false }
            }
            onClick={() => setOpen("weighIn")}
            sheet={WeighInSheet}
          />
          <Row
            icon={Utensils}
            title={t("today.intake")}
            status={unknown.intake ? null : intakeText}
            onClick={() => setOpen("intake")}
            sheet={IntakeSheet}
          />
          {unknown.supplements || active.length > 0 ? (
            <Row
              icon={Pill}
              title={t("today.supplements")}
              status={
                unknown.supplements
                  ? null
                  : {
                      text: t("today.supplementsDone", {
                        taken: ticked.length,
                        count: active.length,
                      }),
                      done: ticked.length === active.length,
                    }
              }
              onClick={() => setOpen("supplements")}
              sheet={SupplementsSheet}
            />
          ) : (
            <Link to="/settings/supplements" className={rowLine}>
              <RowBody
                icon={Pill}
                title={t("today.supplements")}
                status={{ text: t("today.supplementsNone"), done: false }}
              />
            </Link>
          )}
        </div>
      </section>
      <Suspense fallback={null}>
        {open === "activity" && (
          <ActivitySheet
            onClose={close}
            open={!leaving}
            activities={activities}
            steps={steps}
            today={today}
            date={day}
            onDate={setDate}
            onWrite={(entries, previous, toast) =>
              void save(
                entries.map((e) => ("date" in e ? { ...e, date: when() } : e) as Entry),
                previous.map((e) => ("date" in e ? { ...e, date: when() } : e) as Entry),
                t(`today.activityToast.${toast}`),
              )
            }
            error={error}
          />
        )}
        {open === "weighIn" && (
          <WeighInSheet
            onClose={close}
            open={!leaving}
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
            open={!leaving}
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
            open={!leaving}
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

// The icon tile sits inside the row's button or link, so a press tints the whole line.
const rowLine = "press-tint flex min-h-14 w-full min-w-0 items-center gap-3 px-4 py-2 text-left";

// Where a gesture stands today: null while not known yet; done when something is logged.
type Status = { text: string; done: boolean } | null;

// The inside of a row: the icon square, the name over its status, and a chevron. A status still
// unknown (null) is a blank line of the same height, so nothing moves when it comes; the
// no-break space keeps the line from collapsing.
function RowBody({
  icon: Icon,
  title,
  status,
}: {
  icon: LucideIcon;
  title: string;
  status: Status;
}) {
  return (
    <>
      <span
        aria-hidden
        className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-primary-soft text-primary-ink"
      >
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">{title}</span>
        {/* Keyed: each state mounts its own span instead of patching the one before into it. */}
        {status === null ? (
          <span key="blank" aria-hidden className="text-[13px] text-muted-foreground">
            {"\u00a0"}
          </span>
        ) : status.done ? (
          <span key="done" className="flex min-w-0 items-center gap-1">
            <Check aria-hidden className="size-4 shrink-0 text-reference-ink" />
            <span className="text-[13px] font-medium text-foreground">{status.text}</span>
          </span>
        ) : (
          <span key="todo" className="text-[13px] text-muted-foreground">
            {status.text}
          </span>
        )}
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </>
  );
}

// One gesture; the whole line opens its sheet.
function Row({
  icon,
  title,
  status,
  onClick,
  sheet,
}: {
  icon: LucideIcon;
  title: string;
  status: Status;
  onClick: () => void;
  sheet: AsyncRouteComponent<never>;
}) {
  return (
    <button
      type="button"
      className={rowLine}
      onClick={onClick}
      onPointerDown={sheet.preload}
      onFocus={sheet.preload}
    >
      <RowBody icon={icon} title={title} status={status} />
    </button>
  );
}
