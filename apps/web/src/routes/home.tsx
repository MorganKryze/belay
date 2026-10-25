import type { ISODate } from "@belay/shared/body/dates";
import { inTargetRange } from "@belay/shared/body/target";
import { latestMovingAverage, type Weighing, weeklySummaries } from "@belay/shared/body/weighings";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AvatarLink } from "@/components/avatar";
import { PageHeader } from "@/components/page-header";
import { cardSurface, sectionLabel } from "@/components/surfaces";
import { SyncBanner } from "@/components/sync-banner";
import { TodayCard } from "@/components/today-card";
import { TodaySession } from "@/components/today-session";
import { TrendFigure } from "@/components/trend-figure";
import { Button } from "@/components/ui/button";
import { formatWeekday } from "@/lib/format";
import { readHomeTrend, readRangePill } from "@/lib/home-trend";
import { useToday } from "@/lib/today";
import {
  type OpenAccount,
  useAccount,
  useCloseForgotten,
  useTarget,
  useWeighings,
} from "@/sync/account";
import { Pending } from "./fallbacks";

// What the server puts in `/?signin=` when a sign-in fails (apps/server/src/auth/routes.ts).
const SIGNIN_FAILURES = ["unavailable", "expired", "failed", "denied"] as const;
type SigninFailure = (typeof SIGNIN_FAILURES)[number];
const isSigninFailure = (v: unknown): v is SigninFailure =>
  (SIGNIN_FAILURES as readonly unknown[]).includes(v);

export function Home() {
  const { t } = useTranslation();
  const { signin } = useSearch({ from: "/" });
  const navigate = useNavigate();
  // Read once: the param is stripped from the URL right below, and the message outlives it.
  const [failure] = useState(() => (isSigninFailure(signin) ? signin : undefined));
  useEffect(() => {
    // Also strips an unknown value. Replaced, not pushed, so Back never returns to it and a
    // reload does not show the message again.
    if (signin !== undefined) {
      void navigate({ to: "/", search: (prev) => ({ ...prev, signin: undefined }), replace: true });
    }
  }, [signin, navigate]);
  const account = useAccount();

  if (account.kind === "open") return <SignedInHome account={account} />;
  // The launch screen covers this wait; past it, the loader. A header now would name the app and a
  // blank avatar, then change to the greeting a moment later.
  if (account.kind === "loading") return <Pending title={false} />;
  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title={
          account.kind === "unavailable"
            ? t("home.greeting", { name: account.user.displayName })
            : t("app.name")
        }
        trailing={
          // From 1 024 px the top bar carries the avatar to Réglages: one is enough.
          <div className="lg:hidden">
            <AvatarLink
              name={account.kind === "unavailable" ? account.user.displayName : undefined}
            />
          </div>
        }
      />
      {failure && account.kind === "signed-out" && <p role="alert">{t(`signin.${failure}`)}</p>}
      {account.kind === "signed-out" && account.unreachable && (
        <p role="status">{t("home.serverDown")}</p>
      )}
      {account.kind === "unavailable" && <p role="status">{t("account.unavailable")}</p>}
      {account.kind === "signed-out" && (
        <Button asChild>
          <a href={`/auth/login?returnTo=${encodeURIComponent("/")}`}>{t("home.signIn")}</a>
        </Button>
      )}
      <Link
        to="/tools"
        className="-ml-1 inline-flex min-h-11 items-center gap-0.5 self-start font-medium text-primary"
      >
        {t("home.toolsLink")}
        <ChevronRight aria-hidden className="size-5" />
      </Link>
    </section>
  );
}

// Home opens on the day's date and its session, then the gestures of the day and the trend;
// Body holds the rest.
function SignedInHome({ account }: { account: OpenAccount }) {
  const { t, i18n } = useTranslation();
  const today = useToday();
  const weighings = useWeighings(account).data;
  // Read once per visit to Accueil: Réglages changes it on another screen.
  const [trend] = useState(readHomeTrend);
  useCloseForgotten(account);
  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title={t("home.greeting", { name: account.user.displayName })}
        eyebrow={formatWeekday(today, i18n.language, today, { long: true })}
        trailing={
          <div className="lg:hidden">
            <AvatarLink name={account.user.displayName} />
          </div>
        }
      />
      <SyncBanner account={account} />
      <TodaySession account={account} today={today} />
      {weighings && (
        <>
          <TodayCard account={account} weighings={weighings} today={today} />
          {trend === "shown" && <TrendCard account={account} weighings={weighings} today={today} />}
        </>
      )}
    </section>
  );
}

// The 7-day average as the card's figure, and the loss of the last complete week; nothing before
// the first weigh-in. The whole card opens Body, whose figure card shows the same figure.
function TrendCard({
  account,
  weighings,
  today,
}: {
  account: OpenAccount;
  weighings: Weighing[];
  today: ISODate;
}) {
  const { t } = useTranslation();
  const target = useTarget(account).data;
  // Read once per visit, as Home reads its trend.
  const [rangePill] = useState(readRangePill);
  if (weighings.length === 0) return null;
  const average = latestMovingAverage(weighings, today);
  const week = weeklySummaries(weighings, today).find((w) => w.status !== "in_progress");
  const lossPct = week?.lossPct ?? null;
  return (
    <section aria-labelledby="trend" className="flex flex-col gap-2">
      <h2 id="trend" className={sectionLabel}>
        {t("trend.title")}
      </h2>
      <Link to="/body" className={`${cardSurface} flex flex-col px-4 py-3.5`}>
        <span className="flex items-center justify-between text-[13px] font-semibold text-muted-foreground">
          {t("trend.average")}
          <ChevronRight aria-hidden className="size-4" />
        </span>
        <TrendFigure
          averageKg={average?.averageKg ?? null}
          lossPct={lossPct}
          pill={
            rangePill === "shown" &&
            lossPct !== null &&
            target !== undefined &&
            inTargetRange(lossPct, target)
          }
        />
      </Link>
    </section>
  );
}
