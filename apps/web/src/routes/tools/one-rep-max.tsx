import { MAX_REPS, oneRepMax } from "@belay/shared/tools/one-rep-max";
import { roundTo } from "@belay/shared/tools/round";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { NumberStepper } from "@/components/number-stepper";
import { ResultCard, ResultFigure } from "@/components/result-card";
import { ToolPage } from "@/components/tool-page";
import { attempt } from "@/lib/attempt";
import { readBrzycki } from "@/lib/display-prefs";
import { formatNumber } from "@/lib/format";
import { useTool } from "@/lib/tool-storage";

export const OneRepMaxInputs = z.object({
  loadKg: z.number().min(1).max(500).catch(100),
  reps: z.number().int().min(1).max(MAX_REPS).catch(5),
});

export function OneRepMaxTool() {
  const { t, i18n } = useTranslation();
  const { inputs, setInputs } = useTool("one-rep-max", OneRepMaxInputs);
  const r = attempt(() => oneRepMax(inputs.loadKg, inputs.reps));
  const kg = (v: number) => formatNumber(roundTo(v, 0.5), i18n.language);
  // Read once: Réglages is another page, so the choice cannot change while this one is open.
  const [brzycki] = useState(readBrzycki);
  const note = "text-[13.5px] text-muted-foreground";
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
            {brzycki === "hidden" ? (
              <div>
                <div className="text-[13px] text-muted-foreground">Epley</div>
                <ResultFigure value={kg(r.epleyKg)} unit="kg" muted={r.lessReliable} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ["Epley", r.epleyKg],
                    ["Brzycki", r.brzyckiKg],
                  ] as const
                ).map(([name, v]) => (
                  <div key={name}>
                    <div className="text-[13px] text-muted-foreground">{name}</div>
                    <ResultFigure value={kg(v)} unit="kg" size="medium" muted={r.lessReliable} />
                  </div>
                ))}
              </div>
            )}
            {inputs.reps === 1 && <p className={note}>{t("oneRepMax.oneRep")}</p>}
            {r.lessReliable && <p className={note}>{t("oneRepMax.lessReliable")}</p>}
          </>
        )}
      </ResultCard>
    </ToolPage>
  );
}
