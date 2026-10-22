import "@/i18n/lazy";
import { addDays, type ISODate, isoWeekStart } from "@belay/shared/body/dates";
import { type IntakeLog, weeklyIntake } from "@belay/shared/body/intake";
import { MEASURE_FIELDS, type Measure, measureOf, weeklyWaist } from "@belay/shared/body/measures";
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
import { Check, Flag, type LucideIcon, Ruler, Scale } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/page-header";
import { cardSurface, groupCard, sectionLabel } from "@/components/surfaces";
import { RowBody, rowLine, type Status } from "@/components/today-card";
import { TrendFigure } from "@/components/trend-figure";
import { AnnotationSheet } from "@/components/annotation-sheet";
import { MeasuresSheet } from "@/components/measures-sheet";
import { Segmented } from "@/components/segmented";
import { SyncBanner } from "@/components/sync-banner";
import { Button } from "@/components/ui/button";
import { type Entry, Toast, useWriter } from "@/components/weigh-in";
import { WeighInSheet } from "@/components/weigh-in-sheet";
import { readWeekIntake } from "@/lib/display-prefs";
import { useFirstPull } from "@/lib/first-pull";
import { readRangePill } from "@/lib/home-trend";
import {
  formatKg,
  formatNumber,
  formatShortDay,
  formatWeekday,
  formatWeekRange,
  lossView,
} from "@/lib/format";
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
import { History } from "./body/history";

