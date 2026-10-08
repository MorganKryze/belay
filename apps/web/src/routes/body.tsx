import "@/i18n/lazy";
import { addDays, type ISODate, isoWeekStart } from "@belay/shared/body/dates";
import { type IntakeLog, weeklyIntake } from "@belay/shared/body/intake";
import { type Measure, measureOf, weeklyWaist } from "@belay/shared/body/measures";
import { creatineWindows } from "@belay/shared/body/supplements";
import { inTargetRange, type TargetRange } from "@belay/shared/body/target";
import {
  latestMovingAverage,
  MIN_WEIGHINGS,
  movingAverageSeries,
  type WeekSummary,
  type Weighing,
  weeklySummaries,
} from "@belay/shared/body/weighings";
import type { AnnotationRow, SupplementLogRow, SupplementRow } from "@belay/shared/sync/schema";
import type { TFunction } from "i18next";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AnnotationSheet } from "@/components/annotation-sheet";
import { MeasuresSheet } from "@/components/measures-sheet";
import { Segmented } from "@/components/segmented";
import { SyncBanner } from "@/components/sync-banner";
import { Button } from "@/components/ui/button";
import { dayLabel, type Entry, Toast, useWriter } from "@/components/weigh-in";
import { WeighInSheet } from "@/components/weigh-in-sheet";
import { formatKg, formatNumber, formatShortDay, formatWeekRange, lossView } from "@/lib/format";
import { useToday } from "@/lib/today";
import {
  type Account,
  type OpenAccount,
  useAccount,
  useAnnotations,
  useIntake,
  useMeasures,
  useSupplementLogs,
  useSupplements,
  useTarget,
  useWeighings,
} from "@/sync/account";
import { type ChartMark, WeightChart } from "./body/chart";

const title = "text-[26px] leading-tight font-bold tracking-tight";
const card = "rounded-card border border-border bg-card";
const sectionTitle = "text-[15px] font-bold";
const pill = "rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap";
const neutralPill = `${pill} bg-track text-muted-foreground`;
const rangePill = `${pill} bg-reference text-reference-ink`;

type Period = "month" | "quarter" | "all";
type Open =
  | { sheet: "weighIn"; date: ISODate }
  | { sheet: "measures"; date: ISODate }
  | { sheet: "annotation"; annotation: AnnotationRow | null };

// The Body tab: always in the bar; tracking needs an account (D5), the tools do not.
export function Body() {
  const account = useAccount();
  return account.kind === "open" ? <BodyPage account={account} /> : <NoAccount account={account} />;
}

function NoAccount({ account }: { account: Exclude<Account, OpenAccount> }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4">
      <h1 className={title}>{t("body.title")}</h1>
      {account.kind === "unavailable" && <p>{t("account.unavailable")}</p>}
      {account.kind === "signed-out" && (
        <>
          <p>{t("body.signedOut")}</p>
          <Button asChild className="self-start">
            <a href={`/auth/login?returnTo=${encodeURIComponent("/body")}`}>{t("home.signIn")}</a>
          </Button>
        </>
      )}
    </section>
  );
}

function BodyPage({ account }: { account: OpenAccount }) {
  const { t } = useTranslation();
  const today = useToday();
  const weighings = useWeighings(account).data;
  const target = useTarget(account).data;
  const measures = useMeasures(account).data;
  const intake = useIntake(account).data;
  const supplements = useSupplements(account).data;
  const logs = useSupplementLogs(account).data;
  const annotations = useAnnotations(account).data;
  const ready = weighings && target && measures && intake && supplements && logs && annotations;
  return (
    <section className="flex flex-col gap-4">
      <h1 tabIndex={-1} data-focus-fallback className={`${title} outline-none`}>
        {t("body.title")}
      </h1>
      <SyncBanner account={account} />
      {ready && (
        <BodyContent
          account={account}
          data={{ weighings, target, measures, intake, supplements, logs, annotations }}
          today={today}
        />
      )}
    </section>
  );
}

type BodyData = {
  weighings: Weighing[];
  target: TargetRange;
  measures: Measure[];
  intake: IntakeLog[];
  supplements: SupplementRow[];
  logs: SupplementLogRow[];
  annotations: AnnotationRow[];
};

// An annotation's name: its type, or the note's text cut to 12 characters.
export function annotationName(a: AnnotationRow, t: TFunction): string {
  if (a.type !== "note" || !a.label) return t(`annotation.kinds.${a.type}`);
  return a.label.length > 12 ? `${a.label.slice(0, 12)}…` : a.label;
}

