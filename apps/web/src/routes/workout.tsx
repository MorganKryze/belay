import "@/i18n/lazy";
import { newId } from "@belay/shared";
import { toISODate } from "@belay/shared/body/dates";
import { exerciseById } from "@belay/shared/exercises/catalog";
import type { Exercise } from "@belay/shared/exercises/library";
import { appendSlot, planFor, replaceSlot, skipSlot } from "@belay/shared/training/plan";
import { groupOf, sessionByCode } from "@belay/shared/training/program";
import {
  type History,
  liveSets,
  type Load,
  nextTurn,
  restEndsAt,
  sessionProgress,
  type Turn,
  turnKey,
} from "@belay/shared/training/rules";
import {
  MAX_SLOTS,
  MAX_WARMUPS,
  type Slot,
  type Workout,
  type WorkoutSet,
} from "@belay/shared/training/workout";
import { Navigate, useNavigate, useSearch } from "@tanstack/react-router";
import { Timer } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sheet } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { sessionTitle } from "@/lib/format";
import { readToolState, resolveEquipment } from "@/lib/tool-storage";
import { type ActiveSession, readActiveSession, readActivities } from "@/sync/db";
import {
  type OpenAccount,
  useAccount,
  useRecord,
  useRecordSet,
  useSessionView,
  useStartWorkout,
} from "@/sync/account";
import { ExerciseCard, type Row } from "@/workouts/exercise-card";
import { ExercisePicker } from "@/workouts/exercise-picker";
import { groupKind } from "@/workouts/format";
import { formatClock, useNow, useWakeLock } from "@/workouts/hooks";
import { RestBar } from "@/workouts/rest-bar";

// The session screen (§4.2): full screen, no tab bar, the screen kept on.
export function WorkoutScreen() {
  const account = useAccount();
  if (account.kind === "loading") return null;
  if (account.kind !== "open") return <Navigate to="/workouts" search={{ tab: "program" }} />;
  return <Session account={account} />;
}

function Session({ account }: { account: OpenAccount }) {
  const { t } = useTranslation();
  const { start } = useSearch({ from: "/workout" });
  const navigate = useNavigate();
  const startWorkout = useStartWorkout(account);
  const record = useRecord(account);
  const view = useSessionView(account).data;
  const started = useRef(false);
  // While the end is written, the screen neither redirects nor shows a session already over.
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState<string>();
  useWakeLock();

  // ?start=B: start session B (or take up the one already open), then drop the parameter so a
  // reload never starts another. Session C's rule reads the week's activities now, once (D6).
  useEffect(() => {
    if (!start || started.current) return;
    started.current = true;
    const session = sessionByCode(start);
    const go = () => void navigate({ to: "/workout", search: {}, replace: true });
    if (!session) return go();
    void readActivities(account.db)
      .then((activities) =>
        startWorkout(newId(), session.code, planFor(session, activities, toISODate(new Date()))),
      )
      .then(go, go);
  }, [start, navigate, startWorkout, account.db]);

  // A session with no set at all is not kept; otherwise it ends now and its summary opens.
  const finish = async (workout: Workout, empty: boolean) => {
    const at = new Date().toISOString();
    setLeaving(true);
    try {
      await record(
        empty
          ? { kind: "workout", id: workout.id, field: "removed", value: true, at }
          : { kind: "workout", id: workout.id, field: "ended", value: at, at },
        { active: null },
      );
      await navigate(
        empty
          ? { to: "/" }
          : { to: "/workout/summary/$workoutId", params: { workoutId: workout.id }, replace: true },
      );
    } catch {
      setLeaving(false);
      setFailed(t("weighIn.saveFailed"));
    }
  };

  if (start || leaving || !view) return null;
  const { active, history } = view;
  const workout = active && history.workouts.find((w) => w.id === active.workoutId);
  if (!active || !workout || workout.endedAt !== null || workout.removed)
    return <Navigate to="/workouts" search={{ tab: "program" }} />;
  return (
    <Screen
      account={account}
      active={active}
      workout={workout}
      history={history}
      failed={failed}
      onFinish={(empty) => void finish(workout, empty)}
    />
  );
}

