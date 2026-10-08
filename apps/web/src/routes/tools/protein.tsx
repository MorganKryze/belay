import { WEIGHT_RANGE_KG } from "@belay/shared/tools/bounds";
import { NAVY_RANGE_PCT } from "@belay/shared/tools/body-fat";
import { proteinRange } from "@belay/shared/tools/protein";
import { roundTo } from "@belay/shared/tools/round";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { NumberStepper } from "@/components/number-stepper";
import { RestoreButton, usePrefill } from "@/components/prefill";
import { ResultCard } from "@/components/result-card";
import { Segmented } from "@/components/segmented";
import { ToolPage } from "@/components/tool-page";
import { attempt } from "@/lib/attempt";
import { formatNumber } from "@/lib/format";
import { useTool } from "@/lib/tool-storage";

export const ProteinInputs = z.object({
  goal: z.enum(["maintain", "cut", "gain"]).catch("maintain"),
});

export function ProteinTool() {
  const { t, i18n } = useTranslation();
  const { state, update, inputs, setInputs } = useTool("protein", ProteinInputs);
  // The weight only: the body fat keeps the M1 rule (a recent estimate of the body-fat tool).
  const prefill = usePrefill(["weightKg"]);
  const weightKg = prefill.value("weightKg", state.weightKg ?? 70);
  const r = attempt(() => proteinRange(weightKg, inputs.goal, state.bodyFatPct));
  const n = (v: number) => formatNumber(v, i18n.language, { digits: 1 });
  const range = (low: number, high: number) =>
    low === high ? n(low) : t("protein.range", { low: n(low), high: n(high) });
  return (
    <ToolPage title={t("tools.items.protein.name")} lead={t("protein.lead")} toolId="protein">
      <Segmented
        label={t("protein.goal")}
        value={inputs.goal}
        options={[
          { value: "maintain", label: t("protein.goals.maintain") },
          { value: "cut", label: t("protein.goals.cut") },
          { value: "gain", label: t("protein.goals.gain") },
        ]}
        onChange={(goal) => setInputs({ goal })}
      />
      <NumberStepper
        label={t("tools.fields.weight")}
        unit="kg"
        value={weightKg}
        min={WEIGHT_RANGE_KG.min}
        max={WEIGHT_RANGE_KG.max}
        step={0.5}
        onChange={(v) => {
          if (v === null) return;
          prefill.edit("weightKg");
          update((s) => ({ ...s, weightKg: v }));
        }}
        hint={prefill.hint("weightKg")}
      />
      {inputs.goal === "cut" && (
        <NumberStepper
          label={t("protein.bodyFat")}
          unit="%"
          value={state.bodyFatPct ?? null}
          optional
          min={NAVY_RANGE_PCT.min}
          max={NAVY_RANGE_PCT.max}
          step={1}
          onChange={(v) => update((s) => ({ ...s, bodyFatPct: v ?? undefined }))}
        />
      )}
      <RestoreButton prefill={prefill} />
      <ResultCard label={t("protein.result")}>
        {r && (
          <>
            <div className="text-[32px] leading-tight font-extrabold tracking-tight">
              {range(r.lowG, r.highG)}
              <span className="ml-1 text-[15px] font-semibold text-muted-foreground">g</span>
            </div>
            <p className="text-[13px] text-muted-foreground">
              {t("protein.perKg", {
                low: n(roundTo(r.lowG / weightKg, 0.1)),
                high: n(roundTo(r.highG / weightKg, 0.1)),
              })}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2.5">
              {(
                [
                  ["meals3", r.perMeal3],
                  ["meals4", r.perMeal4],
                ] as const
              ).map(([key, [low, high]]) => (
                <div key={key}>
                  <div className="text-[13px] font-semibold text-primary-ink">
                    {t(`protein.${key}`)}
                  </div>
                  <div className="text-lg font-bold">{range(low, high)} g</div>
                </div>
              ))}
            </div>
          </>
        )}
      </ResultCard>
      {r && inputs.goal === "cut" && (
        <p className="text-[13px] text-muted-foreground">
          {r.basis === "no-body-fat" ? t("protein.noBodyFat") : t("protein.leanMass")}
          {r.floorApplied && ` ${t("protein.floor")}`}
        </p>
      )}
    </ToolPage>
  );
}
