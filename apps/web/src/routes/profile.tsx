import "@/i18n/lazy";
import { birthYearRange } from "@belay/shared/body/profile";
import { isTargetRange, TARGET_BOUNDS, type TargetRange } from "@belay/shared/body/target";
import type { ProfileChange } from "@belay/shared/sync/schema";
import { HEIGHT_RANGE_CM } from "@belay/shared/tools/bounds";
import type { ToolId } from "@belay/shared/tools/catalog";
import { roundTo } from "@belay/shared/tools/round";
import { Plus } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { groupCard, sectionLabel } from "@/components/grouped-list";
import { BackLink, PageHeader } from "@/components/page-header";
import { NumberStepper } from "@/components/number-stepper";
import { ScienceSheet } from "@/components/science-sheet";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { useToday } from "@/lib/today";
import { type OpenAccount, useAccount, useProfile, useRecord, useTarget } from "@/sync/account";

const card = `${groupCard} flex flex-col`;

// Settings › Profile: the facts the tools start from (D8), each optional and cleared in one tap,
// and the loss range.
export function Profile() {
  const { t } = useTranslation();
  const account = useAccount();
  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title={t("profile.title")}
        focusFallback
        back={
          <BackLink to="/settings" activeOptions={{ exact: true }}>
            {t("settings.title")}
          </BackLink>
        }
      >
        {account.kind === "open" && (
          <p className="mt-1 text-sm text-muted-foreground">{t("profile.lead")}</p>
        )}
      </PageHeader>
      {account.kind === "open" && (
        <>
          <BodySection account={account} />
          <TargetRangeSection account={account} />
        </>
      )}
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

// Writes one fact of the profile; says so when the phone refuses.
function useProfileWriter(account: OpenAccount) {
  const record = useRecord(account);
  const [failed, setFailed] = useState(false);
  const write = (change: Omit<ProfileChange, "at">) =>
    record({ ...change, at: new Date().toISOString() } as ProfileChange).then(
      () => setFailed(false),
      () => setFailed(true),
    );
  return { write, failed };
}

// Formula, year of birth, height: each with the tools it serves, "Clear" when it is set, and
// "+ Fill in" when it is not. The age is never stored, only the year.
function BodySection({ account }: { account: OpenAccount }) {
  const { t } = useTranslation();
  const profile = useProfile(account).data;
  const today = useToday();
  const { write, failed } = useProfileWriter(account);
  if (!profile) return null;
  const tools = (ids: ToolId[]) =>
    t("profile.uses", { tools: ids.map((id) => t(`tools.items.${id}.name`)).join(", ") });
  const years = birthYearRange(today);
  return (
    <section aria-labelledby="body-facts" className="flex flex-col gap-2">
      <h2 id="body-facts" className={sectionLabel}>
        {t("profile.body")}
      </h2>
      <div className={`${card} px-4 py-1`}>
        <Fact
          label={t("tools.formula.label")}
          set={profile.formula !== null}
          uses={tools(["energy", "body-fat"])}
          onClear={() => void write({ kind: "profile", field: "formula", value: null })}
        >
          <Segmented
            label={t("tools.formula.label")}
            labelHidden
            value={profile.formula}
            options={[
              { value: "female", label: t("tools.formula.female") },
              { value: "male", label: t("tools.formula.male") },
            ]}
            onChange={(formula) =>
              void write({ kind: "profile", field: "formula", value: formula })
            }
          />
        </Fact>
        <Fact
          label={t("profile.birthYear")}
          set={profile.birthYear !== null}
          uses={tools(["energy"])}
          onClear={() => void write({ kind: "profile", field: "birthYear", value: null })}
        >
          <FactStepper
            label={t("profile.birthYear")}
            value={profile.birthYear}
            min={years.min}
            max={years.max}
            onChange={(value) => void write({ kind: "profile", field: "birthYear", value })}
          />
        </Fact>
        <Fact
          label={t("profile.height")}
          set={profile.heightCm !== null}
          uses={tools(["bmi", "body-fat", "energy"])}
          onClear={() => void write({ kind: "profile", field: "height", value: null })}
        >
          <FactStepper
            label={t("profile.height")}
            unit="cm"
            value={profile.heightCm}
            min={HEIGHT_RANGE_CM.min}
            max={HEIGHT_RANGE_CM.max}
            onChange={(value) => void write({ kind: "profile", field: "height", value })}
          />
        </Fact>
      </div>
      {failed && (
        <p role="alert" className="text-sm">
          {t("weighIn.saveFailed")}
        </p>
      )}
    </section>
  );
}

// One fact: its name and "Clear" on one line, the control (or "+ Fill in"), what it serves.
function Fact({
  label,
  set,
  uses,
  onClear,
  children,
}: {
  label: string;
  set: boolean;
  uses: string;
  onClear: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [filling, setFilling] = useState(false);
  const shown = set || filling;
  // Where the keyboard focus goes once the control or the "+ Fill in" button is swapped in.
  const next = useRef<"control" | "fill" | null>(null);
  const control = useRef<HTMLDivElement>(null);
  const fillButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (next.current === "control")
      control.current?.querySelector<HTMLElement>("input, [role=radio]")?.focus();
    else if (next.current === "fill") fillButton.current?.focus();
    else return;
    next.current = null;
  }, [shown]);
  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">{label}</h3>
        {set && (
          <Button
            variant="text"
            aria-label={t("profile.clearField", { field: label })}
            onClick={() => {
              setFilling(false);
              next.current = "fill";
              onClear();
            }}
          >
            {t("profile.clear")}
          </Button>
        )}
      </div>
      {shown ? (
        <div ref={control}>{children}</div>
      ) : (
        <Button
          ref={fillButton}
          variant="secondary"
          className="w-full"
          aria-label={t("profile.fillField", { field: label })}
          onClick={() => {
            next.current = "control";
            setFilling(true);
          }}
        >
          <Plus aria-hidden className="size-4" />
          {t("profile.fill")}
        </Button>
      )}
      <p className="text-[13px] text-muted-foreground">{uses}</p>
    </div>
  );
}

// A whole number, written only when typed whole and in range: "19" is not a year, and a field
// left half-typed goes back to the stored value. Empty until the person types.
function FactStepper({
  label,
  unit,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  unit?: string;
  value: number | null;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <NumberStepper
      label={label}
      labelHidden
      unit={unit}
      value={value}
      min={min}
      max={max}
      step={1}
      optional
      clampTyped={false}
      inertWhenEmpty
      onChange={(v) =>
        v !== null && v !== value && Number.isInteger(v) && v >= min && v <= max && onChange(v)
      }
    />
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
      <h2 id="range" className={sectionLabel}>
        {t("profile.range")}
      </h2>
      <div className={`${card} gap-3 p-4`}>
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
