import { exerciseById } from "@belay/shared/exercises/catalog";
import type { Exercise, Measure } from "@belay/shared/exercises/library";
import {
  countOf,
  type History,
  lastTime,
  type Load,
  measureOfSet,
  prefill,
  warmups,
} from "@belay/shared/training/rules";
import {
  isReps,
  isSeconds,
  isSetKg,
  MAX_POSITION,
  MAX_WARMUPS,
  type Slot,
  type WorkoutSet,
  workPosition,
} from "@belay/shared/training/workout";
import { ArrowLeftRight, Check, ChevronDown, Play } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber, parseDecimal } from "@/lib/format";
import type { Chrono } from "@/sync/db";
import { formatRir, formatSets } from "./format";
import { formatClock } from "./hooks";

// One line of the table: a warm-up (positions 0 to 2) or a work set, done or still to do.
export type Row = {
  position: number;
  warmup: boolean;
  n: number; // as shown: warm-up 1, 2… or set 1, 2…
  set: WorkoutSet | undefined;
  planned: Load | null; // what is prefilled when nothing is done yet
  // Done with the exercise the slot held before it was replaced: shown, never corrected here.
  foreign: boolean;
};

const parseCount = (text: string): number | null =>
  /^\s*\d+\s*$/.test(text) ? Number(text) : null;

// A load in the slot's measure, the other count null.
const loadIn = (measure: Measure, weightKg: number, count: number): Load => ({
  weightKg,
  reps: measure === "reps" ? count : null,
  seconds: measure === "seconds" ? count : null,
});

// The rows of a slot: the warm-ups computed from the first work set's load (D7; none for a timed
// exercise), then the work sets, each prefilled from last time (§7) for the exercise the slot
// holds now, else from the set just done before it in this session. A row already done keeps
// what was done. « + Série » adds `extra` rows past the plan, up to position 49.
export function rowsOf(
  slot: Slot,
  exercise: Exercise,
  sets: readonly WorkoutSet[],
  history: History,
  bar: { barKg: number; platesKg: readonly number[] },
  firstKg: number | null,
  extra = 0,
): Row[] {
  const measure: Measure = slot.measure ?? "reps";
  const at = (position: number) => sets.find((s) => s.position === position);
  const own = (s: WorkoutSet) => s.exerciseId === exercise.id && measureOfSet(s) === measure;
  const before = (k: number) =>
    sets
      .filter((s) => !s.warmup && own(s) && s.position < workPosition(k))
      .sort((a, b) => b.position - a.position)[0];
  const done = sets.filter((s) => !s.warmup).map((s) => s.position - MAX_WARMUPS + 1);
  const count = Math.min(MAX_POSITION - MAX_WARMUPS + 1, Math.max(slot.sets + extra, ...done));
  const work: Row[] = Array.from({ length: count }, (_, k) => {
    const last = prefill(history, exercise.id, k, measure) ?? before(k);
    const set = at(workPosition(k));
    return {
      position: workPosition(k),
      warmup: false,
      n: k + 1,
      set,
      // Nothing at all yet: a bodyweight or timed exercise starts with no added load.
      planned: last
        ? loadIn(measure, last.weightKg, countOf(last))
        : exercise.equipment === "bodyweight" || measure === "seconds"
          ? loadIn(measure, 0, slot.repRange[0])
          : null,
      foreign: set !== undefined && !own(set),
    };
  });
  const first = work.find((r) => !r.foreign);
  const workKg = firstKg ?? first?.set?.weightKg ?? first?.planned?.weightKg ?? null;
  const computed = measure === "reps" ? warmups(slot, workKg, exercise, bar) : [];
  const doneWarmups = sets.filter((s) => s.warmup).map((s) => s.position + 1);
  const warmCount = Math.min(MAX_WARMUPS, Math.max(computed.length, ...doneWarmups, 0));
  const warm: Row[] = Array.from({ length: warmCount }, (_, j) => ({
    position: j,
    warmup: true,
    n: j + 1,
    set: at(j),
    planned: computed[j] ?? null,
    foreign: false,
  }));
  return [...warm, ...work];
}

