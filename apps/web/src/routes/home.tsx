import { type ISODate, toISODate } from "@belay/shared/body/dates";
import { latestMovingAverage, type Weighing, weeklySummaries } from "@belay/shared/body/weighings";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Check, ChevronRight } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SyncBanner } from "@/components/sync-banner";
import { Button } from "@/components/ui/button";
import { Toast, useWeighInWriter, WeighInForm } from "@/components/weigh-in";
import { formatKg, formatNumber, lossView } from "@/lib/format";
import { useToday } from "@/lib/today";
import { type OpenAccount, useAccount, useWeighings } from "@/sync/account";

// What the server puts in `/?signin=` when a sign-in fails (apps/server/src/auth/routes.ts).
const SIGNIN_FAILURES = ["unavailable", "expired", "failed"] as const;
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

// Lazy: the dialog code loads the first time someone taps Edit.
const WeighInSheet = lazy(() =>
  import("@/components/weigh-in-sheet").then((m) => ({ default: m.WeighInSheet })),
);

// Home is the gesture of the day (D7): weigh in, see the trend, go to Body for the rest.
function SignedInHome({ account }: { account: OpenAccount }) {
  const { t } = useTranslation();
  const today = useToday();
  const weighings = useWeighings(account).data;
  return (
    <section className="flex flex-col gap-4">
      <h1 className={title}>{t("home.greeting", { name: account.user.displayName })}</h1>
      <SyncBanner account={account} />
      {weighings && <HomeCards account={account} weighings={weighings} today={today} />}
    </section>
  );
}

function HomeCards({
  account,
  weighings,
  today,
}: {
  account: OpenAccount;
  weighings: Weighing[];
  today: ISODate;
}) {
  const { t, i18n } = useTranslation();
  const { write, toast, dismiss } = useWeighInWriter(account, weighings);
  const [date, setDate] = useState<ISODate | null>(null); // null: today, whatever the clock says
  const [sheetDate, setSheetDate] = useState<ISODate | null>(null);
  const done = weighings.find((w) => w.date === today);
  const save = (day: ISODate, kg: number | null) => {
    if (!write(day, kg)) return;
    setDate(null);
    setSheetDate(null);
  };
  return (
    <>
      <section
        aria-labelledby="weigh-in"
        className="flex flex-col gap-2 rounded-card border border-border bg-card p-4"
      >
        <h2
          id="weigh-in"
          tabIndex={-1}
          data-focus-fallback
          className="text-[15px] font-semibold text-primary-ink outline-none"
        >
          {t("weighIn.title")}
        </h2>
        {done && date === null ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[28px] leading-none font-extrabold tabular-nums">
                {formatKg(done.weightKg, i18n.language)}
                <span className="ml-1 text-[13px] font-semibold text-muted-foreground">kg</span>
              </p>
              <span className="inline-flex items-center gap-1 rounded-full bg-reference px-2.5 py-1 text-[13px] font-semibold text-reference-ink">
                <Check aria-hidden className="size-4" />
                {t("weighIn.saved")}
              </span>
            </div>
            <Button
              variant="link"
              className="-ml-3 self-start text-[15px] font-semibold"
              onClick={() => setSheetDate(today)}
            >
              {t("weighIn.edit")}
            </Button>
          </>
        ) : (
          <WeighInForm
            key={date ?? today}
            weighings={weighings}
            today={today}
            date={date ?? today}
            onDate={setDate}
            // "Today" is read when Save is tapped: the screen may have been drawn yesterday.
            onSave={(day, kg) => save(date ?? toISODate(new Date()), kg)}
          />
        )}
      </section>
      <TrendCard weighings={weighings} today={today} />
      {sheetDate && (
        <Suspense fallback={null}>
          <WeighInSheet
            open
            onClose={() => setSheetDate(null)}
            weighings={weighings}
            today={today}
            date={sheetDate}
            onDate={setSheetDate}
            onSave={(day, kg) => save(day, kg)}
            onDelete={(day) => save(day, null)}
          />
        </Suspense>
      )}
      <Toast toast={toast} onDone={dismiss} />
    </>
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
