import "@/i18n/lazy";
import { newId } from "@belay/shared";
import type { ISODate } from "@belay/shared/body/dates";
import {
  ACTIVITY_MINUTES,
  type Activity,
  type ActivityKind,
  CARDIO_TYPES,
  type CardioType,
  CLIMB_COLORS,
  CLIMB_GRADES,
  CLIMB_RUNS,
  type ClimbColor,
  type ClimbStyle,
  isClimbRuns,
  isSteps,
  STEPS,
  type StepsLog,
  stepsOf,
} from "@belay/shared/training/activities";
import { RadioGroup } from "radix-ui";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { activityText } from "@/lib/activities";
import { ChoiceList } from "./choice-list";
import { DayChip } from "./day-chip";
import { DurationStepper } from "./duration-stepper";
import { NumberStepper } from "./number-stepper";
import { Segmented } from "./segmented";
import { Sheet } from "./sheet";
import { Button } from "./ui/button";
import type { Entry } from "./weigh-in";

type Tab = ActivityKind | "steps";
const TABS: readonly Tab[] = ["cardio", "climbing", "steps"];
// The segment last chosen, on this device: the next climb is two taps from Home.
const KEY = "belay.activity.tab";
function readTab(): Tab {
  try {
    const stored = localStorage.getItem(KEY) as Tab | null;
    return stored && TABS.includes(stored) ? stored : "climbing";
  } catch {
    return "climbing";
  }
}
function writeTab(tab: Tab) {
  try {
    localStorage.setItem(KEY, tab);
  } catch {
    // Private mode: the choice lasts for this visit only.
  }
}

export type ActivityToast = "saved" | "deleted" | "stepsSaved" | "stepsDeleted";

