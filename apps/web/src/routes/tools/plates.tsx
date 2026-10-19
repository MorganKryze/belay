import { type Loading, loadBar } from "@belay/shared/tools/plates";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Barbell } from "@/components/barbell";
import { GroupedList, RowLink } from "@/components/grouped-list";
import { NumberStepper } from "@/components/number-stepper";
import { ResultCard } from "@/components/result-card";
import { ToolPage } from "@/components/tool-page";
import { attempt } from "@/lib/attempt";
import { formatNumber, formatPlates } from "@/lib/format";
import { resolveEquipment, useTool } from "@/lib/tool-storage";

export const PlatesInputs = z.object({ targetKg: z.number().min(1).max(500).catch(100) });

export function PlatesTool() {
  const { t, i18n } = useTranslation();
  const { state, inputs, setInputs } = useTool("plates", PlatesInputs);
  const { barKg, platesKg } = resolveEquipment(state.equipment);
  const result = attempt(() => loadBar(inputs.targetKg, barKg, platesKg));
  const n = (v: number) => formatNumber(v, i18n.language, { digits: 2 });
  const detail = (l: Loading) =>
    l.perSideKg.length === 0
      ? t("plates.barOnly")
      : t("plates.perSide", { plates: formatPlates(l.perSideKg, i18n.language) });
  return (
    <ToolPage title={t("tools.items.plates.name")} lead={t("plates.lead")} toolId="plates">
      <NumberStepper
        label={t("plates.target")}
        unit="kg"
        value={inputs.targetKg}
        min={1}
        max={500}
        step={0.5}
        onChange={(v) => v !== null && setInputs({ targetKg: v })}
      />
      <ResultCard label={t("plates.result")}>
        {result?.kind === "exact" ? (
          <>
            <Barbell perSideKg={result.loading.perSideKg} label={detail(result.loading)} />
            <p className="text-body font-semibold tabular-nums">{detail(result.loading)}</p>
            <p className="text-[13.5px] text-muted-foreground">
              {t("plates.bar", { bar: n(barKg) })}
            </p>
          </>
        ) : (
          result && (
            <>
              <p className="text-body font-semibold">
                {result.below === null
                  ? t("plates.underBar", { bar: n(barKg) })
                  : t("plates.unreachable", { target: n(inputs.targetKg) })}
              </p>
              {[
                result.below && (["plates.below", result.below] as const),
                result.above && (["plates.above", result.above] as const),
              ].map(
                (item) =>
                  item && (
                    <div key={item[0]} className="mt-2 border-t border-border pt-2.5">
                      <p className="text-body font-semibold">
                        {t(item[0], { total: n(item[1].totalKg) })}
                      </p>
                      <p className="text-[13.5px] text-muted-foreground tabular-nums">
                        {detail(item[1])}
                      </p>
                    </div>
                  ),
              )}
            </>
          )
        )}
      </ResultCard>
      <GroupedList>
        <RowLink
          to="/tools/plates/equipment"
          label={t("plates.equipment")}
          value={t(`equipment.presets.${state.equipment.preset}`)}
          trailing="push"
        />
      </GroupedList>
    </ToolPage>
  );
}
