import { HEIGHT_RANGE_CM } from "@belay/shared/tools/bounds";
import { bodyFatBand, gallagherThresholds, navyBodyFat } from "@belay/shared/tools/body-fat";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { InlineChoice } from "@/components/inline-choice";
import { NumberStepper } from "@/components/number-stepper";
import { RangeList } from "@/components/range-list";
import { ResultCard } from "@/components/result-card";
import { Segmented } from "@/components/segmented";
import { ToolPage } from "@/components/tool-page";
import { attempt } from "@/lib/attempt";
import { formatNumber } from "@/lib/format";
import { useTool } from "@/lib/tool-storage";

export const BodyFatInputs = z.object({
  ageYears: z.number().int().min(15).max(100).catch(30),
  neckCm: z.number().min(20).max(80).catch(34),
  waistCm: z.number().min(40).max(200).catch(75),
  hipCm: z.number().min(50).max(200).catch(100),
});

export function BodyFatTool() {
  const { t, i18n } = useTranslation();
  const { state, update, inputs, setInputs } = useTool("body-fat", BodyFatInputs);
  const [editHeight, setEditHeight] = useState(state.heightCm === undefined);
  const heightCm = state.heightCm ?? 170;
  const female = state.formula === "female";
  const r = attempt(() => navyBodyFat({ formula: state.formula, heightCm, ...inputs }));
  const refs = gallagherThresholds(state.formula, inputs.ageYears, state.bodyFatReference);
  const n = (v: number) => formatNumber(v, i18n.language, { digits: 0 });
  const pct = (v: number) => t("range.percent", { value: n(v) });

  // Offer the estimate to the protein tool, on this device only.
  const percent = r?.kind === "ok" ? r.percent : undefined;
  useEffect(() => {
    if (percent !== undefined && percent !== state.bodyFatPct) {
      update((s) => ({ ...s, bodyFatPct: percent }));
    }
  }, [percent, state.bodyFatPct, update]);

  const girthError =
    r?.kind === "invalid-girths"
      ? t(female ? "bodyFat.invalidFemale" : "bodyFat.invalidMale")
      : undefined;
  const th = refs?.thresholds;
  return (
    <ToolPage
      title={t("tools.items.body-fat.name")}
      lead={t("bodyFat.lead")}
      toolId="body-fat"
      sheetExtra={
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <Segmented
            label={t("bodyFat.reference")}
            value={state.bodyFatReference}
            options={[
              { value: "standard", label: t("bodyFat.references.standard") },
              { value: "asian", label: t("bodyFat.references.asian") },
            ]}
            onChange={(bodyFatReference) => update((s) => ({ ...s, bodyFatReference }))}
          />
          <p className="text-[13px] text-muted-foreground">{t("bodyFat.referenceNote")}</p>
        </div>
      }
    >
      <InlineChoice
        label={t("tools.formula.label")}
        value={state.formula}
        options={[
          { value: "female", label: t("tools.formula.female") },
          { value: "male", label: t("tools.formula.male") },
        ]}
        onChange={(formula) => update((s) => ({ ...s, formula }))}
      />
      <div className="grid grid-cols-2 gap-2.5">
        <NumberStepper
          label={t("tools.fields.age")}
          value={inputs.ageYears}
          min={15}
          max={100}
          step={1}
          buttons={false}
          onChange={(v) => v !== null && setInputs({ ageYears: Math.round(v) })}
        />
        <NumberStepper
          label={t("bodyFat.neck")}
          unit="cm"
          value={inputs.neckCm}
          min={20}
          max={80}
          step={0.5}
          buttons={false}
          onChange={(v) => v !== null && setInputs({ neckCm: v })}
        />
        <NumberStepper
          label={t(female ? "bodyFat.waistFemale" : "bodyFat.waistMale")}
          unit="cm"
          value={inputs.waistCm}
          min={40}
          max={200}
          step={0.5}
          buttons={false}
          error={girthError}
          onChange={(v) => v !== null && setInputs({ waistCm: v })}
        />
        {female && (
          <NumberStepper
            label={t("bodyFat.hip")}
            unit="cm"
            value={inputs.hipCm}
            min={50}
            max={200}
            step={0.5}
            buttons={false}
            onChange={(v) => v !== null && setInputs({ hipCm: v })}
          />
        )}
      </div>
      {editHeight ? (
        <NumberStepper
          label={t("tools.fields.height")}
          unit="cm"
          value={heightCm}
          min={HEIGHT_RANGE_CM.min}
          max={HEIGHT_RANGE_CM.max}
          step={1}
          onChange={(v) => v !== null && update((s) => ({ ...s, heightCm: v }))}
        />
      ) : (
        <p className="text-[13px] text-muted-foreground">
          {t("bodyFat.heightKnown", { height: n(heightCm) })} ·{" "}
          <button
            type="button"
            className="min-h-11 font-semibold text-primary"
            onClick={() => setEditHeight(true)}
          >
            {t("bodyFat.editHeight")}
          </button>
        </p>
      )}
      <ResultCard label={t("bodyFat.result")}>
        {r?.kind === "ok" ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-[40px] leading-none font-extrabold tracking-tight">
                {pct(r.percent)}
              </span>
              <span className="text-[13px] text-muted-foreground">{t("bodyFat.error")}</span>
            </div>
            <p className="text-[13px] text-muted-foreground">{t("bodyFat.bias")}</p>
          </>
        ) : (
          <p className="text-sm">
            {r === null || r.kind === "out-of-range" ? t("bodyFat.outOfRange") : girthError}
          </p>
        )}
      </ResultCard>
      {refs && th ? (
        <>
          <RangeList
            label={t("bodyFat.rangesLabel")}
            currentId={r?.kind === "ok" ? bodyFatBand(r.percent, th) : null}
            rows={[
              {
                id: "below",
                range: t("range.under", { value: pct(th.at18_5) }),
                label: t("bodyFat.bands.below"),
              },
              {
                id: "reference",
                range: t("range.between", { low: n(th.at18_5), high: pct(th.at25 - 1) }),
                label: t("bodyFat.bands.reference"),
                reference: true,
              },
              {
                id: "above",
                range: t("range.between", { low: n(th.at25), high: pct(th.at30 - 1) }),
                label: t("bodyFat.bands.above"),
              },
              {
                id: "well-above",
                range: t("range.andOver", { value: pct(th.at30) }),
                label: t("bodyFat.bands.well-above"),
              },
            ]}
          />
          <p className="text-[13px] text-muted-foreground">
            {t(`bodyFat.caption.${state.bodyFatReference}`, {
              formula: t(`tools.formula.${state.formula}`).toLowerCase(),
              from: refs.group.slice(0, 2),
              to: refs.group.slice(3),
            })}
          </p>
        </>
      ) : (
        <p className="text-[13px] text-muted-foreground">{t("bodyFat.noReferences")}</p>
      )}
    </ToolPage>
  );
}
