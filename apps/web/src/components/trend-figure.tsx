import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFit } from "@/lib/fit";
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
  accent = false,
}: {
  averageKg: number | null;
  lossPct: number | null;
  pill: boolean;
  // Where domains meet, the pill sits on the body's tint, its check in the body's shade: the same
  // for a gain and a loss, since it names the domain and never judges the figure.
  accent?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const unit = readWeightUnit();
  const loss = lossPct === null ? null : lossView(lossPct);
  const fit = useFit<HTMLSpanElement>();
  const strong = "font-semibold whitespace-nowrap text-foreground tabular-nums";
  return (
    <>
      <span
        ref={fit}
        data-slot="trend-figure"
        className="mt-2.5 mb-2 display-figure text-figure tracking-[-0.03em] text-foreground"
      >
        {averageKg === null ? (
          "—"
        ) : (
          <>
            {bodyWeight(averageKg, i18n.language, unit)}
            {/* Read out as shown, « 80,4 kg »: the gap is a margin, which a name never counts. */}
            <span className="sr-only"> </span>
            <span className="ml-1.5 text-(length:--text-title-compact) font-semibold tracking-normal text-muted-foreground">
              {unit}
            </span>
          </>
        )}
      </span>
      {loss &&
        (loss.value === 0 ? (
          <span className="text-(length:--text-note) text-muted-foreground">
            <b className={strong}>{t("trend.stable")}</b> {t("trend.lastWeek")}
          </span>
        ) : (
          <span className="text-(length:--text-note) text-muted-foreground">
            {t(loss.kind === "gain" ? "trend.gain" : "trend.loss")}{" "}
            <b className={strong}>
              {t("trend.perWeek", {
                value: formatNumber(loss.value, i18n.language, { digits: 1, minDigits: 1 }),
              })}
            </b>{" "}
            {t("trend.lastWeek")}
          </span>
        ))}
      {pill &&
        (accent ? (
          <span
            data-slot="range-pill"
            data-accent="body"
            className="mt-2 inline-flex items-center gap-1 self-start rounded-full bg-body-tint px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-foreground"
          >
            <Check aria-hidden="true" className="size-3 shrink-0 text-body-shade" />
            {t("body.inRange")}
          </span>
        ) : (
          <span className="mt-2 self-start rounded-full bg-reference px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-reference-ink">
            {t("body.inRange")}
          </span>
        ))}
    </>
  );
}
