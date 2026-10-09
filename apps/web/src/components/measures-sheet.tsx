import "@/i18n/lazy";
import type { ISODate } from "@belay/shared/body/dates";
import {
  isMeasureCm,
  type Measure,
  MEASURE_BOUNDS,
  type MeasureField,
  measureOf,
} from "@belay/shared/body/measures";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DayChip } from "./day-chip";
import { NumberStepper } from "./number-stepper";
import { Sheet } from "./sheet";
import { Button } from "./ui/button";
import type { Entry } from "./weigh-in";

// The measurements sheet (§4.2), opened from Body: the waist, then the neck and hips if the
// person wants them, for one day. Each saved field is its own entry, as on the server.
export function MeasuresSheet({
  onClose,
  measures,
  today,
  date,
  onDate,
  onWrite,
  error,
}: {
  onClose: () => void;
  measures: readonly Measure[];
  today: ISODate;
  date: ISODate;
  onDate: (date: ISODate) => void;
  onWrite: (entries: Entry[], previous: Entry[], deleted: boolean) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const own = measures.find((m) => m.date === date);
  const held = (f: MeasureField) => (own ? measureOf(own, f) : null);
  const entry = (field: MeasureField, value: number | null): Entry => ({
    kind: "measure",
    date,
    field,
    value,
  });
  return (
    <Sheet
      title={t("measures.title")}
      onClose={onClose}
      chip={<DayChip date={date} today={today} onChange={onDate} label={t("measures.date")} />}
    >
      <MeasuresForm
        key={date}
        own={own}
        error={error}
        onSave={(values) => {
          // A field emptied deletes the day's value; one never entered stays unwritten.
          const fields = (["waist", "neck", "hip"] as const).filter(
            (f) => values[f] !== null || held(f) !== null,
          );
          onWrite(
            fields.map((f) => entry(f, values[f])),
            fields.map((f) => entry(f, held(f))),
            false,
          );
        }}
      />
      {own && (
        <Button
          variant="outline"
          className="h-12 rounded-field text-base font-semibold"
          onClick={() => {
            const fields = (["waist", "neck", "hip"] as const).filter((f) => held(f) !== null);
            onWrite(
              fields.map((f) => entry(f, null)),
              fields.map((f) => entry(f, held(f))),
              true,
            );
          }}
        >
          {t("measures.delete")}
        </Button>
      )}
    </Sheet>
  );
}

function MeasuresForm({
  own,
  onSave,
  error,
}: {
  own: Measure | undefined;
  onSave: (values: Record<MeasureField, number | null>) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<MeasureField, number | null>>({
    waist: own?.waistCm ?? null,
    neck: own?.neckCm ?? null,
    hip: own?.hipCm ?? null,
  });
  const bad = (f: MeasureField) => values[f] !== null && !isMeasureCm(f, values[f]);
  const stepper = (f: MeasureField, label: string) => (
    <NumberStepper
      label={label}
      value={values[f]}
      onChange={(v) => setValues((s) => ({ ...s, [f]: v }))}
      min={MEASURE_BOUNDS[f].min}
      max={MEASURE_BOUNDS[f].max}
      step={MEASURE_BOUNDS[f].step}
      unit="cm"
      optional
      clampTyped={false}
      error={
        bad(f)
          ? t("measures.outOfRange", { min: MEASURE_BOUNDS[f].min, max: MEASURE_BOUNDS[f].max })
          : undefined
      }
    />
  );
  return (
    <div className="flex flex-col gap-3">
      {stepper("waist", t("measures.waist"))}
      <p className="-mt-1 text-[13px] text-muted-foreground">{t("measures.waistHint")}</p>
      {/* Side by side from 400 px: under it, the steppers' buttons would squeeze the value. */}
      <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
        {stepper("neck", t("measures.neck"))}
        {stepper("hip", t("measures.hip"))}
      </div>
      <p className="-mt-1 text-[13px] text-muted-foreground">{t("measures.neckHipHint")}</p>
      <Button
        className="h-12 rounded-field text-base font-semibold"
        disabled={values.waist === null || bad("waist") || bad("neck") || bad("hip")}
        onClick={() => onSave(values)}
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
