import type { ISODate } from "@belay/shared/body/dates";
import type { Activity } from "@belay/shared/training/activities";
import { planFor } from "@belay/shared/training/plan";
import { estimatedMinutes } from "@belay/shared/training/program";
import {
  type LetteredTemplate,
  nextInRotation,
  type StoredPrograms,
} from "@belay/shared/training/stored-program";
import type { Workout } from "@belay/shared/training/workout";
import { Dumbbell } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DayChip } from "@/components/day-chip";
import { DurationStepper } from "@/components/duration-stepper";
import { GroupedList } from "@/components/grouped-list";
import { MenuRow } from "@/components/menu-row";
import { Segmented, type SegmentedOptions } from "@/components/segmented";
import { Sheet } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { rotationTitle } from "@/lib/format";
import { useAccount, useProgram } from "@/sync/account";

// The bounds of a session's duration logged afterwards (spec §5).
const MINUTES = { min: 5, max: 480, step: 5 } as const;
// Past this many sessions the letters no longer fit a phone's width: a menu row lists them.
const SEGMENTED_MAX = 4;

type SheetProps = {
  today: ISODate;
  workouts: readonly Workout[];
  activities: readonly Activity[];
  onClose: () => void;
  open?: boolean;
  onOpen: (code: string, date: ISODate, minutes: number) => void;
};

// « + Saisir une séance » (spec D10): the day, the session of the active rotation and its
// duration, estimated until the person changes it; then the editor, to enter the sets. With no
// rotation there is nothing to log: the sheet closes at once.
export function LogSessionSheet(props: SheetProps) {
  const account = useAccount();
  const program = useProgram(account.kind === "open" ? account : null).data;
  const none = program?.rotation.length === 0;
  const { onClose } = props;
  useEffect(() => {
    if (none) onClose();
  }, [none, onClose]);
  if (!program || none) return null;
  return <LogSession {...props} programs={program.programs} rotation={program.rotation} />;
}

function LogSession({
  today,
  workouts,
  activities,
  onClose,
  open,
  onOpen,
  programs,
  rotation,
}: SheetProps & { programs: StoredPrograms; rotation: readonly LetteredTemplate[] }) {
  const { t } = useTranslation();
  const [date, setDate] = useState(today);
  const [next] = useState(() => nextInRotation(workouts, rotation, programs.activeAt)!.code);
  const [chosen, setCode] = useState(next);
  // A sync may reorder the rotation while the sheet is open: a letter gone falls back to the first.
  const session = rotation.find((s) => s.code === chosen) ?? rotation[0]!;
  const code = session.code;
  const [minutes, setMinutes] = useState<number | null>(null); // null: the estimate
  const estimate = estimatedMinutes({ slots: planFor(session, activities, date) });
  const shown = minutes ?? Math.min(MINUTES.max, estimate);
  return (
    <Sheet
      title={t("history.log.title")}
      onClose={onClose}
      open={open}
      chip={<DayChip date={date} today={today} onChange={setDate} label={t("history.log.date")} />}
    >
      {rotation.length > SEGMENTED_MAX ? (
        <GroupedList>
          <MenuRow
            icon={Dumbbell}
            label={t("history.log.session")}
            value={code}
            onChange={setCode}
            options={fromNext(rotation, next).map((s) => ({
              value: s.code,
              label: rotationTitle(s, t),
            }))}
          />
        </GroupedList>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Segmented
            label={t("history.log.session")}
            value={code}
            onChange={setCode}
            options={
              rotation.map((s) => ({
                value: s.code,
                label: s.code,
              })) as unknown as SegmentedOptions<string>
            }
          />
          <p className="text-[13px] text-muted-foreground">{rotationTitle(session, t)}</p>
        </div>
      )}
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

// The rotation read from the session it offers next, round to the one before it.
function fromNext(rotation: readonly LetteredTemplate[], next: string) {
  const at = Math.max(
    0,
    rotation.findIndex((s) => s.code === next),
  );
  return [...rotation.slice(at), ...rotation.slice(0, at)];
}
