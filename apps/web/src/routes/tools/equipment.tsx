import {
  PLATE_PRESETS,
  type PlatePreset,
  STANDARD_BARS_KG,
  STANDARD_PLATES_KG,
} from "@belay/shared/tools/plates";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { NumberStepper } from "@/components/number-stepper";
import { Segmented } from "@/components/segmented";
import { ToolPage } from "@/components/tool-page";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { type Equipment as EquipmentState, resolveEquipment, useTool } from "@/lib/tool-storage";
import { cn } from "@/lib/utils";

export const EquipmentInputs = z.object({});
const chip =
  "grid min-h-11 min-w-[54px] place-items-center rounded-[12px] border px-2.5 font-semibold tabular-nums";

export function Equipment() {
  const { t, i18n } = useTranslation();
  const { state, update } = useTool("plates", EquipmentInputs);
  const [copiedFrom, setCopiedFrom] = useState<PlatePreset | null>(null);
  const [newPlate, setNewPlate] = useState<number | null>(null);
  const [otherBar, setOtherBar] = useState(false);
  const eq = state.equipment;
  const { barKg, platesKg } = resolveEquipment(eq);
  const n = (v: number) => formatNumber(v, i18n.language, { digits: 2 });
  const setEquipment = (next: EquipmentState) => update((s) => ({ ...s, equipment: next }));
  const custom = eq.preset === "custom";
  const togglePlate = (kg: number) =>
    setEquipment({
      ...eq,
      plates: eq.plates.includes(kg)
        ? eq.plates.filter((p) => p !== kg)
        : [...eq.plates, kg].sort((a, b) => b - a),
    });
  const chips = [...new Set([...STANDARD_PLATES_KG, ...eq.plates])].sort((a, b) => b - a);

  return (
    <ToolPage title={t("equipment.title")} lead={t("equipment.lead")} backTo="plates">
      <Segmented
        label={t("equipment.start")}
        value={eq.preset}
        options={[
          { value: "competition", label: t("equipment.presets.competition") },
          { value: "gym", label: t("equipment.presets.gym") },
          { value: "custom", label: t("equipment.presets.custom") },
        ]}
        onChange={(preset) => {
          setCopiedFrom(null);
          setEquipment({ ...eq, preset });
        }}
      />
      {custom && (
        <p className="rounded-[12px] bg-track px-3 py-2.5 text-[13px]">
          {copiedFrom
            ? t("equipment.copied", { preset: t(`equipment.presets.${copiedFrom}`) })
            : t("equipment.customNote")}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[13px] font-semibold">{t("equipment.bar")}</h2>
        <div className="flex flex-wrap gap-2">
          {custom ? (
            <>
              {STANDARD_BARS_KG.map((b) => (
                <button
                  key={b}
                  type="button"
                  aria-pressed={!otherBar && eq.bar === b}
                  onClick={() => {
                    setOtherBar(false);
                    setEquipment({ ...eq, bar: b });
                  }}
                  className={cn(
                    chip,
                    "border-input bg-card aria-pressed:border-2 aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary-ink",
                  )}
                >
                  {t("equipment.kg", { value: n(b) })}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={otherBar || !(STANDARD_BARS_KG as readonly number[]).includes(eq.bar)}
                onClick={() => setOtherBar(true)}
                className={cn(
                  chip,
                  "border-input bg-card aria-pressed:border-2 aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary-ink",
                )}
              >
                {t("equipment.otherBar")}
              </button>
            </>
          ) : (
            <span className={cn(chip, "border-border bg-track")}>
              {t("equipment.kg", { value: n(barKg) })}
            </span>
          )}
        </div>
        {custom && (otherBar || !(STANDARD_BARS_KG as readonly number[]).includes(eq.bar)) && (
          <NumberStepper
            label={t("equipment.otherBarLabel")}
            unit="kg"
            value={eq.bar}
            min={1}
            max={50}
            step={0.5}
            onChange={(v) => v !== null && setEquipment({ ...eq, bar: v })}
          />
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[13px] font-semibold">{t("equipment.plates")}</h2>
        <div className="flex flex-wrap gap-2">
          {custom
            ? chips.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={eq.plates.includes(p)}
                  onClick={() => togglePlate(p)}
                  className={cn(
                    chip,
                    "border-input bg-card aria-pressed:border-2 aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary-ink",
                  )}
                >
                  {n(p)}
                </button>
              ))
            : platesKg.map((p) => (
                <span key={p} className={cn(chip, "border-border bg-track")}>
                  {n(p)}
                </span>
              ))}
        </div>
      </div>
      {custom ? (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <NumberStepper
              label={t("equipment.newPlate")}
              unit="kg"
              value={newPlate}
              optional
              min={0.25}
              max={50}
              step={0.25}
              onChange={setNewPlate}
            />
          </div>
          <Button
            variant="outline"
            className="h-[52px]"
            disabled={newPlate === null}
            onClick={() => {
              if (newPlate !== null && !eq.plates.includes(newPlate)) togglePlate(newPlate);
              setNewPlate(null);
            }}
          >
            {t("equipment.add")}
          </Button>
        </div>
      ) : (
        <>
          <Button
            variant="outline"
            className="w-full font-semibold text-primary"
            onClick={() => {
              const preset = eq.preset as PlatePreset;
              setCopiedFrom(preset);
              setOtherBar(false);
              setEquipment({
                preset: "custom",
                bar: PLATE_PRESETS[preset].barKg,
                plates: [...PLATE_PRESETS[preset].platesKg],
              });
            }}
          >
            {t("equipment.edit")}
          </Button>
          <p className="text-[13px] text-muted-foreground">{t("equipment.presetNote")}</p>
        </>
      )}
    </ToolPage>
  );
}
