import "@/i18n/lazy";
import type { ISODate } from "@belay/shared/body/dates";
import { isWeighingKg, WEIGHING_RANGE_KG, type Weighing } from "@belay/shared/body/weighings";
import { roundTo } from "@belay/shared/tools/round";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DayChip } from "./day-chip";
import { NumberStepper } from "./number-stepper";
import { Sheet } from "./sheet";
import { Button } from "./ui/button";
import { startingWeight } from "./weigh-in";

// The weigh-in sheet (§4.2): the weight, then Save, plus Delete when the day has a weigh-in.
// Lazy: its code (and the stepper's) loads the first time a sheet opens.
export function WeighInSheet({
  onClose,
  weighings,
  today,
  date,
  onDate,
  onSave,
  onDelete,
  error,
}: {
  onClose: () => void;
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
        <Button
          variant="outline"
          className="h-12 rounded-field text-base font-semibold"
          onClick={() => onDelete(date)}
        >
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
  const { t } = useTranslation();
  const start = startingWeight(weighings, date, today);
  const [edited, setEdited] = useState<number | null | undefined>(undefined);
  const value = edited === undefined ? start.kg : edited;
  const kg = value === null ? null : roundTo(value, WEIGHING_RANGE_KG.step);
  const invalid = kg !== null && !isWeighingKg(kg);
  return (
    <div className="flex flex-col gap-2.5">
      <NumberStepper
        label={t("weighIn.weight")}
        labelHidden
        value={value}
        onChange={setEdited}
        min={WEIGHING_RANGE_KG.min}
        max={WEIGHING_RANGE_KG.max}
        step={WEIGHING_RANGE_KG.step}
        unit="kg"
        optional
        clampTyped={false}
        error={invalid ? t("weighIn.outOfRange") : undefined}
      />
      {start.prefilled && edited === undefined && (
        <p className="text-[13px] text-muted-foreground">{t("weighIn.prefilled")}</p>
      )}
      <Button
        className="h-12 rounded-field text-base font-semibold"
        disabled={kg === null || invalid}
        onClick={() => kg !== null && onSave(date, kg)}
      >
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
