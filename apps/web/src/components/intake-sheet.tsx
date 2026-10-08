import "@/i18n/lazy";
import type { ISODate } from "@belay/shared/body/dates";
import { INTAKE_BOUNDS, type IntakeLog, isKcal, isProteinG } from "@belay/shared/body/intake";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DayChip } from "./day-chip";
import { NumberStepper } from "./number-stepper";
import { Sheet } from "./sheet";
import { Button } from "./ui/button";
import type { Entry } from "./weigh-in";

// The day's own values, else the last entry up to today (one tap when it is the same), else empty.
export function startingIntake(
  logs: readonly IntakeLog[],
  date: ISODate,
  today: ISODate,
): { kcal: number | null; proteinG: number | null; prefilled: boolean } {
  const own = logs.find((l) => l.date === date);
  if (own) return { kcal: own.kcal, proteinG: own.proteinG, prefilled: false };
  const last = logs
    .filter((l) => l.date <= today && l.kcal !== null)
    .reduce<IntakeLog | undefined>((a, l) => (a && a.date > l.date ? a : l), undefined);
  return last
    ? { kcal: last.kcal, proteinG: last.proteinG, prefilled: true }
    : { kcal: null, proteinG: null, prefilled: false };
}

// The intake sheet (§4.2): one total of calories, protein if the person wants, for one day.
export function IntakeSheet({
  onClose,
  logs,
  today,
  date,
  onDate,
  onWrite,
  error,
}: {
  onClose: () => void;
  logs: readonly IntakeLog[];
  today: ISODate;
  date: ISODate;
  onDate: (date: ISODate) => void;
  // The entries, the values they replace (for the undo), and whether it was a deletion.
  onWrite: (entries: Entry[], previous: Entry[], deleted: boolean) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const own = logs.find((l) => l.date === date);
  const entry = (field: "kcal" | "protein", value: number | null): Entry => ({
    kind: "intake",
    date,
    field,
    value,
  });
  // What the day held, for the fields the write touches.
  const before = (fields: ("kcal" | "protein")[]) =>
    fields.map((f) => entry(f, (f === "kcal" ? own?.kcal : own?.proteinG) ?? null));
  return (
    <Sheet
      title={t("today.intake")}
      onClose={onClose}
      chip={<DayChip date={date} today={today} onChange={onDate} label={t("intake.date")} />}
    >
      <IntakeForm
        key={date}
        logs={logs}
        today={today}
        date={date}
        error={error}
        onSave={(kcal, proteinG) => {
          // An emptied protein deletes the day's value; one never entered stays unwritten.
          const fields: ("kcal" | "protein")[] =
            proteinG !== null || own?.proteinG != null ? ["kcal", "protein"] : ["kcal"];
          onWrite(
            fields.map((f) => entry(f, f === "kcal" ? kcal : proteinG)),
            before(fields),
            false,
          );
        }}
      />
      {own && (
        <Button
          variant="outline"
          className="h-12 rounded-field text-base font-semibold"
          onClick={() => {
            const fields = (["kcal", "protein"] as const).filter((f) =>
              f === "kcal" ? own.kcal !== null : own.proteinG !== null,
            );
            onWrite(
              fields.map((f) => entry(f, null)),
              before([...fields]),
              true,
            );
          }}
        >
          {t("intake.delete")}
        </Button>
      )}
    </Sheet>
  );
}

function IntakeForm({
  logs,
  today,
  date,
  onSave,
  error,
}: {
  logs: readonly IntakeLog[];
  today: ISODate;
  date: ISODate;
  onSave: (kcal: number, proteinG: number | null) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const start = startingIntake(logs, date, today);
  const [kcal, setKcal] = useState<number | null | undefined>(undefined);
  const [protein, setProtein] = useState<number | null | undefined>(undefined);
  const k = kcal === undefined ? start.kcal : kcal;
  const p = protein === undefined ? start.proteinG : protein;
  const badKcal = k !== null && !isKcal(k);
  const badProtein = p !== null && !isProteinG(p);
  const { kcal: K, protein: P } = INTAKE_BOUNDS;
  return (
    <div className="flex flex-col gap-3">
      <NumberStepper
        label={t("intake.kcal")}
        value={k}
        onChange={setKcal}
        min={K.min}
        max={K.max}
        step={K.step}
        unit="kcal"
        optional
        clampTyped={false}
        error={badKcal ? t("intake.kcalOutOfRange") : undefined}
      />
      <NumberStepper
        label={t("intake.protein")}
        value={p}
        onChange={setProtein}
        min={P.min}
        max={P.max}
        step={P.step}
        unit="g"
        optional
        clampTyped={false}
        error={badProtein ? t("intake.proteinOutOfRange") : undefined}
      />
      <Button
        className="h-12 rounded-field text-base font-semibold"
        disabled={k === null || badKcal || badProtein}
        onClick={() => k !== null && onSave(k, p)}
      >
        {t("weighIn.save")}
      </Button>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      <p className="text-[13px] text-muted-foreground">
        {t("intake.note")}
        {start.prefilled &&
          kcal === undefined &&
          protein === undefined &&
          ` ${t("intake.prefilled")}`}
      </p>
    </div>
  );
}
