import { type Loading, loadBar } from "@belay/shared/tools/plates";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Barbell } from "@/components/barbell";
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
            <p className="text-sm">
              <b>{detail(result.loading)}</b>
              <br />
              <span className="text-[13px] text-muted-foreground">
                {t("plates.bar", { bar: n(barKg) })}
              </span>
            </p>
          </>
        ) : (
          result && (
            <div className="flex flex-col gap-1 text-sm">
              <p className="font-semibold">
                {result.below === null
                  ? t("plates.underBar", { bar: n(barKg) })
                  : t("plates.unreachable", { target: n(inputs.targetKg) })}
              </p>
              {result.below && (
                <p>
                  {t("plates.below", {
                    total: n(result.below.totalKg),
                    detail: detail(result.below),
                  })}
                </p>
              )}
              {result.above && (
                <p>
                  {t("plates.above", {
                    total: n(result.above.totalKg),
                    detail: detail(result.above),
                  })}
                </p>
              )}
            </div>
          )
        )}
      </ResultCard>
      <Link
        to="/tools/plates/equipment"
        className="flex min-h-[50px] items-center justify-between border-y border-border font-medium"
      >
        {t("plates.equipment")}
        <span className="flex items-center gap-1 text-sm font-normal text-muted-foreground">
          {t(`equipment.presets.${state.equipment.preset}`)}
          <ChevronRight aria-hidden className="size-4" />
        </span>
      </Link>
    </ToolPage>
  );
}
