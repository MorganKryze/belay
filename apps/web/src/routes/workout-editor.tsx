import "@/i18n/lazy";
import { newId } from "@belay/shared";
import type { ISODate } from "@belay/shared/body/dates";
import { exerciseById } from "@belay/shared/exercises/catalog";
import type { Exercise } from "@belay/shared/exercises/library";
import { appendSlot, planFor } from "@belay/shared/training/plan";
import { sessionByCode } from "@belay/shared/training/program";
import { type History, liveSets } from "@belay/shared/training/rules";
import { MAX_SLOTS, MAX_WARMUPS, type Slot, type Workout } from "@belay/shared/training/workout";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, X } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { DayChip } from "@/components/day-chip";
import { Button } from "@/components/ui/button";
import { formatNumber, sessionTitle } from "@/lib/format";
import { useToday } from "@/lib/today";
import { type OpenAccount, useAccount, useActivities, useHistory, useRecord } from "@/sync/account";
import { addRow, editChanges, type EditRow, rowsOf } from "@/workouts/editor";
import { ExercisePicker } from "@/workouts/exercise-picker";
import { formatSets } from "@/workouts/format";
import { dayOf } from "@/workouts/history-panel";
import { NotFound } from "./fallbacks";

const back = "-ml-1 inline-flex min-h-11 items-center gap-0.5 self-start font-medium text-primary";
const card = "rounded-card border border-border bg-card";

// The editor (spec §4.4): a finished session corrected (?id=), or one logged afterwards (?code=,
// ?date=, ?minutes=). No timer, no rest; nothing is written until Save, and Cancel writes nothing.
export function WorkoutEditor() {
  const account = useAccount();
  if (account.kind === "loading") return null;
  if (account.kind !== "open") return <NotFound />;
  return <Load account={account} />;
}

function Load({ account }: { account: OpenAccount }) {
  const search = useSearch({ from: "/workout/edit" });
  const today = useToday();
  const history = useHistory(account).data;
  const activities = useActivities(account).data;
  if (!history || !activities) return null;
  if (search.id) {
    const workout = history.workouts.find((w) => w.id === search.id);
    if (!workout || workout.removed || workout.endedAt === null) return <NotFound />;
    return <Editor account={account} history={history} workout={workout} start={null} />;
  }
  const session = search.code ? sessionByCode(search.code) : undefined;
  if (!session || !search.date || search.date > today || !search.minutes) return <NotFound />;
  return (
    <Editor
      account={account}
      history={history}
      workout={null}
      start={{
        code: session.code,
        date: search.date,
        minutes: search.minutes,
        plan: planFor(session, activities, search.date),
      }}
    />
  );
}