export function ExerciseCard({
  slot,
  slotIndex,
  exercise,
  sets,
  history,
  bar,
  open,
  current,
  group,
  note,
  chrono,
  now,
  onToggle,
  onValidate,
  onCorrect,
  onNote,
  onReplace,
  onSkip,
  onChrono,
}: {
  slot: Slot;
  slotIndex: number;
  exercise: Exercise;
  sets: WorkoutSet[];
  history: History;
  bar: { barKg: number; platesKg: readonly number[] };
  open: boolean;
  current: boolean;
  group: string | null; // "Tri-set · round 2 of 3"
  note: string;
  chrono: Chrono | null; // this slot's timed set counting down, if any
  now: number;
  onToggle: () => void;
  onValidate: (row: Row, load: Load, rir: number | null) => Promise<void>;
  onCorrect: (set: WorkoutSet, load: Load) => Promise<void>;
  onNote: (text: string) => void;
  onReplace: () => void;
  // Left out for today, or put back: only a slot added today (session C's rule, + Exercice).
  onSkip: ((skipped: boolean) => void) | null;
  onChrono: (chrono: Chrono | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [drafts, setDrafts] = useState<Record<number, { kg?: string; count?: string }>>({});
  const [rirChoice, setRirChoice] = useState<{ position: number; rir: number | null } | null>(null);
  const [noteOpen, setNoteOpen] = useState(note !== "");
  const [busy, setBusy] = useState(false);
  const [extra, setExtra] = useState(0);
  const kgText = (kg: number) => formatNumber(kg, i18n.language, { digits: 2, grouping: false });
  const measure: Measure = slot.measure ?? "reps";
  const timed = measure === "seconds";

  const firstWork = workPosition(0);
  const firstDraft = drafts[firstWork]?.kg;
  const rows = rowsOf(
    slot,
    exercise,
    sets,
    history,
    bar,
    firstDraft === undefined ? null : parseDecimal(firstDraft),
    extra,
  );
  const work = rows.filter((r) => !r.warmup);
  const doneWork = work.filter((r) => r.set).length;
  // The next row: the first still to do after the last one done (the first row if none is).
  const lastDone = rows.findLastIndex((r) => r.set);
  const next = rows.slice(lastDone + 1).find((r) => !r.set);
  const last = lastTime(history, exercise.id, measure);
  const foreign = rows.filter((r) => r.foreign);
  const canAdd = (rows.at(-1)?.position ?? 0) < MAX_POSITION;
  // The timed set counting down, and once over, what it fills in.
  const running = chrono !== null && Date.parse(chrono.endsAt) > now;
  const timedOut = chrono !== null && !running;

  const shown = (row: Row, field: "kg" | "count") => {
    const draft = drafts[row.position]?.[field];
    if (draft !== undefined) return draft;
    if (field === "count" && timedOut && chrono.position === row.position && !row.set)
      return String(chrono.seconds);
    const value = row.set ?? row.planned;
    if (!value) return "";
    if (field === "kg") return timed && value.weightKg === 0 ? "" : kgText(value.weightKg);
    return String(countOf(value));
  };
  const loadOf = (row: Row): Load | null => {
    const kgShown = shown(row, "kg");
    // A timed exercise may carry no added load: an empty cell is none.
    const kg = timed && kgShown.trim() === "" ? 0 : parseDecimal(kgShown);
    const count = parseCount(shown(row, "count"));
    if (kg === null || count === null || !isSetKg(kg)) return null;
    if (!(row.warmup || !timed ? isReps(count) : isSeconds(count))) return null;
    return loadIn(row.warmup ? "reps" : measure, kg, count);
  };
  const edit = (row: Row, field: "kg" | "count", text: string) =>
    setDrafts((d) => ({ ...d, [row.position]: { ...d[row.position], [field]: text } }));
  const clear = (row: Row) =>
    setDrafts((d) =>
      Object.fromEntries(
        Object.entries(d).filter(([position]) => Number(position) !== row.position),
      ),
    );
  // The RIR offered under the next work set: the low end of the target until the person picks.
  const rirOf = (row: Row) =>
    rirChoice?.position === row.position ? rirChoice.rir : slot.rirTarget[0];
  // Only a RIR the person saw under the set is logged; a timed set has none.
  const rirShown = (row: Row) => row === next && !row.warmup && !timed;

  const validate = async (row: Row) => {
    const load = loadOf(row);
    if (!load || busy) return;
    setBusy(true);
    try {
      await onValidate(row, load, rirShown(row) ? rirOf(row) : null);
      clear(row);
      setRirChoice(null);
    } finally {
      setBusy(false);
    }
  };
  // A done set is corrected by its cells, while the session is open (D13).
  const correct = async (row: Row) => {
    const load = loadOf(row);
    if (!row.set || !load) return clear(row);
    if (
      load.weightKg !== row.set.weightKg ||
      load.reps !== row.set.reps ||
      load.seconds !== (row.set.seconds ?? null)
    )
      await onCorrect(row.set, load);
    clear(row);
  };
  // The chrono counts down the next row's target (spec §4.3), from an end time.
  const target = next ? (parseCount(shown(next, "count")) ?? slot.repRange[0]) : slot.repRange[0];
  const startChrono = () =>
    next &&
    onChrono({
      slotIndex,
      position: next.position,
      seconds: target,
      endsAt: new Date(now + target * 1000).toISOString(),
    });
  const stopChrono = () =>
    chrono &&
    onChrono({
      ...chrono,
      seconds: Math.max(
        0,
        chrono.seconds - Math.ceil((Date.parse(chrono.endsAt) - Date.now()) / 1000),
      ),
      endsAt: new Date().toISOString(),
    });

  const tag = slot.rule ? t("session.addedNoClimbing") : slot.added ? t("session.added") : null;
  const targets = [formatSets(slot), ...(timed ? [] : [formatRir(slot, t)])];

  if (slot.skipped)
    return (
      <section
        aria-labelledby={id}
        className="flex items-center justify-between gap-3 rounded-card border border-border bg-card px-3 py-2"
      >
        <span className="flex min-w-0 flex-col">
          <h2 id={id} className="font-semibold text-muted-foreground">
            {exercise.name}
          </h2>
          <span className="text-[13px] text-muted-foreground">{t("session.leftOut")}</span>
        </span>
        {onSkip && (
          <button
            type="button"
            onClick={() => onSkip(false)}
            className="min-h-11 shrink-0 px-1 font-semibold text-primary"
          >
            {t("session.putBack")}
          </button>
        )}
      </section>
    );

  // Folded: what is done ("2 sets of 4"), or the target of an exercise not begun.
  const status = open
    ? null
    : doneWork === 0
      ? [t("session.upcoming", { target: formatSets(slot) }), ...(tag ? [tag] : [])].join(" · ")
      : t("session.doneCount", { count: doneWork, total: work.length });
  const action =
    "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-input bg-card px-2 text-[13px] font-semibold";

  return (
    <section
      aria-labelledby={id}
      className={`rounded-card border bg-card px-3 py-2 ${current ? "border-input" : "border-border"}`}
    >
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1">
          <button
            id={id}
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="flex min-h-12 w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex min-w-0 flex-col">
              <span className="font-semibold">{exercise.name}</span>
              <span className="text-[13px] font-normal text-muted-foreground">
                {status ??
                  [...targets, ...(group ? [group] : []), ...(tag ? [tag] : [])].join(" · ")}
              </span>
            </span>
            <ChevronDown
              aria-hidden
              className={`size-5 shrink-0 text-muted-foreground ${open ? "rotate-180" : ""}`}
            />
          </button>
        </h2>
        {onSkip && sets.length === 0 && (
          <button
            type="button"
            onClick={() => onSkip(true)}
            className="min-h-11 shrink-0 px-1 text-sm font-semibold text-primary"
          >
            {t("session.leaveOut")}
          </button>
        )}
      </div>
      {open && (
        <div className="flex flex-col pb-1">
          {last.length > 0 && (
            <p className="mb-1 text-[13px] text-muted-foreground">
              {t("session.lastTime", {
                value: last
                  .map((g) =>
                    timed
                      ? `${g.weightKg > 0 ? `${kgText(g.weightKg)} kg × ` : ""}${g.counts.join(", ")}\u00a0s`
                      : `${kgText(g.weightKg)} kg × ${g.counts.join(", ")}`,
                  )
                  .join(" · "),
              })}
            </p>
          )}
          {foreign.length > 0 && (
            <p className="mb-1 text-[13px] text-muted-foreground">
              {t("session.doneWith", {
                count: foreign.length,
                exercise: exerciseById(foreign[0]!.set!.exerciseId)?.name,
              })}
            </p>
          )}
          <div
            aria-hidden
            className="grid grid-cols-[3rem_1fr_1fr_2.75rem] gap-2 px-0.5 pb-1 text-[11px] font-semibold text-muted-foreground"
          >
            <span>{t("session.set")}</span>
            <span className="text-center">kg</span>
            <span className="text-center">{t(timed ? "session.seconds" : "session.reps")}</span>
          </div>
          {rows.map((row) => {
            const isNext = current && row === next;
            const touched = drafts[row.position] !== undefined;
            const cell = row.set
              ? "border-transparent bg-background font-bold"
              : touched
                ? "border-input font-bold"
                : "border-dashed border-input font-medium text-muted-foreground";
            const label = (key: string) =>
              t(`session.${row.warmup ? "warmupField" : "setField"}.${key}`, { n: row.n });
            const countKey = row.warmup || !timed ? "reps" : "seconds";
            return (
              <div key={row.position}>
                <div
                  className={`grid min-h-12 grid-cols-[3rem_1fr_1fr_2.75rem] items-center gap-2 border-t border-border ${
                    isNext ? "-mx-3 bg-primary-soft px-3" : ""
                  }`}
                >
                  <span
                    className={
                      row.warmup
                        ? "text-[11px] leading-tight font-semibold text-primary-ink"
                        : "text-center text-[13px] font-bold text-muted-foreground"
                    }
                  >
                    {row.warmup ? t("session.warmup") : row.n}
                  </span>
                  {row.foreign ? (
                    <>
                      <span className="text-center tabular-nums">{kgText(row.set!.weightKg)}</span>
                      <span className="text-center tabular-nums">
                        {row.set!.seconds != null ? `${row.set!.seconds}\u00a0s` : row.set!.reps}
                      </span>
                    </>
                  ) : (
                    (["kg", "count"] as const).map((field) => (
                      <input
                        key={field}
                        type="text"
                        inputMode={field === "kg" ? "decimal" : "numeric"}
                        aria-label={label(field === "kg" ? "kg" : countKey)}
                        placeholder={field === "kg" && timed ? "—" : undefined}
                        value={shown(row, field)}
                        onChange={(e) => edit(row, field, e.target.value)}
                        onBlur={() => row.set && void correct(row)}
                        className={`h-10 w-full min-w-0 rounded-[10px] border text-center text-[15px] tabular-nums ${cell}`}
                      />
                    ))
                  )}
                  {row.set ? (
                    <span
                      className="grid size-11 place-items-center rounded-[12px] bg-primary text-primary-foreground"
                      role="img"
                      aria-label={label("done")}
                    >
                      <Check aria-hidden className="size-5" strokeWidth={3} />
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={label("validate")}
                      disabled={!loadOf(row) || busy}
                      onClick={() => void validate(row)}
                      className="grid size-11 place-items-center rounded-[12px] border-2 border-input text-muted-foreground disabled:opacity-40"
                    >
                      <Check aria-hidden className="size-5" strokeWidth={3} />
                    </button>
                  )}
                </div>
                {rirShown(row) && (
                  <RirRow
                    value={rirOf(row)}
                    onChange={(rir) => setRirChoice({ position: row.position, rir })}
                  />
                )}
              </div>
            );
          })}
          {timed && next && (
            <ChronoControl
              running={running}
              over={timedOut}
              left={chrono ? Date.parse(chrono.endsAt) - now : 0}
              target={target}
              onStart={startChrono}
              onStop={stopChrono}
              className={action}
            />
          )}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={onReplace} className={action}>
              <ArrowLeftRight aria-hidden className="size-4" />
              {t("session.replace")}
            </button>
            <button
              type="button"
              disabled={!canAdd}
              onClick={() => setExtra((n) => n + 1)}
              className={`${action} disabled:opacity-40`}
            >
              {t("session.addSet")}
            </button>
          </div>
          <NoteField
            exercise={exercise.name}
            note={note}
            open={noteOpen}
            onOpen={() => setNoteOpen(true)}
            onSave={onNote}
            slotIndex={slotIndex}
          />
        </div>
      )}
    </section>
  );
}

// ▶ Chrono: counts the target down from an end time (right after a reload), then fills the
// seconds in; ✓ logs them. At zero: a short vibration and a polite announcement, as the rest.
function ChronoControl({
  running,
  over,
  left,
  target,
  onStart,
  onStop,
  className,
}: {
  running: boolean;
  over: boolean;
  left: number;
  target: number;
  onStart: () => void;
  onStop: () => void;
  className: string;
}) {
  const { t } = useTranslation();
  const [announced, setAnnounced] = useState(false);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (running) {
      wasRunning.current = true;
      setAnnounced(false);
    } else if (over && wasRunning.current) {
      wasRunning.current = false;
      navigator.vibrate?.(200);
      setAnnounced(true);
    }
  }, [running, over]);
  return (
    <div className="mt-2 flex items-center gap-2">
      <p role="status" className="sr-only">
        {announced ? t("session.chronoOver") : ""}
      </p>
      {running ? (
        <>
          <span
            role="timer"
            aria-live="off"
            aria-label={t("session.chronoLabel")}
            className="flex-1 text-center text-xl font-extrabold tabular-nums"
          >
            {formatClock(left)}
          </span>
          <button type="button" onClick={onStop} className={className}>
            {t("session.chronoStop")}
          </button>
        </>
      ) : (
        <button type="button" onClick={onStart} className={className}>
          <Play aria-hidden className="size-4" />
          {t("session.chrono", { time: formatClock(target * 1000) })}
        </button>
      )}
    </div>
  );
}

