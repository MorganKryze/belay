import { WEIGHT_RANGE_KG } from "@belay/shared/tools/bounds";
import {
  kgPerWeek,
  projectLoss,
  RATE_MAX_PCT,
  RATE_MIN_PCT,
  RATE_PRESETS,
  RATE_STEP_PCT,
  rateWarning,
} from "@belay/shared/tools/projection";
import { roundTo } from "@belay/shared/tools/round";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { MonthStrip } from "@/components/month-strip";
import { NumberStepper } from "@/components/number-stepper";
import { RestoreButton, usePrefill } from "@/components/prefill";
import { ResultCard } from "@/components/result-card";
import { Segmented } from "@/components/segmented";
import { ToolPage } from "@/components/tool-page";
import { attempt } from "@/lib/attempt";
import { formatDay, formatNumber } from "@/lib/format";
import { useTool } from "@/lib/tool-storage";

export const ProjectionInputs = z.object({
  targetKg: z.number().min(WEIGHT_RANGE_KG.min).max(WEIGHT_RANGE_KG.max).catch(75),
  pct: z.number().min(RATE_MIN_PCT).max(RATE_MAX_PCT).catch(0.75),
  fine: z.boolean().catch(false),
});

export function ProjectionTool() {
  const { t, i18n } = useTranslation();
  const { state, update, inputs, setInputs } = useTool("projection", ProjectionInputs);
  const [today] = useState(() => new Date());
  const prefill = usePrefill(["weightKg"]);
  const currentKg = prefill.value("weightKg", state.weightKg ?? 80);
  const p = attempt(() => projectLoss(currentKg, inputs.targetKg, inputs.pct, today));
  const warning = rateWarning(inputs.pct);
  const n = (v: number, digits = 1) => formatNumber(v, i18n.language, { digits });
  const preset = RATE_PRESETS.find((r) => r.pct === inputs.pct);
  // A stored pace that matches no preset opens in fine tuning.
  const fine = inputs.fine || !preset;
  return (
    <ToolPage
      title={t("tools.items.projection.name")}
      lead={t("projection.lead")}
      toolId="projection"
    >
      <div className="grid grid-cols-2 gap-2.5">
        <NumberStepper
          label={t("projection.current")}
          unit="kg"
          value={currentKg}
          min={WEIGHT_RANGE_KG.min}
          max={WEIGHT_RANGE_KG.max}
          step={0.5}
          buttons={false}
          onChange={(v) => {
            if (v === null) return;
            prefill.edit("weightKg");
            update((s) => ({ ...s, weightKg: v }));
          }}
          hint={prefill.hint("weightKg")}
        />
        <NumberStepper
          label={t("projection.target")}
          unit="kg"
          value={inputs.targetKg}
          min={WEIGHT_RANGE_KG.min}
          max={WEIGHT_RANGE_KG.max}
          step={0.5}
          buttons={false}
          onChange={(v) => v !== null && setInputs({ targetKg: v })}
        />
      </div>
      <RestoreButton prefill={prefill} />
      {fine ? (
        <NumberStepper
          label={t("projection.fineLabel")}
          unit="%"
          value={inputs.pct}
          min={RATE_MIN_PCT}
          max={RATE_MAX_PCT}
          step={RATE_STEP_PCT}
          // Fine tuning stays on a pace that lands on a preset: the stepper keeps the focus.
          onChange={(v) => v !== null && setInputs({ pct: roundTo(v, RATE_STEP_PCT), fine: true })}
        />
      ) : (
        <>
          <Segmented
            label={t("projection.rate")}
            hint={t("projection.rateHint")}
            value={preset.id}
            options={[
              { value: "gentle", label: t("projection.rates.gentle") },
              { value: "balanced", label: t("projection.rates.balanced") },
              { value: "steady", label: t("projection.rates.steady") },
            ]}
            onChange={(id) => setInputs({ pct: RATE_PRESETS.find((r) => r.id === id)!.pct })}
          />
          <p className="-mt-2 text-[13px] text-muted-foreground tabular-nums">
            {t("projection.rateLine", {
              pct: n(preset.pct, 2),
              kg: n(roundTo(kgPerWeek(currentKg, preset.pct), 0.1)),
            })}
          </p>
        </>
      )}
      <button
        type="button"
        className="-mt-2 min-h-11 self-end text-[13px] font-semibold text-primary"
        onClick={() => setInputs(fine ? { fine: false, pct: preset?.pct ?? 0.75 } : { fine: true })}
      >
        {fine ? t("projection.presets") : `${t("projection.fine")} ›`}
      </button>
      {p?.kind === "ok" && warning !== "none" && (
        <p className="flex gap-2 rounded-field border border-border bg-card p-3 text-sm">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t(warning === "above-1.5" ? "projection.above15" : "projection.above1")}
        </p>
      )}
      <ResultCard label={t("projection.result")}>
        {p?.kind === "ok" && (
          <>
            <p className="text-[22px] leading-tight font-bold tracking-tight">
              {t("projection.between", {
                low: formatDay(p.dateLow, i18n.language, today),
                high: formatDay(p.dateHigh, i18n.language, today),
              })}
            </p>
            <MonthStrip today={today} low={p.dateLow} high={p.dateHigh} />
            <p className="text-[13.5px] text-muted-foreground">
              {t("projection.weeks", { low: p.weeksLow, high: p.weeksHigh })}
            </p>
          </>
        )}
        {p?.kind === "target-not-below" && <p className="text-sm">{t("projection.notBelow")}</p>}
      </ResultCard>
    </ToolPage>
  );
}
