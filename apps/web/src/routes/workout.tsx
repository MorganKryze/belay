import "@/i18n/lazy";
import { newId } from "@belay/shared";
import { exerciseById } from "@belay/shared/exercises/catalog";
import { groupOf, plannedWorkSets, sessionByCode } from "@belay/shared/training/program";
import {
  type History,
  liveSets,
  type Load,
  nextTurn,
  restEndsAt,
  type Turn,
  turnKey,
  turnOf,
} from "@belay/shared/training/rules";
import { MAX_WARMUPS, type Workout, type WorkoutSet } from "@belay/shared/training/workout";
import { Navigate, useNavigate, useSearch } from "@tanstack/react-router";
import { Timer } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sheet } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { sessionTitle } from "@/lib/format";
import { readToolState, resolveEquipment } from "@/lib/tool-storage";
import type { ActiveSession } from "@/sync/db";
import {
  type OpenAccount,
  useAccount,
  useActiveSession,
  useHistory,
  useRecord,
  useRecordSet,
  useStartWorkout,
} from "@/sync/account";
import { ExerciseCard, type Row } from "@/workouts/exercise-card";
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
  const active = useActiveSession(account);
  const history = useHistory(account);
  const started = useRef(false);
  // While the end is written, the screen neither redirects nor shows a session already over.
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState<string>();
  useWakeLock();

  // ?start=B: start session B (or take up the one already open), then drop the parameter so a
  // reload never starts another.
  useEffect(() => {
    if (!start || started.current) return;
    started.current = true;
    const session = sessionByCode(start);
    const go = () => void navigate({ to: "/workout", search: {}, replace: true });
    if (!session) return go();
    void startWorkout(newId(), session.code, [...session.slots]).then(go, go);
  }, [start, navigate, startWorkout]);

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

  if (start || leaving || active.isPending || !history.data) return null;
  const workout = active.data && history.data.workouts.find((w) => w.id === active.data!.workoutId);
  if (!active.data || !workout || workout.endedAt !== null || workout.removed)
    return <Navigate to="/workouts" search={{ tab: "program" }} />;
  return (
    <Screen
      account={account}
      active={active.data}
      workout={workout}
      history={history.data}
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
  const [saveError, setError] = useState<string>();
  const error = saveError ?? failed;
  const plan = workout.plan;
  const sets = liveSets(history).filter((s) => s.workoutId === workout.id);
  const work = sets.filter((s) => !s.warmup && s.position - MAX_WARMUPS < plan[s.slotIndex]!.sets);
  const done = new Set(work.map((s) => turnKey(turnOf(s))));
  const left = plannedWorkSets(plan) - done.size;
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

  // ✓ (§4.2): the set as shown, the rest started, the next exercise opened.
  const validate = (slotIndex: number) => async (row: Row, load: Load, rir: number | null) => {
    const doneAt = new Date().toISOString();
    const turn: Turn | null = row.warmup ? null : { slotIndex, round: row.position - MAX_WARMUPS };
    const after = new Set(done);
    if (turn) after.add(turnKey(turn));
    const next = turn ? nextTurn(plan, after, turn) : null;
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
          rir,
          doneAt,
        },
        {
          workoutId: workout.id,
          slotIndex: next?.slotIndex ?? slotIndex,
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
  const lastTurn = work.length
    ? turnOf([...work].sort((a, b) => (a.doneAt < b.doneAt ? -1 : 1)).at(-1)!)
    : undefined;
  const next = nextTurn(plan, done, lastTurn);
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
          variant="outline"
          onClick={() => (left > 0 ? setFinishing(true) : onFinish(sets.length === 0))}
        >
          {t("session.finish")}
        </Button>
      </div>
      <h1 className="text-[22px] leading-tight font-bold tracking-tight">
        {sessionTitle(workout.sessionCode, t)}
      </h1>
      {error && (
        <p role="alert" className="rounded-chip bg-track p-3 text-sm">
          {error}
        </p>
      )}
      {plan.map((slot, i) => {
        const exercise = exerciseById(slot.exerciseId);
        if (!exercise) return null;
        const open = toggled.get(i) ?? i === active.slotIndex;
        return (
          <ExerciseCard
            key={i}
            slot={slot}
            slotIndex={i}
            exercise={exercise}
            sets={sets.filter((s) => s.slotIndex === i)}
            history={history}
            bar={bar}
            open={open}
            current={i === active.slotIndex}
            group={groupLabel(i)}
            note={workout.exerciseNotes[String(i)] ?? ""}
            onToggle={() => setToggled((m) => new Map(m).set(i, !open))}
            onValidate={validate(i)}
            onCorrect={correct}
            onNote={saveNote(i)}
          />
        );
      })}
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
            <Button
              size="lg"
              className="w-full font-semibold"
              onClick={() => onFinish(sets.length === 0)}
            >
              {t("session.finish")}
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full"
              onClick={() => setFinishing(false)}
            >
              {t("session.keepGoing")}
            </Button>
          </div>
        </Sheet>
      )}
    </section>
  );
}