function Editor({
  account,
  history,
  workout,
  start,
}: {
  account: OpenAccount;
  history: History;
  workout: Workout | null;
  start: { code: string; date: ISODate; minutes: number; plan: Slot[] } | null;
}) {
  const { t, i18n } = useTranslation();
  const today = useToday();
  const navigate = useNavigate();
  const record = useRecord(account);
  const kgText = (kg: number) => formatNumber(kg, i18n.language, { digits: 2, grouping: false });
  const [id] = useState(() => workout?.id ?? newId());
  const [date, setDate] = useState<ISODate>(workout ? dayOf(workout) : start!.date);
  const [plan, setPlan] = useState<Slot[]>(() => [...(workout?.plan ?? start!.plan)]);
  const [rows, setRows] = useState<EditRow[]>(() =>
    workout
      ? rowsOf(
          liveSets(history).filter((s) => s.workoutId === workout.id),
          kgText,
        )
      : [],
  );
  const [opened, setOpened] = useState<ReadonlySet<number>>(
    () => new Set(rows.map((r) => r.slotIndex)),
  );
  const [picking, setPicking] = useState(false);
  // A picked exercise is in the plan behind while the picker plays its exit.
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string>();
  const sessionCode = workout?.sessionCode ?? start!.code;
  const changes = editChanges({
    id,
    workout,
    sessionCode,
    plan,
    date,
    minutes: start?.minutes ?? 0,
    rows,
    now: new Date(),
  });
  const leave = workout
    ? ({ to: "/workouts/$workoutId", params: { workoutId: workout.id } } as const)
    : ({ to: "/workouts", search: { tab: "history" } } as const);

  const update = (rowId: string, patch: Partial<EditRow>) =>
    setRows((rs) => rs.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  const remove = (row: EditRow) =>
    setRows((rs) =>
      row.set
        ? rs.map((r) => (r.id === row.id ? { ...r, removed: true } : r))
        : rs.filter((r) => r.id !== row.id),
    );
  const add = (slotIndex: number) => {
    const row = addRow(rows, slotIndex, plan[slotIndex]!, history, newId(), kgText);
    if (row) setRows((rs) => [...rs, row]);
  };
  const pick = (exercise: Exercise) => {
    if (leaving) return;
    setPlan(appendSlot(plan, exercise));
    setOpened((o) => new Set(o).add(plan.length));
    setLeaving(true);
  };
  const save = async () => {
    // The clock now: Save may come long after the screen was drawn.
    const written = editChanges({
      id,
      workout,
      sessionCode,
      plan,
      date,
      minutes: start?.minutes ?? 0,
      rows,
      now: new Date(),
    });
    if (!written) return;
    try {
      if (written.length > 0) await record(written);
      await navigate({ to: "/workouts/$workoutId", params: { workoutId: id }, replace: true });
    } catch {
      setError(t("weighIn.saveFailed"));
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link {...leave} className={back}>
          <ChevronLeft aria-hidden className="size-5" />
          {t("editor.cancel")}
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 flex-1 text-[22px] leading-tight font-bold tracking-tight">
            {sessionTitle(sessionCode, t)}
          </h1>
          <DayChip date={date} today={today} onChange={setDate} label={t("editor.date")} />
        </div>
        <p className="text-sm text-muted-foreground">{t("editor.note")}</p>
      </div>
      {plan.map((slot, i) => {
        const exercise = exerciseById(slot.exerciseId);
        if (!exercise) return null;
        return (
          <EditorSlot
            key={i}
            slot={slot}
            exercise={exercise}
            rows={rows.filter((r) => r.slotIndex === i && !r.removed)}
            open={opened.has(i)}
            onToggle={() =>
              setOpened((o) => {
                const next = new Set(o);
                if (next.has(i)) next.delete(i);
                else next.add(i);
                return next;
              })
            }
            onEdit={update}
            onRemove={remove}
            onAdd={() => add(i)}
          />
        );
      })}
      <Button
        variant="secondary"
        className="w-full"
        disabled={plan.length >= MAX_SLOTS}
        onClick={() => setPicking(true)}
      >
        {t("session.addExercise")}
      </Button>
      <Button className="w-full" disabled={changes === null} onClick={() => void save()}>
        {t("editor.save")}
      </Button>
      {changes === null && (
        <p className="text-sm text-muted-foreground">{t("editor.incomplete")}</p>
      )}
      {error && <p role="alert">{error}</p>}
      {picking && (
        <ExercisePicker
          replacing={null}
          history={history}
          onPick={pick}
          open={!leaving}
          onClose={() => {
            setPicking(false);
            setLeaving(false);
          }}
        />
      )}
    </section>
  );
}

function EditorSlot({
  slot,
  exercise,
  rows,
  open,
  onToggle,
  onEdit,
  onRemove,
  onAdd,
}: {
  slot: Slot;
  exercise: Exercise;
  rows: EditRow[];
  open: boolean;
  onToggle: () => void;
  onEdit: (id: string, patch: Partial<EditRow>) => void;
  onRemove: (row: EditRow) => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const timed = slot.measure === "seconds";
  const work = rows.filter((r) => !r.warmup);
  const grid = timed
    ? "grid-cols-[2.5rem_1fr_1fr_2.75rem]"
    : "grid-cols-[2.5rem_1fr_1fr_3.25rem_2.75rem]";
  const foreign = rows.filter((r) => r.exerciseId !== exercise.id);
  return (
    <section aria-labelledby={id} className={`${card} px-3 py-2`}>
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
              {work.length > 0 ? t("history.workSets", { count: work.length }) : formatSets(slot)}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className={`size-5 shrink-0 text-muted-foreground ${open ? "rotate-180" : ""}`}
          />
        </button>
      </h2>
      {open && (
        <div className="flex flex-col pb-2">
          {foreign.length > 0 && (
            <p className="mb-1 text-[13px] text-muted-foreground">
              {t("session.doneWith", {
                count: foreign.length,
                exercise: exerciseById(foreign[0]!.exerciseId)?.name,
              })}
            </p>
          )}
          {rows.length > 0 && (
            <div
              aria-hidden
              className={`grid ${grid} gap-2 px-0.5 pb-1 text-[11px] font-semibold text-muted-foreground`}
            >
              <span>{t("session.set")}</span>
              <span className="text-center">kg</span>
              <span className="text-center">{t(timed ? "session.seconds" : "session.reps")}</span>
              {!timed && <span className="text-center">RIR</span>}
            </div>
          )}
          {rows.map((row) => {
            const n = row.warmup ? row.position + 1 : row.position - MAX_WARMUPS + 1;
            const label = (key: string) =>
              t(`session.${row.warmup ? "warmupField" : "setField"}.${key}`, { n });
            const input =
              "h-11 w-full min-w-0 rounded-[10px] border border-input bg-card text-center text-base font-semibold tabular-nums";
            return (
              <div
                key={row.id}
                className={`grid min-h-12 ${grid} items-center gap-2 border-t border-border`}
              >
                <span
                  className={
                    row.warmup
                      ? "text-[11px] leading-tight font-semibold text-primary-ink"
                      : "text-center text-[13px] font-bold text-muted-foreground"
                  }
                >
                  {row.warmup ? t("session.warmup") : n}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={label("kg")}
                  placeholder={timed ? "—" : undefined}
                  value={row.kg}
                  onChange={(e) => onEdit(row.id, { kg: e.target.value })}
                  className={input}
                />
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={label(row.measure === "seconds" ? "seconds" : "reps")}
                  value={row.count}
                  onChange={(e) => onEdit(row.id, { count: e.target.value })}
                  className={input}
                />
                {!timed && (
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label={t("editor.rir", { n })}
                    disabled={row.warmup}
                    value={row.rir}
                    onChange={(e) => onEdit(row.id, { rir: e.target.value })}
                    className={`${input} disabled:opacity-40`}
                  />
                )}
                <button
                  type="button"
                  aria-label={t(row.warmup ? "editor.removeWarmup" : "editor.removeSet", { n })}
                  onClick={() => onRemove(row)}
                  className="grid size-11 place-items-center rounded-[12px] text-muted-foreground"
                >
                  <X aria-hidden className="size-5" />
                </button>
              </div>
            );
          })}
          <Button variant="secondary" className="mt-2 w-full" onClick={onAdd}>
            {t("session.addSet")}
          </Button>
        </div>
      )}
    </section>
  );
}