// The activity sheet (spec §4.2): cardio, a climb or the day's steps, for one day. An activity of
// that day reopens here, with Delete; several of them are listed to pick from.
export function ActivitySheet({
  onClose,
  activities,
  steps,
  today,
  date,
  onDate,
  onWrite,
  error,
}: {
  onClose: () => void;
  activities: readonly Activity[];
  steps: readonly StepsLog[];
  today: ISODate;
  date: ISODate;
  onDate: (date: ISODate) => void;
  // The entries, the values they replace (for the undo), and what the toast says.
  onWrite: (entries: Entry[], previous: Entry[], toast: ActivityToast) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>(readTab);
  return (
    <Sheet
      title={t("activitySheet.title")}
      onClose={onClose}
      chip={<DayChip date={date} today={today} onChange={onDate} label={t("activitySheet.date")} />}
    >
      <Segmented
        label={t("activitySheet.kind")}
        labelHidden
        value={tab}
        onChange={(next) => {
          setTab(next);
          writeTab(next);
        }}
        options={[
          { value: "cardio", label: t("activitySheet.tabs.cardio") },
          { value: "climbing", label: t("activitySheet.tabs.climbing") },
          { value: "steps", label: t("activitySheet.tabs.steps") },
        ]}
      />
      {tab === "steps" ? (
        <StepsForm key={date} date={date} steps={steps} onWrite={onWrite} error={error} />
      ) : (
        <ActivityForm
          key={`${date}|${tab}`}
          kind={tab}
          date={date}
          activities={activities}
          onWrite={onWrite}
          error={error}
        />
      )}
    </Sheet>
  );
}

// The day's activities of this kind to pick from (when there are some), then the fields.
function ActivityForm({
  kind,
  date,
  activities,
  onWrite,
  error,
}: {
  kind: ActivityKind;
  date: ISODate;
  activities: readonly Activity[];
  onWrite: (entries: Entry[], previous: Entry[], toast: ActivityToast) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const own = activities.filter((a) => a.date === date && a.kind === kind && !a.removed);
  const [chosen, setChosen] = useState<string>(own.at(-1)?.id ?? "new");
  const editing = own.find((a) => a.id === chosen) ?? null;
  // A new one starts from the last of its kind: the same climb again is one tap.
  const last = activities.filter((a) => a.kind === kind && a.date <= date).at(-1) ?? null;
  return (
    <>
      {own.length > 0 && (
        <ChoiceList
          label={t("activitySheet.thisDay")}
          value={chosen}
          onChange={setChosen}
          options={[
            ...own.map((a) => ({ value: a.id, label: activityText(a, t) })),
            { value: "new", label: t(`activitySheet.another.${kind}`) },
          ]}
        />
      )}
      <Fields
        key={chosen}
        kind={kind}
        date={date}
        editing={editing}
        start={editing ?? last}
        onWrite={onWrite}
        error={error}
      />
    </>
  );
}

const EMPTY = {
  cardioType: null,
  climbStyle: null,
  climbRuns: null,
  climbGrade: null,
  climbColor: null,
} as const;

function Fields({
  kind,
  date,
  editing,
  start,
  onWrite,
  error,
}: {
  kind: ActivityKind;
  date: ISODate;
  editing: Activity | null;
  start: Activity | null;
  onWrite: (entries: Entry[], previous: Entry[], toast: ActivityToast) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const [id] = useState(() => editing?.id ?? newId());
  const [minutes, setMinutes] = useState(start?.durationMin ?? (kind === "climbing" ? 90 : 45));
  const [cardioType, setCardioType] = useState<CardioType>(start?.cardioType ?? "run");
  const [runs, setRuns] = useState<number | null>(start?.climbRuns ?? null);
  const [style, setStyle] = useState<ClimbStyle | null>(start?.climbStyle ?? null);
  const [by, setBy] = useState<"grade" | "color">(start?.climbColor ? "color" : "grade");
  const [grade, setGrade] = useState<string | null>(start?.climbGrade ?? null);
  const [color, setColor] = useState<ClimbColor | null>(start?.climbColor ?? null);
  const [confirming, setConfirming] = useState(false);
  const badRuns = runs !== null && !isClimbRuns(runs);
  const block = (a: Omit<Activity, "id" | "removed">): Entry => ({
    kind: "activity",
    id,
    field: "fields",
    date: a.date,
    type: a.kind,
    durationMin: a.durationMin,
    cardioType: a.cardioType,
    climbStyle: a.climbStyle,
    climbRuns: a.climbRuns,
    climbGrade: a.climbGrade,
    climbColor: a.climbColor,
  });
  const save = () =>
    onWrite(
      [
        block(
          kind === "cardio"
            ? { ...EMPTY, date, kind, durationMin: minutes, cardioType }
            : {
                ...EMPTY,
                date,
                kind,
                durationMin: minutes,
                climbStyle: style,
                climbRuns: runs,
                climbGrade: by === "grade" ? grade : null,
                climbColor: by === "color" ? color : null,
              },
        ),
      ],
      editing ? [block(editing)] : [{ kind: "activity", id, field: "removed", value: true }],
      "saved",
    );
  const remove = () =>
    onWrite(
      [{ kind: "activity", id, field: "removed", value: true }],
      [{ kind: "activity", id, field: "removed", value: false }],
      "deleted",
    );
  return (
    <div className="flex flex-col gap-3">
      {kind === "cardio" && (
        <Chips
          label={t("activitySheet.cardioType")}
          value={cardioType}
          options={CARDIO_TYPES.map((c) => ({ value: c, label: t(`activities.cardio.${c}`) }))}
          onChange={(v) => v && setCardioType(v)}
        />
      )}
      <DurationStepper
        label={t("activitySheet.duration")}
        value={minutes}
        onChange={setMinutes}
        min={ACTIVITY_MINUTES.min}
        max={ACTIVITY_MINUTES.max}
        step={ACTIVITY_MINUTES.step}
      />
      {kind === "climbing" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <NumberStepper
              label={t("activitySheet.runs")}
              value={runs}
              onChange={setRuns}
              min={CLIMB_RUNS.min}
              max={CLIMB_RUNS.max}
              step={1}
              optional
              clampTyped={false}
              error={badRuns ? t("activitySheet.runsOutOfRange") : undefined}
            />
            <Segmented
              label={t("activitySheet.style")}
              value={style}
              onChange={setStyle}
              options={[
                { value: "boulder", label: t("activitySheet.styles.boulder") },
                { value: "route", label: t("activitySheet.styles.route") },
              ]}
            />
          </div>
          <Segmented
            label={t("activitySheet.hardest")}
            value={by}
            onChange={setBy}
            options={[
              { value: "grade", label: t("activitySheet.by.grade") },
              { value: "color", label: t("activitySheet.by.color") },
            ]}
          />
          {by === "grade" ? (
            <Chips
              label={t("activitySheet.by.grade")}
              labelHidden
              value={grade}
              options={CLIMB_GRADES.map((g) => ({ value: g, label: g }))}
              onChange={setGrade}
            />
          ) : (
            <Colors value={color} onChange={setColor} />
          )}
        </>
      )}
      <Button disabled={badRuns} onClick={save}>
        {t("weighIn.save")}
      </Button>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      {editing && <Delete confirming={confirming} onAsk={setConfirming} onDelete={remove} />}
    </div>
  );
}

function StepsForm({
  date,
  steps,
  onWrite,
  error,
}: {
  date: ISODate;
  steps: readonly StepsLog[];
  onWrite: (entries: Entry[], previous: Entry[], toast: ActivityToast) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const own = stepsOf(steps, date);
  const [value, setValue] = useState<number | null>(own);
  const [confirming, setConfirming] = useState(false);
  const bad = value !== null && !isSteps(value);
  const entry = (v: number | null): Entry => ({ kind: "steps", date, value: v });
  return (
    <div className="flex flex-col gap-3">
      <NumberStepper
        label={t("activitySheet.steps")}
        value={value}
        onChange={setValue}
        min={STEPS.min}
        max={STEPS.max}
        step={STEPS.step}
        optional
        clampTyped={false}
        error={bad ? t("activitySheet.stepsOutOfRange") : undefined}
        hint={<p className="text-[13px] text-muted-foreground">{t("activitySheet.stepsNote")}</p>}
      />
      <Button
        // Emptied, it deletes the day's steps; never entered, there is nothing to save.
        disabled={bad || (value === null && own === null)}
        onClick={() =>
          onWrite([entry(value)], [entry(own)], value === null ? "stepsDeleted" : "stepsSaved")
        }
      >
        {t("weighIn.save")}
      </Button>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      {own !== null && (
        <Delete
          steps
          confirming={confirming}
          onAsk={setConfirming}
          onDelete={() => onWrite([entry(null)], [entry(own)], "stepsDeleted")}
        />
      )}
    </div>
  );
}

// Delete, then a second tap to be sure (spec §4.2: with a confirmation).
function Delete({
  steps = false,
  confirming,
  onAsk,
  onDelete,
}: {
  steps?: boolean;
  confirming: boolean;
  onAsk: (asking: boolean) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  if (!confirming)
    return (
      <Button variant="secondary" onClick={() => onAsk(true)}>
        {t(steps ? "activitySheet.deleteSteps" : "activitySheet.delete")}
      </Button>
    );
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2">
      <p id={id} className="font-semibold">
        {t(steps ? "activitySheet.confirmSteps" : "activitySheet.confirm")}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => onAsk(false)}>
          {t("activitySheet.cancel")}
        </Button>
        <Button variant="destructive" onClick={onDelete}>
          {t("activitySheet.confirmDelete")}
        </Button>
      </div>
    </div>
  );
}

// More than three options, or words that do not fit a segmented control: chips on several
// lines, a radio group (arrow keys); a second tap on the chosen one empties it, when optional.
function Chips<T extends string>({
  label,
  labelHidden = false,
  value,
  options,
  onChange,
}: {
  label: string;
  labelHidden?: boolean;
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (value: T | null) => void;
}) {
  const chip =
    "min-h-11 min-w-11 rounded-chip border border-input bg-card px-3 text-sm font-semibold data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background";
  return (
    <div className="flex flex-col gap-1.5">
      <span className={labelHidden ? "sr-only" : "text-[13px] font-semibold"}>{label}</span>
      <RadioGroup.Root
        aria-label={label}
        value={value ?? ""}
        onValueChange={(v) => onChange(v as T)}
        className="flex flex-wrap gap-2"
      >
        {options.map((o) => (
          <RadioGroup.Item
            key={o.value}
            value={o.value}
            onClick={() => value === o.value && onChange(null)}
            className={chip}
          >
            {o.label}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  );
}

// The circuit colours: a dot each, with its name for screen readers and, once chosen, under the
// dots for everyone (a colour never carries the meaning alone).
const DOT: Readonly<Record<ClimbColor, string>> = {
  yellow: "var(--hold-yellow)",
  green: "var(--hold-green)",
  blue: "var(--hold-blue)",
  red: "var(--hold-red)",
  black: "var(--hold-black)",
  purple: "var(--hold-purple)",
  white: "var(--hold-white)",
};
function Colors({
  value,
  onChange,
}: {
  value: ClimbColor | null;
  onChange: (value: ClimbColor | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <RadioGroup.Root
        aria-label={t("activitySheet.by.color")}
        orientation="horizontal"
        value={value ?? ""}
        onValueChange={(v) => onChange(v as ClimbColor)}
        className="flex flex-wrap gap-1"
      >
        {CLIMB_COLORS.map((c) => (
          <RadioGroup.Item
            key={c}
            value={c}
            aria-label={t(`activities.colors.${c}`)}
            onClick={() => value === c && onChange(null)}
            className="group grid size-11 place-items-center rounded-full"
          >
            {/* A dark outline against the card gives every colour, white too, a 3:1 edge. */}
            <span
              aria-hidden
              className="size-8 rounded-full border-[1.5px] border-muted-foreground group-data-[state=checked]:outline-3 group-data-[state=checked]:outline-offset-2 group-data-[state=checked]:outline-foreground"
              style={{ backgroundColor: DOT[c] }}
            />
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
      <p aria-hidden className="min-h-5 text-[13px] text-muted-foreground first-letter:uppercase">
        {value ? t(`activities.colors.${value}`) : ""}
      </p>
    </div>
  );
}