// D6: optional, one tap, under the set to do; tapping the chosen value empties it.
function RirRow({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (rir: number | null) => void;
}) {
  const { t } = useTranslation();
  const item =
    "grid h-11 min-w-11 flex-1 place-items-center rounded-[10px] border border-input bg-card text-[13px] font-semibold data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background";
  return (
    <div className="-mx-3 flex items-center gap-1 bg-primary-soft px-3 pb-2">
      <span aria-hidden className="w-12 shrink-0 text-[11px] font-semibold text-muted-foreground">
        RIR
      </span>
      <RadioGroup.Root
        aria-label={t("session.rirLabel")}
        orientation="horizontal"
        value={value === null ? "" : String(value)}
        onValueChange={(v) => onChange(Number(v))}
        className="flex flex-1 gap-1"
      >
        {[0, 1, 2, 3, 4].map((v) => (
          <RadioGroup.Item
            key={v}
            value={String(v)}
            onClick={() => value === v && onChange(null)}
            className={item}
          >
            {v === 4 ? "4+" : v}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  );
}

function NoteField({
  exercise,
  note,
  open,
  onOpen,
  onSave,
  slotIndex,
}: {
  exercise: string;
  note: string;
  open: boolean;
  onOpen: () => void;
  onSave: (text: string) => void;
  slotIndex: number;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(note);
  if (!open)
    return (
      <button
        type="button"
        onClick={onOpen}
        className="-ml-1 min-h-11 self-start px-1 text-sm font-semibold text-primary"
      >
        {t("session.note")}
      </button>
    );
  return (
    <label
      className="mt-2 flex flex-col gap-1 text-[13px] font-semibold"
      htmlFor={`note-${slotIndex}`}
    >
      {t("session.noteLabel", { exercise })}
      <textarea
        id={`note-${slotIndex}`}
        value={text}
        maxLength={500}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== note && onSave(text.trim())}
        className="rounded-field border border-input bg-card px-3 py-2 text-base font-normal"
      />
    </label>
  );
}
