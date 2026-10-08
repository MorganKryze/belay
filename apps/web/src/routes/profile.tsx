import { isTargetRange, TARGET_BOUNDS, type TargetRange } from "@belay/shared/body/target";
import { roundTo } from "@belay/shared/tools/round";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NumberStepper } from "@/components/number-stepper";
import { ScienceSheet } from "@/components/science-sheet";
import { Button } from "@/components/ui/button";
import { type OpenAccount, useAccount, useRecord, useTarget } from "@/sync/account";

const back = "-ml-1 inline-flex min-h-11 items-center gap-0.5 font-medium text-primary";
const sectionTitle = "mx-0.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase";

// Settings › Profile. In M2a, the loss range only (D10): sex, birth year and height come in M2b
// with the tools that use them (minimisation, brief §3.7).
export function Profile() {
  const { t } = useTranslation();
  const account = useAccount();
  return (
    <section className="flex flex-col gap-4">
      <div>
        <Link to="/settings" activeOptions={{ exact: true }} className={back}>
          <ChevronLeft aria-hidden className="size-5" />
          {t("settings.title")}
        </Link>
        <h1 className="text-[26px] leading-tight font-bold tracking-tight">{t("profile.title")}</h1>
      </div>
      {account.kind === "open" && <TargetRangeSection account={account} />}
      {account.kind === "unavailable" && <p>{t("account.unavailable")}</p>}
      {account.kind === "signed-out" && (
        <>
          <p>{t("body.signedOut")}</p>
          <Button asChild className="self-start">
            <a href={`/auth/login?returnTo=${encodeURIComponent("/settings/profile")}`}>
              {t("home.signIn")}
            </a>
          </Button>
        </>
      )}
    </section>
  );
}

// Two steppers in steps of 0.05, from 0.25 to 1 %, the lower at least 0.1 under the upper: each
// stepper's bounds follow the other, so no tap can break the range.
function TargetRangeSection({ account }: { account: OpenAccount }) {
  const { t } = useTranslation();
  const target = useTarget(account).data;
  const record = useRecord(account);
  const [failed, setFailed] = useState(false);
  if (!target) return null;
  const { min, max, step, gap } = TARGET_BOUNDS;
  const set = (next: TargetRange) => {
    const range = { minPct: roundTo(next.minPct, step), maxPct: roundTo(next.maxPct, step) };
    if (isTargetRange(range))
      record({ kind: "target", ...range, at: new Date().toISOString() }).then(
        () => setFailed(false),
        () => setFailed(true),
      );
  };
  return (
    <section aria-labelledby="range" className="flex flex-col gap-2">
      <h2 id="range" className={sectionTitle}>
        {t("profile.range")}
      </h2>
      <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">{t("profile.rangeLead")}</p>
        <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
          <NumberStepper
            label={t("profile.min")}
            value={target.minPct}
            onChange={(v) => v !== null && set({ ...target, minPct: v })}
            min={min}
            max={roundTo(target.maxPct - gap, step)}
            step={step}
            unit="%"
          />
          <NumberStepper
            label={t("profile.max")}
            value={target.maxPct}
            onChange={(v) => v !== null && set({ ...target, maxPct: v })}
            min={roundTo(target.minPct + gap, step)}
            max={max}
            step={step}
            unit="%"
          />
        </div>
        {failed && (
          <p role="alert" className="text-sm">
            {t("weighIn.saveFailed")}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{t("profile.rangeNote")}</p>
      </div>
      <ScienceSheet toolId="target-rate" title={t("profile.howChosen")} />
    </section>
  );
}
