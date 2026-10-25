import { setSchedule } from "@belay/shared/training/program-edits";
import { fixedWeek, proposeWeek, sessionDays } from "@belay/shared/training/schedule";
import type {
  LetteredTemplate,
  Program,
  Schedule,
  StoredPrograms,
} from "@belay/shared/training/stored-program";
import type { TFunction } from "i18next";
import { Calendar } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FieldError } from "@/components/field-error";
import { GroupedList, RowButton } from "@/components/grouped-list";
import { MenuRow } from "@/components/menu-row";
import { Segmented } from "@/components/segmented";
import { Sheet } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { dayName, sessionName } from "@/lib/format";
import { useToday } from "@/lib/today";
import { type OpenAccount, useHistory, useRecord } from "@/sync/account";

type Mode = Schedule["mode"];
const REST = "rest";
// Past three sessions, four chips and the day's name no longer fit a 360 px row: each day becomes
// a menu row instead, as the log sheet does.
const CHIPS_MAX = 3;

const secondary =
  "text-(length:--text-secondary) leading-(--text-secondary--line-height) text-muted-foreground";
// The chips of the set under way (radius 10, input border, the chosen one filled), 44 px.
const chip =
  "grid h-11 min-w-11 place-items-center rounded-chip border border-input bg-card px-2.5 text-(length:--text-secondary) font-semibold outline-ring focus-visible:outline-2 focus-visible:-outline-offset-2 data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background";

// The rotation's letters in turn: « A, B, C » up to four, « A à G » from five, one alone.
function inTurn(rotation: readonly LetteredTemplate[], t: TFunction): string {
  const letters = rotation.map((s) => s.code);
  if (letters.length === 1) return t("workouts.program.rhythm.single", { letter: letters[0] });
  if (letters.length <= 4)
    return t("workouts.program.rhythm.inTurn", { letters: letters.join(", ") });
  return t("workouts.program.rhythm.span", { first: letters[0], last: letters.at(-1) });
}

const named = (s: LetteredTemplate, t: TFunction) =>
  t("workouts.program.rhythm.named", {
    code: s.code,
    name: sessionName({ ...s, id: s.sessionId }, t),
  });

// The active program's rhythm on Programme: in rotation or on fixed days, with what that means
// in a second line. A fixed week naming no session of the rotation runs in rotation, so it reads
// as one. Nothing without a live active program or with an empty rotation.
export function RhythmRow({
  account,
  programs,
  rotation,
}: {
  account: OpenAccount;
  programs: StoredPrograms;
  rotation: readonly LetteredTemplate[];
}) {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState(false);
  const program = programs.programs.find((p) => p.id === programs.activeId && !p.removed);
  if (!program || rotation.length === 0) return null;
  const week = fixedWeek(programs, rotation);
  return (
    <>
      <RowButton
        icon={Calendar}
        label={t("workouts.program.rhythm.row")}
        sub={
          week
            ? t("workouts.program.rhythm.perWeek", { count: sessionDays(week) })
            : inTurn(rotation, t)
        }
        value={t(week ? "workouts.program.rhythm.fixed" : "workouts.program.rhythm.rotation")}
        trailing="push"
        onClick={() => setSheet(true)}
      />
      {sheet && (
        <RhythmSheet
          account={account}
          program={program}
          programs={programs}
          rotation={rotation}
          opened={week ? "fixed" : "rotation"}
          onClose={() => setSheet(false)}
        />
      )}
    </>
  );
}

