import { HEIGHT_RANGE_CM, WEIGHT_RANGE_KG } from "@belay/shared/tools/bounds";
import { bmi, bmiBand, bmiSuggestsProfessional, BMI_THRESHOLDS } from "@belay/shared/tools/bmi";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { NumberStepper } from "@/components/number-stepper";
import { ProfileProposal, RestoreButton, usePrefill } from "@/components/prefill";
import { RangeList } from "@/components/range-list";
import { ResultCard } from "@/components/result-card";
import { ToolPage } from "@/components/tool-page";
import { attempt } from "@/lib/attempt";
import { formatNumber } from "@/lib/format";
import { useTool } from "@/lib/tool-storage";

export const BmiInputs = z.object({});

export function BmiTool() {
  const { t, i18n } = useTranslation();
  const { state, update } = useTool("bmi", BmiInputs);
  const prefill = usePrefill(["heightCm", "weightKg"]);
  const heightCm = prefill.value("heightCm", state.heightCm ?? 170);
  const weightKg = prefill.value("weightKg", state.weightKg ?? 70);
  const value = attempt(() => bmi(weightKg, heightCm));
  const band = value === null ? null : bmiBand(value);
  const n = (v: number) => formatNumber(v, i18n.language);
  const { low, reference, high } = BMI_THRESHOLDS;
  const bounds = {
    below: { low: n(low), high: "" },
    reference: { low: n(low), high: n(reference) },
    above: { low: n(reference), high: n(high) },
    "well-above": { low: n(high), high: "" },
  } as const;
  return (
    <ToolPage title={t("tools.items.bmi.name")} lead={t("bmi.lead")} toolId="bmi">
      <div className="grid grid-cols-2 gap-2.5">
        <NumberStepper
          label={t("tools.fields.height")}
          unit="cm"
          value={heightCm}
          min={HEIGHT_RANGE_CM.min}
          max={HEIGHT_RANGE_CM.max}
          step={1}
          buttons={false}
          onChange={(v) => {
            if (v === null) return;
            prefill.edit("heightCm");
            update((s) => ({ ...s, heightCm: v }));
          }}
          hint={prefill.hint("heightCm")}
        />
        <NumberStepper
          label={t("tools.fields.weight")}
          unit="kg"
          value={weightKg}
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
      </div>
      <ProfileProposal
        proposal={prefill.proposal("heightCm", heightCm)}
        show={(cm) => t("prefill.cm", { value: cm })}
      />
      <RestoreButton prefill={prefill} />
      <ResultCard label={t("bmi.result")}>
        {value !== null && band !== null && (
          <>
            <div className="text-5xl leading-none font-extrabold tracking-tight">
              {formatNumber(value, i18n.language, { minDigits: 1 })}
            </div>
            <p className="mt-1 text-sm font-semibold">{t(`bmi.sentence.${band}`, bounds[band])}</p>
            {bmiSuggestsProfessional(value) && <p className="text-sm">{t("bmi.professional")}</p>}
          </>
        )}
      </ResultCard>
      <RangeList
        label={t("bmi.rangesLabel")}
        currentId={band}
        rows={[
          { id: "below", range: t("range.under", { value: n(low) }), label: t("bmi.bands.below") },
          {
            id: "reference",
            range: t("range.between", { low: n(low), high: n(reference) }),
            label: t("bmi.bands.reference"),
            reference: true,
          },
          {
            id: "above",
            range: t("range.between", { low: n(reference), high: n(high) }),
            label: t("bmi.bands.above"),
          },
          {
            id: "well-above",
            range: t("range.andOver", { value: n(high) }),
            label: t("bmi.bands.well-above"),
          },
        ]}
      />
      <p className="text-[13px] text-muted-foreground">{t("bmi.note")}</p>
    </ToolPage>
  );
}
