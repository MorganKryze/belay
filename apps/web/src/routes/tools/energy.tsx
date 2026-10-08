import { AGE_RANGE_YEARS, HEIGHT_RANGE_CM, WEIGHT_RANGE_KG } from "@belay/shared/tools/bounds";
import { dailyEnergy, PAL_LEVELS } from "@belay/shared/tools/energy";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { ChoiceList } from "@/components/choice-list";
import { InlineChoice } from "@/components/inline-choice";
import { NumberStepper } from "@/components/number-stepper";
import { ProfileProposal, RestoreButton, SourceLine, usePrefill } from "@/components/prefill";
import { ResultCard } from "@/components/result-card";
import { ToolPage } from "@/components/tool-page";
import { attempt } from "@/lib/attempt";
import { formatNumber } from "@/lib/format";
import { useTool } from "@/lib/tool-storage";

export const EnergyInputs = z.object({
  ageYears: z.number().int().min(AGE_RANGE_YEARS.min).max(AGE_RANGE_YEARS.max).catch(30),
  pal: z.enum(["very-sedentary", "sedentary", "active", "very-active"]).catch("sedentary"),
});

export function EnergyTool() {
  const { t, i18n } = useTranslation();
  const { state, update, inputs, setInputs } = useTool("energy", EnergyInputs);
  const prefill = usePrefill(["formula", "ageYears", "heightCm", "weightKg"]);
  const formula = prefill.value("formula", state.formula);
  const ageYears = prefill.value("ageYears", inputs.ageYears);
  const heightCm = prefill.value("heightCm", state.heightCm ?? 170);
  const weightKg = prefill.value("weightKg", state.weightKg ?? 70);
  const pal = PAL_LEVELS.find((l) => l.id === inputs.pal)?.pal ?? 1.55;
  const e = attempt(() => dailyEnergy({ formula, ageYears, heightCm, weightKg }, pal));
  const kcal = (v: number) => formatNumber(v, i18n.language, { digits: 0 });
  return (
    <ToolPage title={t("tools.items.energy.name")} lead={t("energy.lead")} toolId="energy">
      <InlineChoice
        label={t("tools.formula.label")}
        value={formula}
        options={[
          { value: "female", label: t("tools.formula.female") },
          { value: "male", label: t("tools.formula.male") },
        ]}
        onChange={(formula) => {
          prefill.edit("formula");
          update((s) => ({ ...s, formula }));
        }}
        hint={<SourceLine source={prefill.get("formula")?.source} />}
      />
      <ProfileProposal
        proposal={prefill.proposal("formula", formula)}
        show={(f) => t(`tools.formula.${f as "female" | "male"}`)}
      />
      {/* One field per line (D9): each one may carry where its value comes from. */}
      <NumberStepper
        label={t("tools.fields.age")}
        value={ageYears}
        min={AGE_RANGE_YEARS.min}
        max={AGE_RANGE_YEARS.max}
        step={1}
        onChange={(v) => {
          if (v === null) return;
          prefill.edit("ageYears");
          setInputs({ ageYears: Math.round(v) });
        }}
        hint={<SourceLine source={prefill.get("ageYears")?.source} />}
      />
      <NumberStepper
        label={t("tools.fields.height")}
        unit="cm"
        value={heightCm}
        min={HEIGHT_RANGE_CM.min}
        max={HEIGHT_RANGE_CM.max}
        step={1}
        onChange={(v) => {
          if (v === null) return;
          prefill.edit("heightCm");
          update((s) => ({ ...s, heightCm: v }));
        }}
        hint={<SourceLine source={prefill.get("heightCm")?.source} />}
      />
      <ProfileProposal
        proposal={prefill.proposal("heightCm", heightCm)}
        show={(cm) => t("prefill.cm", { value: cm })}
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
        hint={<SourceLine source={prefill.get("weightKg")?.source} />}
      />
      <RestoreButton prefill={prefill} />
      <ChoiceList
        label={t("energy.activity")}
        value={inputs.pal}
        options={PAL_LEVELS.map((l) => ({
          value: l.id,
          label: t(`energy.levels.${l.id}.name`),
          description: t(`energy.levels.${l.id}.description`),
          aside: formatNumber(l.pal, i18n.language, { digits: 2, minDigits: 2 }),
        }))}
        onChange={(id) => setInputs({ pal: id })}
      />
      <ResultCard label={t("energy.result")}>
        {e && (
          <>
            <div className="text-[32px] leading-tight font-extrabold tracking-tight whitespace-nowrap">
              {kcal(e.dayKcal)}
              <span className="ml-1 text-[15px] font-semibold text-muted-foreground">kcal</span>
            </div>
            <p className="text-[13px] text-muted-foreground">
              {t("energy.range", { low: kcal(e.lowKcal), high: kcal(e.highKcal) })}
            </p>
            <p className="mt-2 flex items-baseline justify-between gap-2 border-t border-primary/20 pt-2">
              <span className="text-[13px] text-muted-foreground">{t("energy.bmr")}</span>
              <b className="whitespace-nowrap tabular-nums">{kcal(e.bmrKcal)} kcal</b>
            </p>
          </>
        )}
      </ResultCard>
      <p className="text-[13px] text-muted-foreground">{t("energy.note")}</p>
    </ToolPage>
  );
}
