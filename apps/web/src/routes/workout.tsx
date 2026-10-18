import "@/i18n/lazy";
import { newId } from "@belay/shared";
import { toISODate } from "@belay/shared/body/dates";
import { exerciseById } from "@belay/shared/exercises/catalog";
import type { Exercise } from "@belay/shared/exercises/library";
import type { Change } from "@belay/shared/sync/schema";
import {
  pauseEndedBy,
  resumedRestEnd,
  resumedStart,
  sessionElapsed,
} from "@belay/shared/training/pause";
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
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { ChevronDown, Pause, Play, Timer } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionSheet } from "@/components/action-sheet";
import { Button } from "@/components/ui/button";
import { previousHref } from "@/lib/back";
import { readPauseStops } from "@/lib/pause-stops";
import { sessionTitle } from "@/lib/format";
import { readToolState, resolveEquipment } from "@/lib/tool-storage";
import { levelOf } from "@/lib/transitions";
import { type ActiveSession, readActiveSession, readActivities, readHistory } from "@/sync/db";
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

// What « Terminer » has open: the finish question, the one for a session with nothing logged,
// or the delete question that follows « Supprimer la séance… ».
type FinishSheet = null | "finish" | "empty" | "delete";

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
  // While the end is written, the screen holds the session as it was: it neither redirects nor
  // shows a session already over, and the page that leaves is the one the person saw.
  const [leaving, setLeaving] = useState<typeof view>();
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

  // Ended, the session gives its place to its summary; removed, to Accueil. Either way the
  // session's entry is replaced, so Back never comes to a session that is over.
  const leave = async (workout: Workout, changes: Change[], kept: boolean) => {
    setLeaving(view);
    try {
      await record(changes, { active: null });
    } catch {
      setLeaving(undefined);
      setFailed(t("weighIn.saveFailed"));
      return;
    }
    // Saved: a page change that fails lets go of the session as it was, and the screen follows
    // what is stored, a session over, out to Program.
    await navigate(
      kept
        ? { to: "/workout/summary/$workoutId", params: { workoutId: workout.id }, replace: true }
        : { to: "/", replace: true },
    ).catch(() => setLeaving(undefined));
  };

  const shown = leaving ?? view;
  if (start || !shown) return null;
  const { active, history } = shown;
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
      onLeave={(changes, kept) => void leave(workout, changes, kept)}
    />
  );
}