function Screen({
  account,
  active,
  workout,
  history,
  failed,
  onFinish,
}: {
  account: OpenAccount;
  active: ActiveSession;
  workout: Workout;
  history: History;
  failed: string | undefined;
  onFinish: (empty: boolean) => void;
}) {
  const { t } = useTranslation();
  const record = useRecord(account);
  const recordSet = useRecordSet(account);
  const now = useNow();
  const [toggled, setToggled] = useState<ReadonlyMap<number, boolean>>(new Map());
  const [finishing, setFinishing] = useState(false);
  // The exercise picker: for a slot to replace, or for one added at the end.
  const [picking, setPicking] = useState<{ slotIndex: number } | "add" | null>(null);
  // A picked exercise is in the plan behind while the picker plays its exit.
  const [leaving, setLeaving] = useState(false);
  const [saveError, setError] = useState<string>();
  const error = saveError ?? failed;
  const plan = workout.plan;
  const sets = liveSets(history).filter((s) => s.workoutId === workout.id);
  // The planned work sets done (« + Série » past the plan aside), and what comes next.
  const { done, left, last: lastTurn, next } = sessionProgress(plan, sets);
  // The person's own bar and plates, from the Plates tool (D7).
  const bar = resolveEquipment(readToolState().equipment);

  const save = useCallback(
    async (write: () => Promise<void>) => {
      try {
        await write();
        setError(undefined);
      } catch {
        setError(t("weighIn.saveFailed"));
      }
    },
    [t],
  );
  const setActive = useCallback(
    (patch: Partial<ActiveSession>) =>
      void save(() => record([], { active: { ...active, ...patch } })),
    [active, record, save],
  );
  // The session's own copy of the plan (D7): the program never changes. Each edit is built from
  // the plan stored when its turn comes, edits one after the other, so quick taps compose.
  const edits = useRef<Promise<void>>(Promise.resolve());
  // `leaving` is a slot being left out: if it is the one up next, the open session moves on to
  // the next live turn in the same write.
  const editPlan = (edit: (stored: Slot[]) => Slot[], leaving?: number) => {
    edits.current = edits.current.then(() =>
      save(async () => {
        const stored = await account.db.get("workouts", workout.id);
        const before = stored?.plan ?? plan;
        const current = await readActiveSession(account.db);
        let moved: ActiveSession | undefined;
        if (leaving !== undefined && current?.slotIndex === leaving) {
          const gone = new Set(done);
          for (let round = 0; round < before[leaving]!.sets; round++)
            gone.add(turnKey({ slotIndex: leaving, round }));
          const next = nextTurn(before, gone, { slotIndex: leaving, round: 0 });
          if (next) moved = { ...current, slotIndex: next.slotIndex };
        }
        await record(
          {
            kind: "workout",
            id: workout.id,
            field: "plan",
            value: edit(before),
            at: new Date().toISOString(),
          },
          moved && { active: moved },
        );
      }),
    );
  };
  const pick = (exercise: Exercise) => {
    if (picking === null || leaving) return;
    const target = picking === "add" ? plan.length : picking.slotIndex;
    editPlan((stored) =>
      picking === "add" ? appendSlot(stored, exercise) : replaceSlot(stored, target, exercise),
    );
    setLeaving(true);
    setToggled((m) => new Map(m).set(target, true));
  };

  // ✓ (§4.2): the set as shown, the rest started, the next exercise opened.
  const validate = (slotIndex: number) => async (row: Row, load: Load, rir: number | null) => {
    const doneAt = new Date().toISOString();
    const turn: Turn | null = row.warmup ? null : { slotIndex, round: row.position - MAX_WARMUPS };
    const after = new Set(done);
    if (turn) after.add(turnKey(turn));
    const next = turn ? nextTurn(plan, after, turn) : null;
    // The chrono of this row is done with once its set is logged.
    const chrono =
      active.chrono?.slotIndex === slotIndex && active.chrono.position === row.position
        ? null
        : (active.chrono ?? null);
    await save(() =>
      recordSet(
        {
          id: newId(),
          workoutId: workout.id,
          slotIndex,
          position: row.position,
          exerciseId: plan[slotIndex]!.exerciseId,
          warmup: row.warmup,
          weightKg: load.weightKg,
          reps: load.reps,
          seconds: load.seconds,
          rir,
          doneAt,
        },
        {
          workoutId: workout.id,
          slotIndex: next?.slotIndex ?? slotIndex,
          chrono,
          restEndsAt: turn
            ? restEndsAt(plan, after, turn, doneAt)
            : // A warm-up starts no rest and leaves a running one alone, but not an expired one.
              active.restEndsAt && Date.parse(active.restEndsAt) > Date.parse(doneAt)
              ? active.restEndsAt
              : null,
        },
      ),
    );
    if (next && next.slotIndex !== slotIndex)
      setToggled((m) => new Map([...m].filter(([i]) => i !== slotIndex && i !== next.slotIndex)));
  };
  const correct = async (set: WorkoutSet, load: Load) =>
    save(() =>
      recordSet(
        {
          id: set.id,
          workoutId: workout.id,
          slotIndex: set.slotIndex,
          position: set.position,
          exerciseId: set.exerciseId,
          warmup: set.warmup,
          weightKg: load.weightKg,
          reps: load.reps,
          seconds: load.seconds,
          rir: set.rir,
          doneAt: set.doneAt,
        },
        active,
      ),
    );
  const saveNote = (slotIndex: number) => (text: string) => {
    // An emptied note leaves the block; the others stay.
    const notes: Record<string, string> = Object.fromEntries(
      Object.entries({ ...workout.exerciseNotes, [String(slotIndex)]: text }).filter(
        ([, v]) => v !== "",
      ),
    );
    void save(() =>
      record({
        kind: "workout",
        id: workout.id,
        field: "exerciseNotes",
        value: notes,
        at: new Date().toISOString(),
      }),
    );
  };

  // The rest bar names what comes next: the next set of this exercise, or the next exercise.
  const restLabel =
    next === null
      ? t("session.restLast")
      : lastTurn && next.slotIndex === lastTurn.slotIndex
        ? t("session.restNextSet", { n: next.round + 1 })
        : t("session.restNextExercise", {
            exercise: exerciseById(plan[next.slotIndex]!.exerciseId)?.name,
          });
  const groupLabel = (slotIndex: number) => {
    const kind = groupKind(plan, slotIndex);
    if (!kind) return null;
    const group = groupOf(plan, slotIndex);
    const rounds = Math.max(...group.map((g) => plan[g]!.sets));
    const round = Array.from({ length: rounds }, (_, r) => r).find((r) =>
      group.some((g) => r < plan[g]!.sets && !done.has(turnKey({ slotIndex: g, round: r }))),
    );
    return t("session.group", {
      kind: t(`session.${kind}`),
      round: (round ?? rounds - 1) + 1,
      rounds,
    });
  };

  return (
    <section className="flex flex-col gap-3 pb-28">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-bold tabular-nums">
          <Timer aria-hidden className="size-4" />
          <span className="sr-only">{t("session.elapsed")}</span>
          {formatClock(now - Date.parse(workout.startedAt), Math.floor)}
        </span>
        <Button
          variant="secondary"
          onClick={() => (left > 0 ? setFinishing(true) : onFinish(sets.length === 0))}
        >
          {t("session.finish")}
        </Button>
      </div>
      <h1 className="text-[22px] leading-tight font-bold tracking-tight">
        {sessionTitle(workout.sessionCode, t)}
      </h1>
      {plan.some((s) => s.rule === "no_climbing") && (
        <p className="rounded-[12px] bg-primary-soft px-3 py-2.5 text-sm text-primary-ink">
          {t("session.noClimbing")}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-chip bg-track p-3 text-sm">
          {error}
        </p>
      )}
      {plan.map((slot, i) => {
        const exercise = exerciseById(slot.exerciseId);
        if (!exercise) return null;
        // The card holding a running chrono stays open, after a reload too.
        const open = toggled.get(i) ?? (i === active.slotIndex || active.chrono?.slotIndex === i);
        const own = sets.filter((s) => s.slotIndex === i);
        return (
          <ExerciseCard
            key={i}
            slot={slot}
            slotIndex={i}
            exercise={exercise}
            sets={own}
            history={history}
            bar={bar}
            open={open}
            current={i === active.slotIndex}
            group={groupLabel(i)}
            note={workout.exerciseNotes[String(i)] ?? ""}
            chrono={active.chrono?.slotIndex === i ? active.chrono : null}
            now={now}
            onToggle={() => setToggled((m) => new Map(m).set(i, !open))}
            onValidate={validate(i)}
            onCorrect={correct}
            onNote={saveNote(i)}
            onReplace={() => setPicking({ slotIndex: i })}
            onSkip={
              (slot.rule || slot.added) && own.length === 0
                ? (skipped) =>
                    editPlan((stored) => skipSlot(stored, i, skipped), skipped ? i : undefined)
                : null
            }
            onChrono={(chrono) => setActive({ chrono })}
          />
        );
      })}
      <Button
        variant="secondary"
        className="w-full"
        disabled={plan.length >= MAX_SLOTS}
        onClick={() => setPicking("add")}
      >
        {t("session.addExercise")}
      </Button>
      {picking !== null && (
        <ExercisePicker
          replacing={
            picking === "add" ? null : (exerciseById(plan[picking.slotIndex]!.exerciseId) ?? null)
          }
          history={history}
          onPick={pick}
          open={!leaving}
          onClose={() => {
            setPicking(null);
            setLeaving(false);
          }}
        />
      )}
      {active.restEndsAt && (
        <RestBar
          endsAt={active.restEndsAt}
          next={restLabel}
          onChange={(restEndsAt) => setActive({ restEndsAt })}
        />
      )}
      {finishing && (
        <Sheet title={t("session.finishTitle")} onClose={() => setFinishing(false)}>
          <p>
            {sets.length === 0
              ? t("session.finishEmpty")
              : t("session.finishLeft", { count: left })}
          </p>
          <div className="flex flex-col gap-2">
            <Button className="w-full" onClick={() => onFinish(sets.length === 0)}>
              {t("session.finish")}
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => setFinishing(false)}>
              {t("session.keepGoing")}
            </Button>
          </div>
        </Sheet>
      )}
    </section>
  );
}
