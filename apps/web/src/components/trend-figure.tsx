import { useTranslation } from "react-i18next";
import { formatNumber, lossView } from "@/lib/format";
import { bodyWeight, readWeightUnit } from "@/lib/units";

// The figure of Accueil's trend card, shared with Corps: the 7-day average, the last complete
// week's loss (« stable » when it rounds to 0.0 %) and the range pill. The caller draws the card
// and its label, and decides whether the pill applies. Outside the range the number stands alone,
// with no colour or word that judges. Accueil loads this file at startup: it imports nothing
// beyond React, i18next, the formatters and the weight unit.
export function TrendFigure({
  averageKg,
  lossPct,
  pill,
}: {
  averageKg: number | null;
  lossPct: number | null;
  pill: boolean;
}) {
  const { t, i18n } = useTranslation();
  const unit = readWeightUnit();
  const loss = lossPct === null ? null : lossView(lossPct);
  const strong = "font-semibold whitespace-nowrap text-foreground tabular-nums";
  return (
    <>
      <span
        data-slot="trend-figure"
        className="mt-2.5 mb-2 text-figure tracking-[-0.03em] text-foreground tabular-nums"
      >
        {averageKg === null ? (
          "—"
        ) : (
          <>
            {bodyWeight(averageKg, i18n.language, unit)}
            {/* Read out as shown, « 80,4 kg »: the gap is a margin, which a name never counts. */}
            <span className="sr-only"> </span>
            <span className="ml-1.5 text-[17px] font-semibold tracking-normal text-muted-foreground">
              {unit}
            </span>
          </>
        )}
      </span>
      {loss &&
        (loss.value === 0 ? (
          <span className="text-[13.5px] text-muted-foreground">
            <b className={strong}>{t("trend.stable")}</b> {t("trend.lastWeek")}
          </span>
        ) : (
          <span className="text-[13.5px] text-muted-foreground">
            {t(loss.kind === "gain" ? "trend.gain" : "trend.loss")}{" "}
            <b className={strong}>
              {t("trend.perWeek", {
                value: formatNumber(loss.value, i18n.language, { digits: 1, minDigits: 1 }),
              })}
            </b>{" "}
            {t("trend.lastWeek")}
          </span>
        ))}
      {pill && (
        <span className="mt-2 self-start rounded-full bg-reference px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-reference-ink">
          {t("body.inRange")}
        </span>
      )}
    </>
  );
}