function Screen({
  account,
  active,
  workout,
  history,
  failed,
  onLeave,
}: {
  account: OpenAccount;
  active: ActiveSession;
  workout: Workout;
  history: History;
  failed: string | undefined;
  onLeave: (changes: Change[], kept: boolean) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const record = useRecord(account);
  const recordSet = useRecordSet(account);
  const now = useNow();
  const [toggled, setToggled] = useState<ReadonlyMap<number, boolean>>(new Map());
  const [sheet, setSheet] = useState<FinishSheet>(null);
  // The sheet that rises once this one has left: the delete question after « Supprimer… ».
  const then = useRef<FinishSheet>(null);
  // The exercise picker: for a slot to replace, or for one added at the end.
  const [picking, setPicking] = useState<{ slotIndex: number } | "add" | null>(null);
  // A picked exercise is in the plan behind while the picker plays its exit.
  const [leaving, setLeaving] = useState(false);
  const [saveError, setError] = useState<string>();
  const error = saveError ?? failed;
  const plan = workout.plan;
  const sets = liveSets(history).filter((s) => s.workoutId === workout.id);
  // The question is chosen at the tap on « Terminer »; a set synced since then (another device,
  // another tab) turns the one for an empty session into the finish question.
  if (sheet === "empty" && sets.length > 0) setSheet("finish");
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
  // The pause stays on this device; the session time stands still from it, and the rest too
  // unless this device keeps the rest running.
  const paused = active.pausedAt ?? null;
  const stops = readPauseStops();
  // A resume counts from its own moment: the clock's last tick may be up to a second older,
  // and the time would step back.
  const [resumed, setResumed] = useState(0);
  const elapsed = sessionElapsed(workout.startedAt, paused, Math.max(now, resumed));
  const pause = () => setActive({ pausedAt: new Date().toISOString() });
  // One write: the start moved later by the time paused and the pause cleared, so the recorded
  // duration leaves the pause out on every device; a rest the pause stopped goes on from there.
  const resumeAt = useCallback(
    (at: string) => {
      setResumed((t) => Math.max(t, Date.parse(at)));
      return record(
        [
          {
            kind: "workout",
            id: workout.id,
            field: "startedAt",
            value: resumedStart(workout.startedAt, paused!, at),
            at,
          },
        ],
        {
          active: {
            ...active,
            pausedAt: null,
            restEndsAt: resumedRestEnd(active.restEndsAt, paused!, at, stops),
          },
        },
      );
    },
    [active, paused, record, stops, workout.id, workout.startedAt],
  );
  const resume = useCallback((at: string) => save(() => resumeAt(at)), [resumeAt, save]);
  // A set logged on another device after the pause began ends it at that set's time.
  const doneAts = sets.map((s) => s.doneAt);
  const endedBy = paused && pauseEndedBy(paused, doneAts);
  // Ended now; finished while paused, the start moves past the pause in the same write, so the
  // duration leaves it out as a resume would. A pause another device's set has ended (its resume
  // not written) ends at that set: the time trained since stays in.
  const end = () => {
    const at = new Date().toISOString();
    const moved: Change[] = paused
      ? [
          {
            kind: "workout",
            id: workout.id,
            field: "startedAt",
            value: resumedStart(workout.startedAt, paused, endedBy || at),
            at,
          },
        ]
      : [];
    onLeave([...moved, { kind: "workout", id: workout.id, field: "ended", value: at, at }], true);
  };
  const remove = () =>
    onLeave(
      [
        {
          kind: "workout",
          id: workout.id,
          field: "removed",
          value: true,
          at: new Date().toISOString(),
        },
      ],
      false,
    );
  // A set may be stored and not on screen yet: the device is read again at this tap, and a
  // session holding a set gets the finish question, never a removal in one tap.
  const leaveEmpty = async () => {
    if (!liveSets(await readHistory(account.db)).some((s) => s.workoutId === workout.id))
      return remove();
    await queryClient.invalidateQueries({ queryKey: ["local", account.user.id] });
    setSheet("finish");
  };
  const closeSheet = () => {
    setSheet(then.current);
    then.current = null;
  };
  // What « Terminer » keeps: the planned work sets done over those planned, the ones left
  // unticked, and that the program stays as it is.
  const total = done.size + left;
  const finishBody =
    left > 0
      ? [
          t("session.finishCount", { count: done.size, total }),
          t("session.finishLeft", { count: left }),
          t("session.finishProgram"),
        ].join(" ")
      : t("session.finishAll", { count: done.size, total });
  // The pause it ends is resumed once.
  const ended = useRef<string | null>(null);
  useEffect(() => {
    if (!paused || !endedBy || ended.current === paused) return;
    ended.current = paused;
    void resume(endedBy);
  }, [paused, endedBy, resume]);
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
    // The rest as the resume written first leaves it.
    const restEnd = paused
      ? resumedRestEnd(active.restEndsAt, paused, doneAt, stops)
      : active.restEndsAt;
    await save(async () => {
      // Checked while paused: the session resumes at this tap, written before the set.
      if (paused) await resumeAt(doneAt);
      await recordSet(
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
              restEnd && Date.parse(restEnd) > Date.parse(doneAt)
              ? restEnd
              : null,
          pausedAt: null,
        },
      );
    });
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

  // Lowering keeps the session open and shows the page it was raised over, the same entry as
  // before; with none seen in this visit (a reload, a link) or a cover under it, Accueil takes
  // the session's place.
  const lower = () => {
    const before = previousHref(router.history);
    if (before !== undefined && levelOf(new URL(before, location.origin).pathname) !== "cover")
      router.history.back();
    else void navigate({ to: "/", replace: true });
  };

  // The rest starts from a work set, never a warm-up: the line runs from the last one logged.
  const workDone = sets.filter((s) => !s.warmup).map((s) => Date.parse(s.doneAt));
  const restFrom = workDone.length
    ? new Date(Math.max(...workDone)).toISOString()
    : workout.startedAt;
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
      {/* Pinned to the top while the cards scroll, edge to edge over the column's padding and
          under the notch, so the way out and the time stay in reach. */}
      <div className="sticky top-0 z-10 -mt-[max(1rem,env(safe-area-inset-top))] -mr-[max(1rem,env(safe-area-inset-right))] -ml-[max(1rem,env(safe-area-inset-left))] box-content flex h-12.75 items-center gap-1 border-b border-border bg-background pt-[env(safe-area-inset-top)] pr-[max(0.625rem,env(safe-area-inset-right))] pl-[max(0.375rem,env(safe-area-inset-left))]">
        <button
          type="button"
          aria-label={t("session.lower")}
          onClick={lower}
          className="press grid size-11 place-items-center rounded-control"
        >
          <ChevronDown aria-hidden className="size-6" />
        </button>
        <span className="ml-0.5 flex min-h-11 items-center gap-1.5 font-bold tabular-nums">
          <Timer aria-hidden className="size-4.5 text-muted-foreground" />
          <span className="sr-only">{t("session.elapsed")}</span>
          {formatClock(elapsed, Math.floor)}
        </span>
        <button
          type="button"
          aria-label={paused ? t("session.resume") : t("session.pause")}
          onClick={paused ? () => void resume(new Date().toISOString()) : pause}
          className="press grid size-11 shrink-0 place-items-center rounded-control"
        >
          {paused ? (
            <Play aria-hidden className="size-5" />
          ) : (
            <Pause aria-hidden className="size-5" />
          )}
        </button>
        {paused && (
          <span className="truncate rounded-[8px] bg-primary-soft px-2 py-0.5 text-(length:--text-secondary) leading-(--text-secondary--line-height) font-semibold text-primary-ink">
            {t("session.paused")}
          </span>
        )}
        <span className="flex-1" />
        {/* Always a question: ending cannot be undone from here, and a stray tap next to the
            pause control must never end a session. */}
        <Button
          variant="secondary"
          onClick={() => setSheet(sets.length === 0 ? "empty" : "finish")}
        >
          {t("session.finish")}
        </Button>
      </div>
      {/* Said once when the session pauses; the banner below holds the way back. */}
      <p role="status" className="sr-only">
        {paused ? t("session.pausedTitle") : ""}
      </p>
      <PauseBanner
        paused={paused !== null}
        onResume={() => void resume(new Date().toISOString())}
      />
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
          startedAt={restFrom}
          next={restLabel}
          pausedAt={paused}
          stops={stops}
          onChange={(restEndsAt) => setActive({ restEndsAt })}
        />
      )}
      {sheet === "finish" && (
        <ActionSheet
          key="finish"
          title={t("session.finishTitle")}
          body={finishBody}
          primary={{ label: t("session.finishSave"), onSelect: end }}
          confirm={t("session.deleteAsk")}
          onConfirm={() => (then.current = "delete")}
          cancel={t("session.keepGoing")}
          onClose={closeSheet}
        />
      )}
      {/* Every logged set goes with the session, warm-ups included. */}
      {sheet === "delete" && (
        <ActionSheet
          key="delete"
          title={t("session.deleteTitle")}
          body={t("session.deleteBody", { count: sets.length })}
          confirm={t("session.delete")}
          onConfirm={remove}
          onClose={closeSheet}
        />
      )}
      {sheet === "empty" && (
        <ActionSheet
          key="empty"
          title={t("session.emptyTitle")}
          body={t("session.emptyBody")}
          confirm={t("session.leave")}
          onConfirm={() => void save(leaveEmpty)}
          cancel={t("session.keepGoing")}
          onClose={closeSheet}
        />
      )}
    </section>
  );
}

// Under the header, in the flow and pinned below it while the cards scroll, so it never covers
// a card's name or a control. It drops in when the session pauses and fades out on resume,
// while the time already runs again.
function PauseBanner({ paused, onResume }: { paused: boolean; onResume: () => void }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(paused);
  if (paused && !shown) setShown(true);
  if (!shown) return null;
  return (
    <div
      inert={!paused}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && !paused) setShown(false);
      }}
      className={`${paused ? "animate-drop-in" : "animate-fade-out"} sticky top-[calc(env(safe-area-inset-top)+3.25rem)] z-10 flex items-center gap-2.5 rounded-[18px] bg-foreground py-2.5 pr-2 pl-4 text-background`}
    >
      <Pause aria-hidden className="size-5 shrink-0 text-toast-icon" />
      <p className="min-w-0 flex-1 text-sm leading-snug">
        <span className="block font-bold">{t("session.pausedTitle")}</span>
        {t("session.pausedBody")}
      </p>
      <button
        type="button"
        onClick={onResume}
        className="press grid min-h-11 shrink-0 place-items-center rounded-[12px] bg-toast-icon px-3.5 text-sm font-bold whitespace-nowrap text-foreground"
      >
        {t("session.resumeShort")}
      </button>
    </div>
  );
}
