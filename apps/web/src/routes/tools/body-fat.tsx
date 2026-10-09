import { HEIGHT_RANGE_CM } from "@belay/shared/tools/bounds";
import { bodyFatBand, gallagherThresholds, navyBodyFat } from "@belay/shared/tools/body-fat";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { InlineChoice } from "@/components/inline-choice";
import { NumberStepper } from "@/components/number-stepper";
import { ProfileProposal, RestoreButton, usePrefill } from "@/components/prefill";
import { RangeList } from "@/components/range-list";
import { ResultCard } from "@/components/result-card";
import { Segmented } from "@/components/segmented";
import { ToolPage } from "@/components/tool-page";
import { attempt } from "@/lib/attempt";
import { formatNumber } from "@/lib/format";
import { type ToolState, useTool } from "@/lib/tool-storage";

// One source for the schema and the fields, so they cannot drift.
export const BODY_FAT_LIMITS = {
  age: { min: 15, max: 100 },
  neck: { min: 20, max: 80 },
  waist: { min: 40, max: 200 },
  hip: { min: 50, max: 200 },
} as const;
const L = BODY_FAT_LIMITS;

export const BodyFatInputs = z.object({
  ageYears: z.number().int().min(L.age.min).max(L.age.max).catch(30),
  neckCm: z.number().min(L.neck.min).max(L.neck.max).catch(34),
  waistCm: z.number().min(L.waist.min).max(L.waist.max).catch(75),
  hipCm: z.number().min(L.hip.min).max(L.hip.max).catch(100),
});
type Inputs = z.output<typeof BodyFatInputs>;

export function BodyFatTool() {
  const { t, i18n } = useTranslation();
  const { state, update, inputs: device } = useTool("body-fat", BodyFatInputs);
  const [editHeight, setEditHeight] = useState(state.heightCm === undefined);
  const prefill = usePrefill(["formula", "ageYears", "heightCm", "neckCm", "waistCm", "hipCm"]);
  const heightCm = prefill.value("heightCm", state.heightCm ?? 170);
  const formula = prefill.value("formula", state.formula);
  const inputs = {
    ageYears: prefill.value("ageYears", device.ageYears),
    neckCm: prefill.value("neckCm", device.neckCm),
    waistCm: prefill.value("waistCm", device.waistCm),
    hipCm: prefill.value("hipCm", device.hipCm),
  };
  const female = formula === "female";
  const r = attempt(() => navyBodyFat({ formula, heightCm, ...inputs }));
  const refs = gallagherThresholds(formula, inputs.ageYears, state.bodyFatReference);
  const n = (v: number) => formatNumber(v, i18n.language, { digits: 0 });
  const pct = (v: number) => t("range.percent", { value: n(v) });

  // The estimate is offered to the protein tool by `update` (see tool-storage), from the
  // person's edits alone: opening the page, prefilled or not, never writes it.
  const edit = (inputsPatch: Partial<Inputs>, statePatch: Partial<ToolState> = {}) => {
    const fields = { ...inputsPatch, ...statePatch };
    if ("formula" in fields) prefill.edit("formula");
    if ("heightCm" in fields) {
      prefill.edit("heightCm");
      setEditHeight(true); // sticky: the field stays under the person's fingers while typing
    }
    for (const f of ["ageYears", "neckCm", "waistCm", "hipCm"] as const)
      if (f in fields) prefill.edit(f);
    update((prev) => {
      // Only what the person entered is stored, so a missing key means "not entered yet".
      const stored = prev.lastInputs["body-fat"];
      const raw = {
        ...(typeof stored === "object" && stored !== null ? stored : {}),
        ...inputsPatch,
      };
      return { ...prev, ...statePatch, lastInputs: { ...prev.lastInputs, "body-fat": raw } };
    });
  };

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
        value={formula}
        options={[
          { value: "female", label: t("tools.formula.female") },
          { value: "male", label: t("tools.formula.male") },
        ]}
        onChange={(formula) => edit({}, { formula })}
        hint={prefill.hint("formula")}
      />
      <ProfileProposal
        proposal={prefill.proposal("formula", formula)}
        show={(f) => t(`tools.formula.${f as "female" | "male"}`)}
      />
      {/* One field per line (D9): each one may carry where its value comes from. */}
      <NumberStepper
        label={t("tools.fields.age")}
        value={inputs.ageYears}
        min={L.age.min}
        max={L.age.max}
        step={1}
        onChange={(v) => v !== null && edit({ ageYears: Math.round(v) })}
        hint={prefill.hint("ageYears")}
      />
      <NumberStepper
        label={t("bodyFat.neck")}
        unit="cm"
        value={inputs.neckCm}
        min={L.neck.min}
        max={L.neck.max}
        step={0.5}
        onChange={(v) => v !== null && edit({ neckCm: v })}
        hint={prefill.hint("neckCm")}
      />
      <NumberStepper
        label={t(female ? "bodyFat.waistFemale" : "bodyFat.waistMale")}
        unit="cm"
        value={inputs.waistCm}
        min={L.waist.min}
        max={L.waist.max}
        step={0.5}
        error={girthError}
        onChange={(v) => v !== null && edit({ waistCm: v })}
        hint={prefill.hint("waistCm")}
      />
      {female && (
        <NumberStepper
          label={t("bodyFat.hip")}
          unit="cm"
          value={inputs.hipCm}
          min={L.hip.min}
          max={L.hip.max}
          step={0.5}
          onChange={(v) => v !== null && edit({ hipCm: v })}
          hint={prefill.hint("hipCm")}
        />
      )}
      {editHeight || prefill.get("heightCm") ? (
        <NumberStepper
          label={t("tools.fields.height")}
          unit="cm"
          value={heightCm}
          min={HEIGHT_RANGE_CM.min}
          max={HEIGHT_RANGE_CM.max}
          step={1}
          onChange={(v) => v !== null && edit({}, { heightCm: v })}
          hint={prefill.hint("heightCm")}
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
      <ProfileProposal
        proposal={prefill.proposal("heightCm", heightCm)}
        show={(cm) => t("prefill.cm", { value: cm })}
      />
      <RestoreButton
        prefill={{
          any: prefill.anyOf([
            "formula",
            "ageYears",
            "heightCm",
            "neckCm",
            "waistCm",
            ...(female ? (["hipCm"] as const) : []),
          ]),
          restore: prefill.restore,
        }}
      />
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
              formula: t(`tools.formula.${formula}`).toLowerCase(),
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
