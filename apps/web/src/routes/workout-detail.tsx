import "@/i18n/lazy";
import { exerciseById } from "@belay/shared/exercises/catalog";
import { liveSets, summary } from "@belay/shared/training/rules";
import { MAX_WARMUPS, type Workout, type WorkoutSet } from "@belay/shared/training/workout";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ChevronLeft, PartyPopper } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sheet } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { formatNumber, formatWeekday, sessionTitle } from "@/lib/format";
import { useToday } from "@/lib/today";
import { type OpenAccount, useAccount, useHistory, useRecord } from "@/sync/account";
import { formatDuration, recordText } from "@/workouts/format";
import { dayOf } from "@/workouts/history-panel";
import { NotFound } from "./fallbacks";

const back = "-ml-1 inline-flex min-h-11 items-center gap-0.5 self-start font-medium text-primary";
const card = "rounded-card border border-border bg-card";

// A finished session (§4.4): its exercises and sets as they were done, its records and notes;
// « Modifier » opens the editor (spec D9), and it can still be removed whole.
export function WorkoutDetail() {
  const account = useAccount();
  if (account.kind !== "open") return <NotFound />;
  return <Detail account={account} />;
}

function Detail({ account }: { account: OpenAccount }) {
  const { t, i18n } = useTranslation();
  const today = useToday();
  const { workoutId } = useParams({ from: "/workouts/$workoutId" });
  const history = useHistory(account).data;
  const record = useRecord(account);
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string>();
  if (!history) return null;
  const workout = history.workouts.find((w) => w.id === workoutId);
  if (!workout || workout.removed || workout.endedAt === null) return leaving ? null : <NotFound />;
  const sets = liveSets(history).filter((s) => s.workoutId === workout.id);
  const stats = summary(workout, sets, history);
  const kg = (v: number) => formatNumber(v, i18n.language, { digits: 2 });

  const remove = async () => {
    setLeaving(true); // the session goes before the page does: no "not found" in between
    try {
      await record({
        kind: "workout",
        id: workout.id,
        field: "removed",
        value: true,
        at: new Date().toISOString(),
      });
      await navigate({ to: "/workouts", search: { tab: "history" } });
    } catch {
      setLeaving(false);
      setError(t("weighIn.saveFailed"));
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col">
        <Link to="/workouts" search={{ tab: "history" }} className={back}>
          <ChevronLeft aria-hidden className="size-5" />
          {t("workouts.title")}
        </Link>
        <h1 className="text-[26px] leading-tight font-bold tracking-tight">
          {sessionTitle(workout.sessionCode, t)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {formatWeekday(dayOf(workout), i18n.language, today)} ·{" "}
          {formatDuration(stats.durationMs, t)} · {t("history.workSets", { count: stats.workSets })}{" "}
          ·{" "}
          {t("history.volume", {
            value: formatNumber(stats.volumeKg, i18n.language, { digits: 0 }),
          })}
        </p>
      </div>
      {stats.records.map((r) => (
        <p
          key={r.exerciseId}
          className="flex items-start gap-2 rounded-[14px] bg-reference px-3 py-2.5 font-semibold text-reference-ink"
        >
          <PartyPopper aria-hidden className="mt-0.5 size-4 shrink-0" />
          {recordText(r, t, i18n.language)}
        </p>
      ))}
      {workout.plan.map((slot, i) => (
        <SlotSets key={i} workout={workout} slotIndex={i} sets={sets} kg={kg} />
      ))}
      {workout.note && (
        <section aria-labelledby="note" className={`${card} p-4`}>
          <h2 id="note" className="text-[15px] font-semibold">
            {t("history.note")}
          </h2>
          <p className="mt-1 whitespace-pre-line">{workout.note}</p>
        </section>
      )}
      <div className="flex flex-col gap-2">
        <Button asChild variant="outline" size="lg" className="w-full font-semibold">
          <Link to="/workout/edit" search={{ id: workout.id }}>
            {t("history.edit")}
          </Link>
        </Button>
        <Button
          variant="destructive"
          size="lg"
          className="self-start"
          onClick={() => setConfirm(true)}
        >
          {t("history.remove")}
        </Button>
      </div>
      {confirm && (
        <Sheet title={t("history.removeTitle")} onClose={() => setConfirm(false)}>
          <p>{t("history.removeBody")}</p>
          {error && <p role="alert">{error}</p>}
          <div className="flex flex-col gap-2">
            <Button size="lg" className="w-full font-semibold" onClick={() => void remove()}>
              {t("history.removeConfirm")}
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="w-full"
              onClick={() => setConfirm(false)}
            >
              {t("history.cancel")}
            </Button>
          </div>
        </Sheet>
      )}
    </section>
  );
}

function SlotSets({
  workout,
  slotIndex,
  sets,
  kg,
}: {
  workout: Workout;
  slotIndex: number;
  sets: WorkoutSet[];
  kg: (v: number) => string;
}) {
  const own = sets.filter((s) => s.slotIndex === slotIndex).sort((a, b) => a.position - b.position);
  const note = workout.exerciseNotes[String(slotIndex)];
  if (own.length === 0 && !note) return null;
  // A slot replaced during the session holds the sets of each exercise, apart.
  const exercises = [...new Set(own.map((s) => s.exerciseId))];
  if (exercises.length === 0) exercises.push(workout.plan[slotIndex]!.exerciseId);
  return (
    <>
      {exercises.map((exerciseId, k) => (
        <ExerciseSets
          key={exerciseId}
          name={exerciseById(exerciseId)?.name ?? exerciseId}
          sets={own.filter((s) => s.exerciseId === exerciseId)}
          note={k === exercises.length - 1 ? note : undefined}
          kg={kg}
        />
      ))}
    </>
  );
}

function ExerciseSets({
  name,
  sets,
  note,
  kg,
}: {
  name: string;
  sets: WorkoutSet[];
  note: string | undefined;
  kg: (v: number) => string;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={name} className={`${card} px-4 py-3`}>
      <h2 className="font-semibold">{name}</h2>
      <ol className="mt-1 flex flex-col">
        {sets.map((s) => (
          <li
            key={s.id}
            className="flex min-h-9 items-center gap-3 border-t border-border text-sm first:border-t-0"
          >
            <span
              className={
                s.warmup
                  ? "w-14 text-xs font-semibold text-primary-ink"
                  : "w-14 font-semibold text-muted-foreground"
              }
            >
              {s.warmup ? t("history.warmup") : s.position - MAX_WARMUPS + 1}
            </span>
            <span className="tabular-nums">
              {s.seconds != null
                ? s.weightKg > 0
                  ? t("history.loadSeconds", { kg: kg(s.weightKg), seconds: s.seconds })
                  : t("history.seconds", { seconds: s.seconds })
                : t("history.load", { kg: kg(s.weightKg), reps: s.reps })}
              {s.rir !== null && ` · ${t("history.rir", { rir: s.rir === 4 ? "4+" : s.rir })}`}
            </span>
          </li>
        ))}
      </ol>
      {note && <p className="mt-2 text-sm whitespace-pre-line text-muted-foreground">{note}</p>}
    </section>
  );
}
