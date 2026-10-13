import type { ISODate } from "@belay/shared/body/dates";
import type { Activity } from "@belay/shared/training/activities";
import { planFor } from "@belay/shared/training/plan";
import {
  estimatedMinutes,
  nextSession,
  sessionByCode,
  starterProgram,
} from "@belay/shared/training/program";
import type { Workout } from "@belay/shared/training/workout";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DayChip } from "@/components/day-chip";
import { DurationStepper } from "@/components/duration-stepper";
import { Segmented, type SegmentedOptions } from "@/components/segmented";
import { Sheet } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { sessionTitle } from "@/lib/format";

// The bounds of a session's duration logged afterwards (spec §5).
const MINUTES = { min: 5, max: 480, step: 5 } as const;

// « + Saisir une séance » (spec D10): the day, the session of the program and its duration,
// estimated until the person changes it; then the editor, to enter the sets.
export function LogSessionSheet({
  today,
  workouts,
  activities,
  onClose,
  onOpen,
}: {
  today: ISODate;
  workouts: readonly Workout[];
  activities: readonly Activity[];
  onClose: () => void;
  onOpen: (code: string, date: ISODate, minutes: number) => void;
}) {
  const { t } = useTranslation();
  const [date, setDate] = useState(today);
  const [code, setCode] = useState(() => nextSession(workouts));
  const [minutes, setMinutes] = useState<number | null>(null); // null: the estimate
  const estimate = estimatedMinutes({ slots: planFor(sessionByCode(code)!, activities, date) });
  const shown = minutes ?? Math.min(MINUTES.max, estimate);
  return (
    <Sheet
      title={t("history.log.title")}
      onClose={onClose}
      chip={<DayChip date={date} today={today} onChange={setDate} label={t("history.log.date")} />}
    >
      <div className="flex flex-col gap-1.5">
        <Segmented
          label={t("history.log.session")}
          value={code}
          onChange={setCode}
          options={
            starterProgram.map((s) => ({
              value: s.code,
              label: s.code,
            })) as unknown as SegmentedOptions<string>
          }
        />
        <p className="text-[13px] text-muted-foreground">{sessionTitle(code, t)}</p>
      </div>
      <DurationStepper
        label={t("history.log.duration")}
        value={shown}
        onChange={setMinutes}
        min={MINUTES.min}
        max={MINUTES.max}
        step={MINUTES.step}
      />
      <Button onClick={() => onOpen(code, date, shown)}>{t("history.log.open")}</Button>
    </Sheet>
  );
}