// The draft starts from the stored days; a day whose session left the rotation shows as a rest
// day but keeps its session, so it comes back with it unless the day is changed. Switching to
// fixed days with no session day proposes a week from the history. Saving writes one schedule
// change, or nothing when the result is what the sheet opened on; closing any other way drops
// the draft.
function RhythmSheet({
  account,
  program,
  programs,
  rotation,
  opened,
  onClose,
}: {
  account: OpenAccount;
  program: Program;
  programs: StoredPrograms;
  rotation: readonly LetteredTemplate[];
  opened: Mode;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const write = useRecord(account);
  const workouts = useHistory(account).data?.workouts;
  const today = useToday();
  const noteId = useId();
  const failedId = useId();
  const [open, setOpen] = useState(true);
  // The schedule as the sheet opened: a newer one syncing in meanwhile is not the draft's doing,
  // so an untouched sheet leaves it be.
  const [start] = useState(() => ({ mode: opened, days: [...program.schedule.days] }));
  const [mode, setMode] = useState<Mode>(start.mode);
  const [days, setDays] = useState<(string | null)[]>(start.days);
  const [learned, setLearned] = useState(false);
  const [needOne, setNeedOne] = useState(false);
  const [failed, setFailed] = useState(false);
  const saving = useRef(false);
  const inRotation = (day: string | null) => rotation.some((s) => s.sessionId === day);
  const shown = (day: string | null) => (inRotation(day) ? day! : REST);

  const choose = (next: Mode) => {
    setMode(next);
    setNeedOne(false);
    if (next === "fixed" && !days.some(inRotation)) {
      const proposal = proposeWeek(workouts ?? [], rotation, today, programs.activeAt);
      setDays(proposal.days);
      setLearned(proposal.learned);
    }
  };
  const pick = (index: number, value: string) => {
    setDays(days.map((d, i) => (i === index ? (value === REST ? null : value) : d)));
    setNeedOne(false);
  };
  const save = async () => {
    if (saving.current) return;
    if (mode === "fixed" && !days.some(inRotation)) {
      setNeedOne(true);
      return;
    }
    // Back to rotation, the days stay as stored, to be offered again.
    const schedule: Schedule = { mode, days: mode === "fixed" ? days : program.schedule.days };
    // Against the opening state: in rotation both ways (a stored fixed week naming no session
    // already runs in rotation), or the same fixed days.
    const same =
      mode === start.mode && (mode === "rotation" || days.every((d, i) => d === start.days[i]));
    if (!same) {
      saving.current = true;
      setFailed(false);
      // A refused write (a lost connection, a full disk) keeps the draft open to try again.
      try {
        await write(setSchedule(program.id, schedule, new Date().toISOString()));
      } catch {
        setFailed(true);
        return;
      } finally {
        saving.current = false;
      }
    }
    setOpen(false);
  };

  const locale = i18n.language;
  const options = [
    { value: REST, label: t("workouts.program.rhythm.rest") },
    ...rotation.map((s) => ({ value: s.sessionId, label: named(s, t) })),
  ];
  return (
    <Sheet title={t("workouts.program.rhythm.title")} open={open} onClose={onClose}>
      <Segmented
        label={t("workouts.program.rhythm.mode")}
        labelHidden
        value={mode}
        onChange={choose}
        options={[
          { value: "rotation", label: t("workouts.program.rhythm.rotation") },
          { value: "fixed", label: t("workouts.program.rhythm.fixed") },
        ]}
      />
      {mode === "rotation" ? (
        <p className={`px-0.5 ${secondary}`}>{t("workouts.program.rhythm.rotationNote")}</p>
      ) : (
        <>
          <p className={`px-0.5 ${secondary}`}>
            {t(learned ? "workouts.program.rhythm.proposed" : "workouts.program.rhythm.tapHint")}
          </p>
          {rotation.length > CHIPS_MAX ? (
            <GroupedList>
              {days.map((day, i) => (
                <MenuRow
                  key={i}
                  label={dayName(i, locale)}
                  value={shown(day)}
                  options={options}
                  onChange={(v) => pick(i, v)}
                />
              ))}
            </GroupedList>
          ) : (
            <>
              <div className="divide-y divide-border">
                {days.map((day, i) => (
                  <div key={i} className="flex min-h-13 items-center justify-between gap-2 py-1">
                    <span aria-hidden className="text-body font-semibold whitespace-nowrap">
                      {dayName(i, locale)}
                    </span>
                    <RadioGroup.Root
                      aria-label={dayName(i, locale)}
                      orientation="horizontal"
                      value={shown(day)}
                      onValueChange={(v) => pick(i, v)}
                      className="flex gap-2"
                    >
                      {rotation.map((s) => (
                        <RadioGroup.Item key={s.sessionId} value={s.sessionId} className={chip}>
                          {s.code}
                        </RadioGroup.Item>
                      ))}
                      <RadioGroup.Item value={REST} className={chip}>
                        {t("workouts.program.rhythm.rest")}
                      </RadioGroup.Item>
                    </RadioGroup.Root>
                  </div>
                ))}
              </div>
              <p className={`px-0.5 ${secondary}`}>{rotation.map((s) => named(s, t)).join(", ")}</p>
            </>
          )}
          {needOne && <FieldError id={noteId}>{t("workouts.program.rhythm.needOne")}</FieldError>}
        </>
      )}
      {failed && <FieldError id={failedId}>{t("weighIn.saveFailed")}</FieldError>}
      <Button
        variant="primary"
        className="w-full"
        aria-describedby={failed ? failedId : undefined}
        onClick={() => void save()}
      >
        {t("workouts.program.rhythm.save")}
      </Button>
    </Sheet>
  );
}
