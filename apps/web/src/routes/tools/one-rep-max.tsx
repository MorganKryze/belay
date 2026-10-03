import { MAX_REPS, oneRepMax } from "@belay/shared/tools/one-rep-max";
import { roundTo } from "@belay/shared/tools/round";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { NumberStepper } from "@/components/number-stepper";
import { ResultCard } from "@/components/result-card";
import { ToolPage } from "@/components/tool-page";
import { attempt } from "@/lib/attempt";
import { formatNumber } from "@/lib/format";
import { useTool } from "@/lib/tool-storage";
import { cn } from "@/lib/utils";

export const OneRepMaxInputs = z.object({
  loadKg: z.number().min(1).max(500).catch(100),
  reps: z.number().int().min(1).max(MAX_REPS).catch(5),
});

export function OneRepMaxTool() {
  const { t, i18n } = useTranslation();
  const { inputs, setInputs } = useTool("one-rep-max", OneRepMaxInputs);
  const r = attempt(() => oneRepMax(inputs.loadKg, inputs.reps));
  const kg = (v: number) => formatNumber(roundTo(v, 0.5), i18n.language);
  const value = cn(
    "text-[32px] leading-tight font-extrabold tracking-tight",
    r?.lessReliable && "text-muted-foreground",
  );
  return (
    <ToolPage
      title={t("tools.items.one-rep-max.name")}
      lead={t("oneRepMax.lead")}
      toolId="one-rep-max"
    >
      <NumberStepper
        label={t("oneRepMax.load")}
        unit="kg"
        value={inputs.loadKg}
        min={1}
        max={500}
        step={2.5}
        onChange={(v) => v !== null && setInputs({ loadKg: v })}
      />
      <NumberStepper
        label={t("oneRepMax.reps")}
        value={inputs.reps}
        min={1}
        max={MAX_REPS}
        step={1}
        onChange={(v) => v !== null && setInputs({ reps: Math.round(v) })}
      />
      <ResultCard label={t("oneRepMax.result")}>
        {r && (
          <>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["Epley", r.epleyKg],
                  ["Brzycki", r.brzyckiKg],
                ] as const
              ).map(([name, v]) => (
                <div key={name}>
                  <div className="text-[13px] text-muted-foreground">{name}</div>
                  <div className={value}>
                    {kg(v)}
                    <span className="ml-1 text-[15px] font-semibold text-muted-foreground">kg</span>
                  </div>
                </div>
              ))}
            </div>
            {inputs.reps === 1 && <p className="text-sm">{t("oneRepMax.oneRep")}</p>}
            {r.lessReliable && <p className="text-sm">{t("oneRepMax.lessReliable")}</p>}
          </>
        )}
      </ResultCard>
    </ToolPage>
  );
}
