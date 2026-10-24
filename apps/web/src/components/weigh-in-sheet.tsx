import "@/i18n/lazy";
import type { ISODate } from "@belay/shared/body/dates";
import { isWeighingKg, WEIGHING_RANGE_KG, type Weighing } from "@belay/shared/body/weighings";
import { roundTo } from "@belay/shared/tools/round";
import { kgFromWeighing, rangeIn, stepIn, weighingFromKg } from "@belay/shared/tools/units";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@/lib/format";
import { readWeightUnit } from "@/lib/units";
import { DayChip } from "./day-chip";
import { NumberStepper } from "./number-stepper";
import { Sheet } from "./sheet";
import { Button } from "./ui/button";
import { startingWeight } from "./weigh-in";

// The weigh-in sheet (§4.2): the weight, then Save, plus Delete when the day has a weigh-in.
// Lazy: its code (and the stepper's) loads the first time a sheet opens.
export function WeighInSheet({
  onClose,
  open,
  weighings,
  today,
  date,
  onDate,
  onSave,
  onDelete,
  error,
}: {
  onClose: () => void;
  open?: boolean;
  weighings: readonly Weighing[];
  today: ISODate;
  date: ISODate;
  onDate: (date: ISODate) => void;
  onSave: (date: ISODate, kg: number) => void;
  onDelete: (date: ISODate) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  return (
    <Sheet
      title={t("today.weighIn")}
      onClose={onClose}
      open={open}
      chip={<DayChip date={date} today={today} onChange={onDate} label={t("weighIn.date")} />}
    >
      <WeighInForm
        key={date}
        weighings={weighings}
        today={today}
        date={date}
        onSave={onSave}
        error={error}
      />
      {weighings.some((w) => w.date === date) && (
        <Button variant="secondary" onClick={() => onDelete(date)}>
          {t("weighIn.delete")}
        </Button>
      )}
    </Sheet>
  );
}

// The stepper and Save. Given a `key` of the date, the value starts again from that day; until
// the person edits it, it follows the data, so the first sync on a new phone still fills it in.
function WeighInForm({
  weighings,
  today,
  date,
  onSave,
  error,
}: {
  weighings: readonly Weighing[];
  today: ISODate;
  date: ISODate;
  onSave: (date: ISODate, kg: number) => void;
  error?: string;
}) {
  const { t, i18n } = useTranslation();
  const start = startingWeight(weighings, date, today);
  const [edited, setEdited] = useState<number | null | undefined>(undefined);
  // In the person's unit. A value that still reads as the stored one gives that kg back, so an
  // untouched prefill in pounds saves the weigh-in it came from, never a round trip through lb.
  // The shared conversions rather than weightStepper: lib/units is in the startup bundle (Accueil
  // reads a body weight), so whatever of it a lazy sheet uses would load at startup too.
  const unit = readWeightUnit();
  const step = stepIn(WEIGHING_RANGE_KG.step, unit);
  const bounds = rangeIn(WEIGHING_RANGE_KG, unit, step);
  const shown = start.kg === null ? null : weighingFromKg(start.kg, unit);
  const value = edited === undefined ? shown : edited;
  const kg =
    value === null
      ? null
      : value === shown
        ? start.kg
        : roundTo(kgFromWeighing(value, unit), WEIGHING_RANGE_KG.step);
  const invalid = kg !== null && !isWeighingKg(kg);
  const bound = (v: number) => formatNumber(v, i18n.language, { digits: 1, grouping: false });
  return (
    <div className="flex flex-col gap-2.5">
      <NumberStepper
        label={t("weighIn.weight")}
        labelHidden
        value={value}
        onChange={setEdited}
        min={bounds.min}
        max={bounds.max}
        step={step}
        unit={unit}
        optional
        clampTyped={false}
        error={
          invalid
            ? t("weighIn.outOfRange", {
                min: bound(bounds.min),
                max: bound(bounds.max),
                unit,
              })
            : undefined
        }
      />
      {start.prefilled && edited === undefined && (
        <p className="text-[13px] text-muted-foreground">{t("weighIn.prefilled")}</p>
      )}
      <Button disabled={kg === null || invalid} onClick={() => kg !== null && onSave(date, kg)}>
        {t("weighIn.save")}
      </Button>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
