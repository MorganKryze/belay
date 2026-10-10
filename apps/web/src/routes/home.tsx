import type { ISODate } from "@belay/shared/body/dates";
import { latestMovingAverage, type Weighing, weeklySummaries } from "@belay/shared/body/weighings";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SyncBanner } from "@/components/sync-banner";
import { TodayCard } from "@/components/today-card";
import { Button } from "@/components/ui/button";
import { formatKg, formatNumber, lossView } from "@/lib/format";
import { useToday } from "@/lib/today";
import { type OpenAccount, useAccount, useCloseForgotten, useWeighings } from "@/sync/account";

// What the server puts in `/?signin=` when a sign-in fails (apps/server/src/auth/routes.ts).
const SIGNIN_FAILURES = ["unavailable", "expired", "failed", "denied"] as const;
type SigninFailure = (typeof SIGNIN_FAILURES)[number];
const isSigninFailure = (v: unknown): v is SigninFailure =>
  (SIGNIN_FAILURES as readonly unknown[]).includes(v);

const title = "text-[26px] leading-tight font-bold tracking-tight";

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
  return (
    <section className="flex flex-col gap-4">
      {account.kind === "unavailable" ? (
        <h1 className={title}>{t("home.greeting", { name: account.user.displayName })}</h1>
      ) : (
        <h1 className="text-3xl font-semibold">{t("app.name")}</h1>
      )}
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
      {account.kind !== "loading" && (
        <Link
          to="/tools"
          className="-ml-1 inline-flex min-h-11 items-center gap-0.5 self-start font-medium text-primary"
        >
          {t("home.toolsLink")}
          <ChevronRight aria-hidden className="size-5" />
        </Link>
      )}
    </section>
  );
}

// Home is the gestures of the day (D1): the "Today" card, the trend, then Body for the rest.
function SignedInHome({ account }: { account: OpenAccount }) {
  const { t } = useTranslation();
  const today = useToday();
  const weighings = useWeighings(account).data;
  useCloseForgotten(account);
  return (
    <section className="flex flex-col gap-4">
      <h1 className={title}>{t("home.greeting", { name: account.user.displayName })}</h1>
      <SyncBanner account={account} />
      {weighings && (
        <>
          <TodayCard account={account} weighings={weighings} today={today} />
          <TrendCard weighings={weighings} today={today} />
        </>
      )}
    </section>
  );
}

// The 7-day average and the loss of the last complete week; nothing before the first weigh-in.
function TrendCard({ weighings, today }: { weighings: Weighing[]; today: ISODate }) {
  const { t, i18n } = useTranslation();
  if (weighings.length === 0) return null;
  const average = latestMovingAverage(weighings, today);
  const week = weeklySummaries(weighings, today).find((w) => w.status !== "in_progress");
  const lossPct = week?.lossPct ?? null;
  const loss = lossPct === null ? null : lossView(lossPct);
  const strong = "font-semibold whitespace-nowrap text-foreground";
  return (
    <section
      aria-labelledby="trend"
      className="flex flex-col gap-1 rounded-card border border-border bg-card p-4"
    >
      <h2 id="trend" className="text-[15px] font-semibold">
        {t("trend.title")}
      </h2>
      <p className="text-sm text-muted-foreground">
        {t("trend.average")}{" "}
        <span className={strong}>
          {average ? t("trend.kg", { value: formatKg(average.averageKg, i18n.language) }) : "—"}
        </span>
        {" · "}
        {t(loss?.kind === "gain" ? "trend.gain" : "trend.loss")}{" "}
        <span className={strong}>
          {loss
            ? t("trend.perWeek", {
                value: formatNumber(loss.value, i18n.language, { digits: 1, minDigits: 1 }),
              })
            : "—"}
        </span>
      </p>
      <Link
        to="/body"
        className="-mr-1 inline-flex min-h-11 items-center gap-0.5 self-end font-semibold text-primary"
      >
        {t("trend.link")}
        <ChevronRight aria-hidden className="size-5" />
      </Link>
    </section>
  );
}
