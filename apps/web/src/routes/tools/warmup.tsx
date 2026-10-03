import { defaultWarmupCount, type WarmupCount, warmupSets } from "@belay/shared/tools/warmup";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { NumberStepper } from "@/components/number-stepper";
import { ResultCard } from "@/components/result-card";
import { ToolPage } from "@/components/tool-page";
import { attempt } from "@/lib/attempt";
import { formatNumber, formatPlates } from "@/lib/format";
import { resolveEquipment, useTool } from "@/lib/tool-storage";

// `count` null = follow the load (D12). Changing the load resets it.
export const WarmupInputs = z.object({
  workKg: z.number().min(1).max(500).catch(100),
  count: z.number().int().min(0).max(3).nullable().catch(null),
});

const row =
  "grid min-h-[52px] grid-cols-[26px_1fr_auto] items-center gap-2.5 border-t border-border px-3 py-1 first:border-t-0";
const badge = "grid size-6 place-items-center rounded-full text-xs font-bold";

export function WarmupTool() {
  const { t, i18n } = useTranslation();
  const { state, inputs, setInputs } = useTool("warmup", WarmupInputs);
  const { barKg, platesKg } = resolveEquipment(state.equipment);
  const count = (inputs.count ?? defaultWarmupCount(inputs.workKg)) as WarmupCount;
  const sets = attempt(() => warmupSets(inputs.workKg, count, barKg, platesKg));
  const n = (v: number) => formatNumber(v, i18n.language, { digits: 2 });
  return (
    <ToolPage title={t("tools.items.warmup.name")} lead={t("warmup.lead")} toolId="warmup">
      <div className="grid grid-cols-2 gap-2.5">
        <NumberStepper
          label={t("warmup.work")}
          unit="kg"
          value={inputs.workKg}
          min={1}
          max={500}
          step={2.5}
          buttons={false}
          onChange={(v) => v !== null && setInputs({ workKg: v, count: null })}
        />
        <NumberStepper
          label={t("warmup.count")}
          value={count}
          min={0}
          max={3}
          step={1}
          onChange={(v) => v !== null && setInputs({ count: Math.round(v) })}
        />
      </div>
      <ResultCard label={t("warmup.result")} tone="plain">
        {inputs.workKg <= barKg ? (
          <p className="text-sm">{t("warmup.lightWork")}</p>
        ) : (
          sets && (
            <ol className="-mx-4 -mb-4 overflow-hidden rounded-b-card">
              {sets.map((s, i) => (
                <li key={s.loadKg} className={row}>
                  <span aria-hidden className={`${badge} bg-track text-muted-foreground`}>
                    {i + 1}
                  </span>
                  <span>
                    <b className="tabular-nums">{n(s.loadKg)} kg</b>
                    <small className="block text-xs text-muted-foreground">
                      {s.perSideKg.length === 0
                        ? t("warmup.barOnly")
                        : t("warmup.perSide", { plates: formatPlates(s.perSideKg, i18n.language) })}
                    </small>
                  </span>
                  <span className="font-bold tabular-nums">
                    {t("warmup.reps", { reps: s.reps })}
                  </span>
                </li>
              ))}
              <li className={`${row} bg-primary-soft`}>
                <span aria-hidden className={`${badge} bg-primary text-primary-foreground`}>
                  <Check className="size-3.5" />
                </span>
                <span>
                  <b className="tabular-nums">{n(inputs.workKg)} kg</b>
                  <small className="block text-xs text-muted-foreground">
                    {t("warmup.workSets")}
                  </small>
                </span>
                <span className="font-bold">{t("warmup.yours")}</span>
              </li>
            </ol>
          )
        )}
      </ResultCard>
      <p className="text-[13px] text-muted-foreground">
        {t("warmup.note", { preset: t(`equipment.presets.${state.equipment.preset}`) })}
      </p>
    </ToolPage>
  );
}
