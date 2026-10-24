import { LB_PLATES } from "@belay/shared/tools/plates";
import { defaultWarmupCount, type WarmupCount, warmupSets } from "@belay/shared/tools/warmup";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { NumberStepper } from "@/components/number-stepper";
import { GroupedList, NumberTile, RowText } from "@/components/grouped-list";
import { ToolPage } from "@/components/tool-page";
import { attempt } from "@/lib/attempt";
import { formatNumber, formatPlates } from "@/lib/format";
import { resolveEquipment, useTool } from "@/lib/tool-storage";
import { readWeightUnit, weightStepper } from "@/lib/units";

// `count` null = follow the load (D12). Changing the load resets it.
export const WarmupInputs = z.object({
  workKg: z.number().min(1).max(500).catch(100),
  count: z.number().int().min(0).max(3).nullable().catch(null),
});

// The kit's row, written here since a set reads three ways at once: its number, its load and plates,
// its reps.
const row = "flex min-h-14 items-center gap-3 px-4 py-2";
const load = "text-body font-semibold tabular-nums";
const detail =
  "text-(length:--text-secondary) leading-(--text-secondary--line-height) break-words text-muted-foreground";
const end = "shrink-0 text-body font-semibold tabular-nums text-foreground";

export function WarmupTool() {
  const { t, i18n } = useTranslation();
  const { state, inputs, setInputs } = useTool("warmup", WarmupInputs);
  const unit = readWeightUnit();
  const work = weightStepper(inputs.workKg, { min: 1, max: 500 }, 2.5, unit);
  // In pounds, the standard pound set: the stored equipment is kilo plates.
  const { barKg, platesKg } =
    unit === "kg"
      ? resolveEquipment(state.equipment)
      : { barKg: LB_PLATES.bar, platesKg: LB_PLATES.plates };
  // The count follows the load in kg whatever the unit, so a load reads the same count both ways.
  const count = (inputs.count ?? defaultWarmupCount(inputs.workKg)) as WarmupCount;
  const sets = attempt(() => warmupSets(work.value, count, barKg, platesKg));
  const light = work.value <= barKg;
  const n = (v: number) => formatNumber(v, i18n.language, { digits: 2 });
  return (
    <ToolPage title={t("tools.items.warmup.name")} lead={t("warmup.lead")} toolId="warmup">
      <div className="grid grid-cols-2 gap-2.5">
        <NumberStepper
          label={t("warmup.work")}
          unit={unit}
          value={work.value}
          min={work.min}
          max={work.max}
          step={work.step}
          buttons={false}
          onChange={(v) => v !== null && setInputs({ workKg: work.toKg(v), count: null })}
        />
        {!light && (
          <NumberStepper
            label={t("warmup.count")}
            value={count}
            min={0}
            max={3}
            step={1}
            onChange={(v) => v !== null && setInputs({ count: Math.round(v) })}
          />
        )}
      </div>
      <div aria-live="polite" aria-atomic="true">
        <GroupedList label={t("warmup.result")}>
          {light ? (
            <RowText label={t("warmup.lightWork")} />
          ) : (
            sets && [
              ...sets.map((s, i) => (
                <div key={s.loadKg} className={row}>
                  <NumberTile n={i + 1} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={load}>
                      {n(s.loadKg)} {unit}
                    </span>{" "}
                    <span className={detail}>
                      {s.perSideKg.length === 0
                        ? t("warmup.barOnly")
                        : t("warmup.perSide", { plates: formatPlates(s.perSideKg, i18n.language) })}
                    </span>
                  </span>
                  <span className={end}>{t("warmup.reps", { reps: s.reps })}</span>
                </div>
              )),
              <div key="work" className={row}>
                <span
                  aria-hidden
                  className="grid size-7 shrink-0 place-items-center rounded-icon bg-primary-soft"
                >
                  <Check className="size-5 text-primary-ink" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={load}>
                    {n(work.value)} {unit}
                  </span>{" "}
                  <span className={detail}>{t("warmup.workSets")}</span>
                </span>
                <span className={end}>{t("warmup.yours")}</span>
              </div>,
            ]
          )}
        </GroupedList>
      </div>
      <p className={`px-4 ${detail}`}>
        {t("warmup.note", {
          preset: t(`equipment.presets.${unit === "lb" ? "pounds" : state.equipment.preset}`),
        })}
      </p>
    </ToolPage>
  );
}
