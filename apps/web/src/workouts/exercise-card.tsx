import type { Exercise } from "@belay/shared/exercises/library";
import { type History, lastTime, type Load, prefill, warmups } from "@belay/shared/training/rules";
import {
  isReps,
  isSetKg,
  MAX_WARMUPS,
  type Slot,
  type WorkoutSet,
  workPosition,
} from "@belay/shared/training/workout";
import { Check, ChevronDown } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber, parseDecimal } from "@/lib/format";
import { formatRir, formatSets } from "./format";

// One line of the table: a warm-up (positions 0 to 2) or a work set, done or still to do.
export type Row = {
  position: number;
  warmup: boolean;
  n: number; // as shown: warm-up 1, 2… or set 1, 2…
  set: WorkoutSet | undefined;
  planned: Load | null; // what is prefilled when nothing is done yet
};

const parseReps = (text: string): number | null => (/^\s*\d+\s*$/.test(text) ? Number(text) : null);

// The rows of a slot: the warm-ups computed from the first work set's load (D7), then the work
// sets, each prefilled from last time (§7), else from the set just done before it in this
// session. A row already done keeps what was done.
export function rowsOf(
  slot: Slot,
  exercise: Exercise,
  sets: readonly WorkoutSet[],
  history: History,
  bar: { barKg: number; platesKg: readonly number[] },
  firstKg: number | null,
): Row[] {
  const at = (position: number) => sets.find((s) => s.position === position);
  const before = (k: number) =>
    sets
      .filter((s) => !s.warmup && s.position < workPosition(k))
      .sort((a, b) => b.position - a.position)[0];
  const work: Row[] = Array.from({ length: slot.sets }, (_, k) => {
    const last = prefill(history, exercise.id, k) ?? before(k);
    return {
      position: workPosition(k),
      warmup: false,
      n: k + 1,
      set: at(workPosition(k)),
      // Nothing at all yet: a bodyweight exercise starts with no added load.
      planned: last
        ? { weightKg: last.weightKg, reps: last.reps }
        : exercise.equipment === "bodyweight"
          ? { weightKg: 0, reps: slot.repRange[0] }
          : null,
    };
  });
  const workKg = firstKg ?? work[0]!.set?.weightKg ?? work[0]!.planned?.weightKg ?? null;
  const computed = warmups(slot, workKg, exercise, bar);
  const doneWarmups = sets.filter((s) => s.warmup).map((s) => s.position + 1);
  const count = Math.min(MAX_WARMUPS, Math.max(computed.length, ...doneWarmups, 0));
  const warm: Row[] = Array.from({ length: count }, (_, j) => ({
    position: j,
    warmup: true,
    n: j + 1,
    set: at(j),
    planned: computed[j] ?? null,
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
  onToggle,
  onValidate,
  onCorrect,
  onNote,
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
  onToggle: () => void;
  onValidate: (row: Row, load: Load, rir: number | null) => Promise<void>;
  onCorrect: (set: WorkoutSet, load: Load) => Promise<void>;
  onNote: (text: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [drafts, setDrafts] = useState<Record<number, { kg?: string; reps?: string }>>({});
  const [rirChoice, setRirChoice] = useState<{ position: number; rir: number | null } | null>(null);
  const [noteOpen, setNoteOpen] = useState(note !== "");
  const [busy, setBusy] = useState(false);
  const kgText = (kg: number) => formatNumber(kg, i18n.language, { digits: 2, grouping: false });

  const firstWork = workPosition(0);
  const firstDraft = drafts[firstWork]?.kg;
  const rows = rowsOf(
    slot,
    exercise,
    sets,
    history,
    bar,
    firstDraft === undefined ? null : parseDecimal(firstDraft),
  );
  const work = rows.filter((r) => !r.warmup);
  const doneWork = work.filter((r) => r.set).length;
  // The next row: the first still to do after the last one done (the first row if none is).
  const lastDone = rows.findLastIndex((r) => r.set);
  const next = rows.slice(lastDone + 1).find((r) => !r.set);
  const last = lastTime(history, exercise.id);

  const shown = (row: Row, field: "kg" | "reps") => {
    const draft = drafts[row.position]?.[field];
    if (draft !== undefined) return draft;
    const value = row.set ?? row.planned;
    if (!value) return "";
    return field === "kg" ? kgText(value.weightKg) : String(value.reps);
  };
  const loadOf = (row: Row): Load | null => {
    const kg = parseDecimal(shown(row, "kg"));
    const reps = parseReps(shown(row, "reps"));
    return kg !== null && reps !== null && isSetKg(kg) && isReps(reps)
      ? { weightKg: kg, reps }
      : null;
  };
  const edit = (row: Row, field: "kg" | "reps", text: string) =>
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
  // Only a RIR the person saw under the set is logged.
  const rirShown = (row: Row) => row === next && !row.warmup;

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
    if (load.weightKg !== row.set.weightKg || load.reps !== row.set.reps)
      await onCorrect(row.set, load);
    clear(row);
  };

  // Folded: what is done ("2 sets of 4"), or the target of an exercise not begun.
  const status = open
    ? null
    : doneWork === 0
      ? t("session.upcoming", { target: formatSets(slot) })
      : t("session.doneCount", { count: doneWork, total: work.length });

  return (
    <section
      aria-labelledby={id}
      className={`rounded-card border bg-card px-3 py-2 ${current ? "border-input" : "border-border"}`}
    >
      <h2>
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
                [formatSets(slot), formatRir(slot, t), ...(group ? [group] : [])].join(" · ")}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className={`size-5 shrink-0 text-muted-foreground ${open ? "rotate-180" : ""}`}
          />
        </button>
      </h2>
      {open && (
        <div className="flex flex-col pb-1">
          {last.length > 0 && (
            <p className="mb-1 text-[13px] text-muted-foreground">
              {t("session.lastTime", {
                value: last
                  .map((g) => `${kgText(g.weightKg)} kg × ${g.reps.join(", ")}`)
                  .join(" · "),
              })}
            </p>
          )}
          <div
            aria-hidden
            className="grid grid-cols-[3rem_1fr_1fr_2.75rem] gap-2 px-0.5 pb-1 text-[11px] font-semibold text-muted-foreground"
          >
            <span>{t("session.set")}</span>
            <span className="text-center">kg</span>
            <span className="text-center">{t("session.reps")}</span>
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
                  {(["kg", "reps"] as const).map((field) => (
                    <input
                      key={field}
                      type="text"
                      inputMode={field === "kg" ? "decimal" : "numeric"}
                      aria-label={label(field)}
                      value={shown(row, field)}
                      onChange={(e) => edit(row, field, e.target.value)}
                      onBlur={() => row.set && void correct(row)}
                      className={`h-10 w-full min-w-0 rounded-[10px] border text-center text-[15px] tabular-nums ${cell}`}
                    />
                  ))}
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