function BodyContent({
  account,
  data,
  today,
}: {
  account: OpenAccount;
  data: BodyData;
  today: ISODate;
}) {
  const { t, i18n } = useTranslation();
  const { weighings, target, measures, intake, supplements, logs, annotations } = data;
  const [period, setPeriod] = useState<Period>("month");
  const [open, setOpen] = useState<Open | null>(null);
  const { write, toast, error, clearError, dismiss } = useWriter(account);
  const close = () => {
    setOpen(null);
    clearError();
  };
  const save = async (entries: Entry[], previous: Entry[], text: string) => {
    if (await write(entries, previous, text)) setOpen(null);
  };
  const weightEntry = (date: ISODate, weightKg: number | null): Entry => ({
    kind: "weight",
    date,
    weightKg,
  });
  const writeWeight = (date: ISODate, kg: number | null) =>
    void save(
      [weightEntry(date, kg)],
      [weightEntry(date, weighings.find((w) => w.date === date)?.weightKg ?? null)],
      t(kg === null ? "weighIn.toastDeleted" : "weighIn.toastSaved"),
    );

  const sorted = [...weighings].sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = sorted.at(-1)?.date ?? today;
  const to = last > today ? last : today; // a weigh-in dated "tomorrow" after a timezone change
  const from =
    period === "all" ? (sorted[0]?.date ?? today) : addDays(today, period === "month" ? -29 : -90);
  const shown = sorted.filter((w) => w.date >= from);
  const weeks = weeklySummaries(weighings, today);
  const average = latestMovingAverage(weighings, today);
  const lastWeek = weeks.find((w) => w.status !== "in_progress");
  const lossPct = lastWeek?.lossPct ?? null;
  // The courses come from the boxes of creatine ticked, removed supplements included (D3).
  const creatine = new Set(supplements.filter((s) => s.kind === "creatine").map((s) => s.id));
  const courses = creatineWindows(
    logs.filter((l) => creatine.has(l.supplementId)).map((l) => l.date),
    today,
  );
  // During a course, said once under the figures: the scale may rise with water.
  const creatineNote = courses.some((c) => c.start <= today && today <= c.end) && (
    <p className="text-sm text-muted-foreground">{t("body.creatineNote")}</p>
  );
  const marks: ChartMark[] = annotations.map((a) => ({
    id: a.id,
    date: a.date,
    label: annotationName(a, t),
  }));

  const lossText = (pct: number) => {
    const { kind, value } = lossView(pct);
    const n = formatNumber(value, i18n.language, { digits: 1, minDigits: 1 });
    return t(kind === "gain" ? "body.gainText" : "body.lossText", { value: n });
  };
  const summary = t("chart.summary", {
    from: formatShortDay(from, i18n.language, today),
    to: formatShortDay(to, i18n.language, today),
    average: average ? t("trend.kg", { value: formatKg(average.averageKg, i18n.language) }) : "—",
    loss: lossPct === null ? "—" : lossText(lossPct),
  });
  // The band and the lines are drawn in context only; the same context goes to the summary.
  const inPeriod = (d: ISODate) => d >= from && d <= to;
  const shownCourses = courses.filter((c) => c.end >= from && c.start <= to);
  const shownNotes = annotations.filter((a) => inPeriod(a.date));
  const fullSummary = [
    summary,
    ...shownCourses.map((c) =>
      t("chart.summaryCourse", {
        from: formatShortDay(c.start < from ? from : c.start, i18n.language, today),
        to: formatShortDay(c.end > to ? to : c.end, i18n.language, today),
      }),
    ),
    ...shownNotes.map((a) =>
      t("chart.summaryNote", {
        name: annotationName(a, t),
        date: formatShortDay(a.date, i18n.language, today),
      }),
    ),
  ].join(" ");
  // Annotations whose pill is not on a week shown (no weeks list yet, or the date outside it).
  const weeksShown = weighings.length < MIN_WEIGHINGS ? [] : weeks.filter((w) => w.end >= from);
  const orphans = shownNotes.filter(
    (a) => !weeksShown.some((w) => a.date >= w.start && a.date <= w.end),
  );

  return (
    <>
      <Segmented
        label={t("body.period")}
        labelHidden
        value={period}
        onChange={setPeriod}
        options={[
          { value: "month", label: t("body.periods.month") },
          { value: "quarter", label: t("body.periods.quarter") },
          { value: "all", label: t("body.periods.all") },
        ]}
      />
      {shown.length > 0 && (
        <div className={`${card} px-2 pt-2.5 pb-1.5`}>
          <div
            aria-hidden
            className="mb-1 flex flex-wrap gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground"
          >
            <span className="flex items-center gap-1">
              <i className="size-[7px] rounded-full bg-chart-dot" />
              {t("chart.daily")}
            </span>
            <span className="flex items-center gap-1">
              <i className="h-[2.5px] w-3.5 bg-chart-line" />
              {t("chart.average")}
            </span>
            {courses.length > 0 && (
              <span className="flex items-center gap-1">
                <i className="size-2.5 rounded-[3px] border border-primary-ink/40 bg-primary-soft" />
                {t("chart.creatine")}
              </span>
            )}
          </div>
          <WeightChart
            weighings={shown}
            averages={movingAverageSeries(weighings, from, to)}
            from={from}
            to={to}
            summary={fullSummary}
            onSelect={(date) => setOpen({ sheet: "weighIn", date })}
            bands={courses}
            bandLabel={t("chart.creatineBand")}
            marks={marks}
            onSelectMark={(id) =>
              setOpen({ sheet: "annotation", annotation: annotations.find((a) => a.id === id)! })
            }
          />
          {orphans.length > 0 && (
            <div
              role="group"
              aria-label={t("annotation.row")}
              className="flex flex-wrap gap-x-2 px-1"
            >
              {orphans.map((a) => (
                <AnnotationPill
                  key={a.id}
                  annotation={a}
                  onOpen={() => setOpen({ sheet: "annotation", annotation: a })}
                />
              ))}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          className="h-12 rounded-field px-2 text-[15px] font-semibold text-primary"
          onClick={() => setOpen({ sheet: "measures", date: today })}
        >
          <Plus aria-hidden className="size-4" />
          {t("measures.title")}
        </Button>
        <Button
          variant="outline"
          className="h-12 rounded-field px-2 text-[15px] font-semibold text-primary"
          onClick={() => setOpen({ sheet: "annotation", annotation: null })}
        >
          <Plus aria-hidden className="size-4" />
          {t("annotation.button")}
        </Button>
      </div>
      {weighings.length < MIN_WEIGHINGS ? (
        <>
          <FirstDays weighings={weighings} today={today} />
          {creatineNote}
        </>
      ) : (
        <>
          <Figures average={average?.averageKg ?? null} lossPct={lossPct} target={target} />
          {creatineNote}
          <Weeks
            weeks={weeks.filter((w) => w.end >= from)}
            firstWeek={weeks.at(-1)!.start}
            target={target}
            today={today}
            lossText={lossText}
            measures={measures}
            intake={intake}
            courses={courses}
            annotations={annotations}
            onAnnotation={(annotation) => setOpen({ sheet: "annotation", annotation })}
          />
        </>
      )}
      <History
        weighings={shown}
        measures={measures.filter((m) => m.date >= from)}
        intake={intake.filter((l) => l.date >= from)}
        today={today}
        onSelect={(date) => setOpen({ sheet: "weighIn", date })}
      />
      {open?.sheet === "weighIn" && (
        <WeighInSheet
          onClose={close}
          weighings={weighings}
          today={today}
          date={open.date}
          onDate={(date) => setOpen({ sheet: "weighIn", date })}
          onSave={(day, kg) => writeWeight(day, kg)}
          onDelete={(day) => writeWeight(day, null)}
          error={error}
        />
      )}
      {open?.sheet === "measures" && (
        <MeasuresSheet
          onClose={close}
          measures={measures}
          today={today}
          date={open.date}
          onDate={(date) => setOpen({ sheet: "measures", date })}
          onWrite={(entries, previous, deleted) =>
            void save(
              entries,
              previous,
              t(deleted ? "measures.toastDeleted" : "measures.toastSaved"),
            )
          }
          error={error}
        />
      )}
      {open?.sheet === "annotation" && (
        <AnnotationSheet
          // A new key per annotation, so the form starts again from it.
          key={open.annotation?.id ?? "new"}
          onClose={close}
          annotation={open.annotation}
          today={today}
          onWrite={(entries, previous, deleted) =>
            void save(
              entries,
              previous,
              t(deleted ? "annotation.toastDeleted" : "annotation.toastSaved"),
            )
          }
          error={error}
        />
      )}
      <Toast toast={toast} onDone={dismiss} />
    </>
  );
}

// Before 4 weigh-ins: no average yet, and why, without judging (§9).
function FirstDays({ weighings, today }: { weighings: Weighing[]; today: ISODate }) {
  const { t } = useTranslation();
  const monday = isoWeekStart(today);
  const thisWeek = weighings.filter((w) => w.date >= monday).length;
  return (
    <div className="flex flex-col gap-1 rounded-card bg-primary-soft p-4">
      <h2 className={sectionTitle}>
        {t("body.firstDays", { count: Math.max(1, MIN_WEIGHINGS - thisWeek) })}
      </h2>
      <p className="text-sm text-muted-foreground">{t("body.firstDaysBody")}</p>
    </div>
  );
}

// The latest 7-day average, and the last complete week against the one before. Outside the
// range the number stands alone: no colour, no word that judges; a gain is said as a gain.
function Figures({
  average,
  lossPct,
  target,
}: {
  average: number | null;
  lossPct: number | null;
  target: TargetRange;
}) {
  const { t, i18n } = useTranslation();
  const loss = lossPct === null ? null : lossView(lossPct);
  const big = "text-[26px] leading-tight font-extrabold tabular-nums";
  const unit = "ml-1 text-[13px] font-semibold text-muted-foreground";
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <p className="text-sm text-muted-foreground">{t("body.average")}</p>
        <p className={big}>
          {average === null ? "—" : formatKg(average, i18n.language)}
          {average !== null && <span className={unit}>kg</span>}
        </p>
      </div>
      <div className="flex flex-col items-start">
        <p className="text-sm text-muted-foreground">{t("body.lossPerWeek")}</p>
        <p className={big}>
          {loss === null
            ? "—"
            : formatNumber(loss.value, i18n.language, { digits: 1, minDigits: 1 })}
          {loss !== null && (
            <span className={unit}>
              {t(loss.kind === "gain" ? "body.gainUnit" : "body.lossUnit")}
            </span>
          )}
        </p>
        {lossPct !== null && inTargetRange(lossPct, target) && (
          <span className={rangePill}>{t("body.inRange")}</span>
        )}
      </div>
    </div>
  );
}

// One block per ISO week, the most recent first: its dates and loss, its pills (in the range,
// creatine, annotations), then three figures: average weight, waist, intake (D5, D6).
function Weeks({
  weeks,
  firstWeek,
  target,
  today,
  lossText,
  measures,
  intake,
  courses,
  annotations,
  onAnnotation,
}: {
  weeks: WeekSummary[];
  firstWeek: ISODate;
  target: TargetRange;
  today: ISODate;
  lossText: (pct: number) => string;
  measures: Measure[];
  intake: IntakeLog[];
  courses: { start: ISODate; end: ISODate }[];
  annotations: AnnotationRow[];
  onAnnotation: (annotation: AnnotationRow) => void;
}) {
  const { t, i18n } = useTranslation();
  const sub = "text-xs text-muted-foreground";
  return (
    <section aria-labelledby="weeks" className="flex flex-col gap-1.5">
      <h2 id="weeks" className={sectionTitle}>
        {t("body.weeks")}
      </h2>
      <ul className={`${card} px-3`}>
        {weeks.map((w) => {
          const waist = weeklyWaist(measures, w.start);
          const food = weeklyIntake(intake, w.start);
          const notes = annotations.filter((a) => a.date >= w.start && a.date <= w.end);
          const onCreatine = courses.some((c) => c.start <= w.end && c.end >= w.start);
          const status =
            w.status === "in_progress"
              ? t("body.inProgress", { count: w.count })
              : w.status === "insufficient"
                ? t("body.tooFew", { count: w.count })
                : w.lossPct === null
                  ? w.start === firstWeek
                    ? t("body.firstWeek")
                    : t("body.previousInsufficient")
                  : null;
          return (
            <li
              key={w.start}
              className="flex flex-col gap-2 border-t border-border py-3 first:border-t-0"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold">
                  {w.status === "in_progress"
                    ? t("body.thisWeek")
                    : formatWeekRange(w.start, w.end, i18n.language, today)}
                </span>
                <b className="text-sm tabular-nums">
                  {w.status === "valid" && w.lossPct !== null ? lossText(w.lossPct) : "—"}
                </b>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {w.status === "valid" && w.lossPct !== null && inTargetRange(w.lossPct, target) && (
                  <span className={rangePill}>{t("body.inRange")}</span>
                )}
                {w.status === "in_progress" && (
                  <span className={neutralPill}>{t("body.toFollow")}</span>
                )}
                {w.status === "insufficient" && (
                  <span className={neutralPill}>{t("body.insufficient")}</span>
                )}
                {onCreatine && <span className={neutralPill}>{t("body.creatinePill")}</span>}
                {notes.map((a) => (
                  // A 44 px target around a pill of the usual size.
                  <AnnotationPill key={a.id} annotation={a} onOpen={() => onAnnotation(a)} />
                ))}
                {status && <span className={sub}>{status}</span>}
              </div>
              <dl className="grid grid-cols-3 gap-2">
                <Cell
                  label={t("body.cells.weight")}
                  value={
                    w.averageKg === null
                      ? "—"
                      : t("trend.kg", { value: formatKg(w.averageKg, i18n.language) })
                  }
                />
                <Cell
                  label={t("body.cells.waist")}
                  value={
                    waist === null
                      ? "—"
                      : t("body.cm", { value: formatNumber(waist, i18n.language, { digits: 1 }) })
                  }
                />
                <Cell
                  label={
                    food.days > 0 && food.days < 7
                      ? t("body.cells.intakeDays", { days: food.days })
                      : t("body.cells.intake")
                  }
                  value={
                    food.kcalAvg === null
                      ? "—"
                      : t("body.kcal", {
                          value: formatNumber(Math.round(food.kcalAvg), i18n.language, {
                            digits: 0,
                          }),
                        })
                  }
                />
              </dl>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// A 44 px target around a pill of the usual size.
function AnnotationPill({ annotation, onOpen }: { annotation: AnnotationRow; onOpen: () => void }) {
  const { t } = useTranslation();
  const name = annotationName(annotation, t);
  return (
    <button
      type="button"
      className="-my-2.5 inline-flex min-h-11 items-center"
      aria-label={t("body.openAnnotation", { name })}
      onClick={onOpen}
    >
      <span className={`${neutralPill} underline underline-offset-2`}>{name}</span>
    </button>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-[10px] bg-background px-2 py-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-bold tabular-nums">{value}</dd>
    </div>
  );
}

// One line per day of the period that holds an entry, the most recent first, saying what was
// entered ("79.8 kg · 2,100 kcal", "waist 82 cm"); a day with a weigh-in opens its sheet.
// ponytail: "All" renders every line at once. Upgrade: show the latest hundred and a "More" button.
function History({
  weighings,
  measures,
  intake,
  today,
  onSelect,
}: {
  weighings: Weighing[];
  measures: Measure[];
  intake: IntakeLog[];
  today: ISODate;
  onSelect: (date: ISODate) => void;
}) {
  const { t, i18n } = useTranslation();
  const days = [...new Set([...weighings, ...measures, ...intake].map((e) => e.date))].sort(
    (a, b) => (a < b ? 1 : -1),
  );
  if (days.length === 0) return null;
  const number = (v: number) => formatNumber(v, i18n.language, { digits: 1 });
  // The other parts of a day, apart from its weight: one line of their own under the day.
  const parts = (date: ISODate): string[] => {
    const l = intake.find((x) => x.date === date);
    const m = measures.find((x) => x.date === date);
    return [
      l?.kcal != null &&
        t("body.kcal", { value: formatNumber(l.kcal, i18n.language, { digits: 0 }) }),
      l?.proteinG != null &&
        t("body.dayParts.protein", {
          value: formatNumber(l.proteinG, i18n.language, { digits: 0 }),
        }),
      ...(["waist", "neck", "hip"] as const).map((f) => {
        const cm = m ? measureOf(m, f) : null;
        return cm !== null && t(`body.dayParts.${f}`, { value: number(cm) });
      }),
    ].filter((part): part is string => typeof part === "string");
  };
  const line = "flex min-h-11 w-full flex-col justify-center gap-0.5 py-2 text-left";
  return (
    <section aria-labelledby="history" className="flex flex-col gap-1">
      <h2 id="history" className={sectionTitle}>
        {t("body.history")}
      </h2>
      <ul>
        {days.map((date) => {
          const w = weighings.find((x) => x.date === date);
          const rest = parts(date);
          const content = (
            <>
              <span className="flex items-baseline justify-between gap-x-3">
                <span>{dayLabel(date, today, t, i18n.language)}</span>
                {w && (
                  <b className="tabular-nums">
                    {t("trend.kg", { value: formatKg(w.weightKg, i18n.language) })}
                  </b>
                )}
              </span>
              {rest.length > 0 && (
                // A line only breaks between two parts, never inside one.
                <span className="flex flex-wrap gap-x-1.5 text-sm text-muted-foreground tabular-nums">
                  {rest.map((part, i) => (
                    <span key={part} className="whitespace-nowrap">
                      {part}
                      {i < rest.length - 1 && " ·"}
                    </span>
                  ))}
                </span>
              )}
            </>
          );
          return (
            <li key={date} className="border-t border-border first:border-t-0">
              {w ? (
                <button type="button" className={line} onClick={() => onSelect(date)}>
                  {content}
                </button>
              ) : (
                <div className={line}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