// The range pill as the validated drawing sets it: its check, then the number.
const rangePill =
  "inline-flex items-center gap-[3px] rounded-full bg-reference pr-[7px] pl-[5px] font-semibold text-reference-ink";

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
      <PageHeader title={t("body.title")} />
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
      <PageHeader title={t("body.title")} focusFallback />
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
  // A saved sheet plays its exit over the screen that already shows the record.
  const [leaving, setLeaving] = useState(false);
  // Device preferences from Réglages, read once per visit as Home reads its trend.
  const [rangePill] = useState(readRangePill);
  const [weekIntake] = useState(readWeekIntake);
  const { write, toast, error, clearError, dismiss } = useWriter(account);
  const close = () => {
    setOpen(null);
    setLeaving(false);
    clearError();
  };
  const save = async (entries: Entry[], previous: Entry[], text: string) => {
    if (await write(entries, previous, text)) setLeaving(true);
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
  // « All » starts at the earliest entry of any kind: a measure, an intake or an annotation may come
  // before the first weigh-in, or without any weigh-in at all.
  const earliest = [...weighings, ...measures, ...intake, ...annotations].reduce<ISODate>(
    (m, e) => (e.date < m ? e.date : m),
    today,
  );
  const from = period === "all" ? earliest : addDays(today, period === "month" ? -29 : -90);
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
  // During a course, said once under the figure: the scale may rise with water.
  const onCreatine = courses.some((c) => c.start <= today && today <= c.end);
  const marks: ChartMark[] = annotations.map((a) => ({
    id: a.id,
    date: a.date,
    label: annotationName(a, t),
  }));

  const summary = t("chart.summary", {
    from: formatShortDay(from, i18n.language, today),
    to: formatShortDay(to, i18n.language, today),
    average: average ? t("trend.kg", { value: formatKg(average.averageKg, i18n.language) }) : "—",
    loss: lossPct === null ? "—" : lossText(lossPct, t, i18n.language),
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
  // Each annotation of the period has its row, the newest first, wherever the weeks start; on one
  // day, the later made (its UUID v7 sorts after) comes first.
  const listedNotes = [...shownNotes].sort(
    (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
  );
  const weekday = (d: ISODate) => formatWeekday(d, i18n.language, today, { startOfLine: false });
  // Until this device has the account's data, the rows wait rather than say nothing was entered.
  const firstPull = useFirstPull(account);
  const weighed = weighings.find((w) => w.date === today);
  const weighInStatus: Status = firstPull
    ? null
    : weighed
      ? { text: t("trend.kg", { value: formatKg(weighed.weightKg, i18n.language) }), done: true }
      : { text: t("today.weighInEmpty"), done: false };
  // The latest measurement up to today: its waist, else its neck, else its hips.
  const lastMeasure = measures
    .filter((m) => m.date <= today && MEASURE_FIELDS.some((f) => measureOf(m, f) !== null))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .at(-1);
  const measureField =
    lastMeasure && MEASURE_FIELDS.find((f) => measureOf(lastMeasure, f) !== null);
  const measuresStatus: Status = firstPull
    ? null
    : lastMeasure && measureField
      ? {
          text: `${t(`body.dayParts.${measureField}`, {
            value: formatNumber(measureOf(lastMeasure, measureField)!, i18n.language, {
              digits: 1,
            }),
          })} · ${weekday(lastMeasure.date)}`,
          done: false,
        }
      : { text: t("body.entries.measuresNone"), done: false };

  return (
    <>
      <section aria-labelledby="figure" className={`${cardSurface} flex flex-col px-4 py-3.5`}>
        <h2 id="figure" className="text-[13px] font-semibold text-muted-foreground">
          {t("trend.average")}
        </h2>
        {weighings.length < MIN_WEIGHINGS ? (
          <FirstDays weighings={weighings} today={today} />
        ) : (
          <TrendFigure
            averageKg={average?.averageKg ?? null}
            lossPct={lossPct}
            pill={lossPct !== null && inTargetRange(lossPct, target) && rangePill === "shown"}
          />
        )}
        {onCreatine && (
          <p className="mt-2.5 border-t border-border pt-2.5 text-[13px] text-muted-foreground">
            {t("body.creatineNote")}
          </p>
        )}
      </section>
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
        <div className={`${cardSurface} px-2 pt-2.5 pb-1.5`}>
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
            {shownCourses.length > 0 && (
              <span className="flex items-center gap-1">
                <i className="size-2.5 rounded-[3px] bg-primary-soft ring-1 ring-primary-ink ring-inset" />
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
        </div>
      )}
      <section aria-labelledby="entries" className="flex flex-col gap-2">
        <h2 id="entries" className={sectionLabel}>
          {t("body.entries.title")}
        </h2>
        <div className={groupCard}>
          <EntryRow
            icon={Scale}
            title={t("today.weighIn")}
            status={weighInStatus}
            onClick={() => setOpen({ sheet: "weighIn", date: today })}
          />
          <EntryRow
            icon={Ruler}
            title={t("measures.title")}
            status={measuresStatus}
            onClick={() => setOpen({ sheet: "measures", date: today })}
          />
          <EntryRow
            icon={Flag}
            title={t("annotation.button")}
            status={{ text: t("body.entries.annotationSub"), done: false }}
            onClick={() => setOpen({ sheet: "annotation", annotation: null })}
          />
        </div>
      </section>
      {weighings.length >= MIN_WEIGHINGS && (
        <Weeks
          weeks={weeks.filter((w) => w.end >= from)}
          ctx={{
            firstWeek: weeks.at(-1)!.start,
            target,
            today,
            measures,
            intake,
            courses,
            pill: rangePill === "shown",
            showIntake: weekIntake === "shown",
            t,
            lang: i18n.language,
          }}
        />
      )}
      {listedNotes.length > 0 && (
        <section aria-labelledby="annotations" className="flex flex-col gap-2">
          <h2 id="annotations" className={sectionLabel}>
            {t("annotation.row")}
          </h2>
          <div className={groupCard}>
            {listedNotes.map((a) => (
              <EntryRow
                key={a.id}
                icon={Flag}
                title={annotationName(a, t)}
                status={{
                  // A note named by its own text says what it is before its day.
                  text: `${a.type === "note" && a.label ? `${t("annotation.kinds.note")} · ` : ""}${weekday(a.date)}`,
                  done: false,
                }}
                onClick={() => setOpen({ sheet: "annotation", annotation: a })}
              />
            ))}
          </div>
        </section>
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
          open={!leaving}
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
          open={!leaving}
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
          open={!leaving}
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

// A week's loss in words: a gain as a gain, and « stable » once it rounds to 0.0 %.
function lossText(pct: number, t: TFunction, lang: string): string {
  const { kind, value } = lossView(pct);
  if (value === 0) return t("trend.stable");
  const n = formatNumber(value, lang, { digits: 1, minDigits: 1 });
  return t(kind === "gain" ? "body.gainText" : "body.lossText", { value: n });
}

// Before 4 weigh-ins: no average yet, and why, without judging (§9).
function FirstDays({ weighings, today }: { weighings: Weighing[]; today: ISODate }) {
  const { t } = useTranslation();
  const monday = isoWeekStart(today);
  const thisWeek = weighings.filter((w) => w.date >= monday).length;
  return (
    <>
      <TrendFigure averageKg={null} lossPct={null} pill={false} />
      <h3 className="text-body font-semibold">
        {t("body.firstDays", { count: Math.max(1, MIN_WEIGHINGS - thisWeek) })}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{t("body.firstDaysBody")}</p>
    </>
  );
}

type WeekContext = {
  firstWeek: ISODate;
  target: TargetRange;
  today: ISODate;
  measures: Measure[];
  intake: IntakeLog[];
  courses: { start: ISODate; end: ISODate }[];
  // Whether the range pill and the weekly intake show, as Réglages sets them on this device.
  pill: boolean;
  showIntake: boolean;
  t: TFunction;
  lang: string;
};
type WeekValue = { kind: "toFollow" | "inRange" | "plain"; text: string };

// One week as its row says it: the title, the value at the right, the parts below, each part only
// when known.
function weekView(
  w: WeekSummary,
  ctx: WeekContext,
): { title: string; value: WeekValue; parts: string[] } {
  const { t, lang } = ctx;
  const title =
    w.status === "in_progress"
      ? t("body.thisWeek")
      : formatWeekRange(w.start, w.end, lang, ctx.today);
  const value: WeekValue =
    w.status === "in_progress"
      ? { kind: "toFollow", text: t("body.toFollow") }
      : w.status === "valid" && w.lossPct !== null
        ? {
            kind: ctx.pill && inTargetRange(w.lossPct, ctx.target) ? "inRange" : "plain",
            text: lossText(w.lossPct, t, lang),
          }
        : { kind: "plain", text: "—" };
  const why =
    w.status === "in_progress"
      ? // A week just begun says nothing rather than « 0 pesée »: no absence is ever pointed out.
        w.count > 0
        ? t("body.weighIns", { count: w.count })
        : null
      : w.status === "insufficient"
        ? t("body.tooFew", { count: w.count })
        : w.lossPct === null
          ? t(w.start === ctx.firstWeek ? "body.firstWeek" : "body.previousInsufficient")
          : null;
  const waist = weeklyWaist(ctx.measures, w.start);
  const food = weeklyIntake(ctx.intake, w.start);
  const onCreatine = ctx.courses.some((c) => c.start <= w.end && c.end >= w.start);
  const parts = [
    why,
    w.averageKg !== null && t("trend.kg", { value: formatKg(w.averageKg, lang) }),
    waist !== null && t("body.dayParts.waist", { value: formatNumber(waist, lang, { digits: 1 }) }),
    ctx.showIntake &&
      food.kcalAvg !== null &&
      t("body.kcal", { value: formatNumber(Math.round(food.kcalAvg), lang, { digits: 0 }) }),
    onCreatine && t("body.creatinePill"),
  ].filter((p): p is string => typeof p === "string");
  return { title, value, parts };
}

// The range pill's check: in the value of a week in the range, and once in the header.
const rangeCheck = <Check aria-hidden className="size-3" />;

// One row per ISO week, the most recent first: the title and the value, then the parts.
function Weeks({ weeks, ctx }: { weeks: WeekSummary[]; ctx: WeekContext }) {
  const { t } = ctx;
  const views = weeks.map((w) => ({ start: w.start, ...weekView(w, ctx) }));
  return (
    <section aria-labelledby="weeks" className="flex flex-col gap-2">
      <div className={`${sectionLabel} flex items-baseline justify-between`}>
        <h2 id="weeks">{t("body.weeks")}</h2>
        {views.some((v) => v.value.kind === "inRange") && (
          <span className="flex items-center gap-1 font-medium">
            <span className="inline-flex self-center rounded-full bg-reference px-[5px] py-px text-reference-ink">
              {rangeCheck}
            </span>
            <span>{t("body.inRange")}</span>
          </span>
        )}
      </div>
      <ul className={groupCard}>
        {views.map(({ start, title, value, parts }) => (
          <li
            key={start}
            className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 px-4 py-[9px]"
          >
            <span className="text-body font-semibold">{title}</span>
            <span className="text-right text-body font-semibold tabular-nums">
              {value.kind === "toFollow" ? (
                <span className="rounded-full bg-track px-2 py-0.5 text-[13px] font-semibold text-muted-foreground">
                  {value.text}
                </span>
              ) : value.kind === "inRange" ? (
                <span className={`${rangePill} text-xs`}>
                  {rangeCheck}
                  {value.text}
                  <span className="sr-only">{` ${t("body.inRange")}`}</span>
                </span>
              ) : (
                value.text
              )}
            </span>
            <span className="col-span-2 flex flex-wrap gap-x-1.5 text-[13px] text-muted-foreground tabular-nums">
              {parts.map((p, i) => (
                <span key={p} className="whitespace-nowrap">
                  {i < parts.length - 1 ? `${p} ·` : p}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// A line of a grouped list, drawn as Home's gesture rows; the whole line opens its sheet.
function EntryRow({
  icon,
  title,
  status,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  status: Status;
  onClick: () => void;
}) {
  return (
    <button type="button" className={rowLine} onClick={onClick}>
      <RowBody icon={icon} title={title} status={status} />
    </button>
  );
}
