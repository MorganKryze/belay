import { addDays, type ISODate, isoWeekStart } from "@belay/shared/body/dates";
import { inTargetRange, type TargetRange } from "@belay/shared/body/target";
import {
  latestMovingAverage,
  MIN_WEIGHINGS,
  movingAverageSeries,
  type WeekSummary,
  type Weighing,
  weeklySummaries,
} from "@belay/shared/body/weighings";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "@/components/segmented";
import { SyncBanner } from "@/components/sync-banner";
import { Button } from "@/components/ui/button";
import { dayLabel, Toast, useWeighInWriter } from "@/components/weigh-in";
import { WeighInSheet } from "@/components/weigh-in-sheet";
import { formatKg, formatNumber, formatShortDay, formatWeekRange, lossView } from "@/lib/format";
import { useToday } from "@/lib/today";
import {
  type Account,
  type OpenAccount,
  useAccount,
  useTarget,
  useWeighings,
} from "@/sync/account";
import { WeightChart } from "./body/chart";

const title = "text-[26px] leading-tight font-bold tracking-tight";
const card = "rounded-card border border-border bg-card";
const sectionTitle = "text-[15px] font-bold";
const pill = "rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap";
const neutralPill = `${pill} bg-track text-muted-foreground`;
const rangePill = `${pill} bg-reference text-reference-ink`;

type Period = "month" | "quarter" | "all";

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
  return (
    <section className="flex flex-col gap-4">
      <h1 tabIndex={-1} data-focus-fallback className={`${title} outline-none`}>
        {t("body.title")}
      </h1>
      <SyncBanner account={account} />
      {weighings && target && (
        <BodyContent account={account} weighings={weighings} target={target} today={today} />
      )}
    </section>
  );
}

function BodyContent({
  account,
  weighings,
  target,
  today,
}: {
  account: OpenAccount;
  weighings: Weighing[];
  target: TargetRange;
  today: ISODate;
}) {
  const { t, i18n } = useTranslation();
  const [period, setPeriod] = useState<Period>("month");
  const [sheetDate, setSheetDate] = useState<ISODate | null>(null);
  const { write, toast, dismiss } = useWeighInWriter(account, weighings);
  const save = (day: ISODate, kg: number | null) => {
    if (write(day, kg)) setSheetDate(null);
  };

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
          <div aria-hidden className="mb-1 flex gap-3 px-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <i className="size-[7px] rounded-full bg-chart-dot" />
              {t("chart.daily")}
            </span>
            <span className="flex items-center gap-1">
              <i className="h-[2.5px] w-3.5 bg-chart-line" />
              {t("chart.average")}
            </span>
          </div>
          <WeightChart
            weighings={shown}
            averages={movingAverageSeries(weighings, from, to)}
            from={from}
            to={to}
            summary={summary}
            onSelect={setSheetDate}
          />
        </div>
      )}
      {weighings.length < MIN_WEIGHINGS ? (
        <FirstDays weighings={weighings} today={today} />
      ) : (
        <>
          <Figures average={average?.averageKg ?? null} lossPct={lossPct} target={target} />
          <Weeks
            weeks={weeks.filter((w) => w.end >= from)}
            firstWeek={weeks.at(-1)!.start}
            target={target}
            today={today}
            lossText={lossText}
          />
        </>
      )}
      <History weighings={shown} today={today} onSelect={setSheetDate} />
      {sheetDate && (
        <WeighInSheet
          open
          onClose={() => setSheetDate(null)}
          weighings={weighings}
          today={today}
          date={sheetDate}
          onDate={setSheetDate}
          onSave={save}
          onDelete={(day) => save(day, null)}
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

// One line per ISO week, the most recent first, saying in words why a week does not count.
function Weeks({
  weeks,
  firstWeek,
  target,
  today,
  lossText,
}: {
  weeks: WeekSummary[];
  firstWeek: ISODate;
  target: TargetRange;
  today: ISODate;
  lossText: (pct: number) => string;
}) {
  const { t, i18n } = useTranslation();
  const sub = "text-xs text-muted-foreground";
  return (
    <section aria-labelledby="weeks" className="flex flex-col gap-1.5">
      <h2 id="weeks" className={sectionTitle}>
        {t("body.weeks")}
      </h2>
      <ul className={`${card} px-3`}>
        {weeks.map((w) => (
          <li
            key={w.start}
            className="flex min-h-[52px] items-center justify-between gap-3 border-t border-border py-1.5 first:border-t-0"
          >
            <span className="flex flex-col text-sm">
              <span className="whitespace-nowrap">
                {w.status === "in_progress"
                  ? t("body.thisWeek")
                  : formatWeekRange(w.start, w.end, i18n.language, today)}
              </span>
              <span className={sub}>
                {w.status === "in_progress" && t("body.inProgress", { count: w.count })}
                {w.status === "insufficient" && t("body.tooFew", { count: w.count })}
                {w.status === "valid" && (
                  <>
                    {t("body.weekAverage")}{" "}
                    <b className="font-semibold text-foreground">
                      {t("trend.kg", { value: formatKg(w.averageKg!, i18n.language) })}
                    </b>
                  </>
                )}
              </span>
            </span>
            <span className="flex flex-col items-end gap-0.5 text-right">
              {w.status === "in_progress" && (
                <span className={neutralPill}>{t("body.toFollow")}</span>
              )}
              {w.status === "insufficient" && (
                <span className={neutralPill}>{t("body.insufficient")}</span>
              )}
              {w.status === "valid" && w.lossPct !== null && (
                <>
                  <b className="text-sm tabular-nums">{lossText(w.lossPct)}</b>
                  {inTargetRange(w.lossPct, target) && (
                    <span className={rangePill}>{t("body.inRange")}</span>
                  )}
                </>
              )}
              {w.status === "valid" && w.lossPct === null && (
                <>
                  <b aria-hidden>—</b>
                  <span className={sub}>
                    {w.start === firstWeek ? t("body.firstWeek") : t("body.previousInsufficient")}
                  </span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// One line per weigh-in of the period, the most recent first; a tap opens its edit sheet.
// ponytail: "All" renders every line at once. Upgrade: show the latest hundred and a "More" button.
function History({
  weighings,
  today,
  onSelect,
}: {
  weighings: Weighing[];
  today: ISODate;
  onSelect: (date: ISODate) => void;
}) {
  const { t, i18n } = useTranslation();
  if (weighings.length === 0) return null;
  return (
    <section aria-labelledby="history" className="flex flex-col gap-1">
      <h2 id="history" className={sectionTitle}>
        {t("body.history")}
      </h2>
      <ul>
        {[...weighings].reverse().map((w) => (
          <li key={w.date} className="border-t border-border first:border-t-0">
            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-between py-1 text-left"
              onClick={() => onSelect(w.date)}
            >
              <span>{dayLabel(w.date, today, t, i18n.language)}</span>
              <b className="tabular-nums">
                {t("trend.kg", { value: formatKg(w.weightKg, i18n.language) })}
              </b>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
