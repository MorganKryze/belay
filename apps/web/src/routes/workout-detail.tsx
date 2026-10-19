import "@/i18n/lazy";
import { exerciseById } from "@belay/shared/exercises/catalog";
import { liveSets, summary } from "@belay/shared/training/rules";
import { type Workout, type WorkoutSet } from "@belay/shared/training/workout";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { PartyPopper } from "lucide-react";
import { type TFunction } from "i18next";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionSheet } from "@/components/action-sheet";
import {
  GroupedList,
  groupSurface,
  NumberTile,
  RowButton,
  sectionLabel,
} from "@/components/grouped-list";
import { BackLink, PageHeader } from "@/components/page-header";
import { cardSurface } from "@/components/surfaces";
import { readSessionVolume } from "@/lib/display-prefs";
import { formatNumber, sessionTitle } from "@/lib/format";
import { useToday } from "@/lib/today";
import { type OpenAccount, useAccount, useHistory, useRecord } from "@/sync/account";
import { durationParts, formatRir, formatSets, formatStarted, recordText } from "@/workouts/format";
import { NotFound } from "./fallbacks";

// A finished session (§4.4): its exercises and sets as they were done, its records and notes;
// « Modifier », up in the bar, opens the editor (spec D9), and it can still be removed whole.
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
  // A device preference, read once as the page opens.
  const [volumeShown] = useState(() => readSessionVolume() === "shown");
  const exercisesId = useId();
  if (!history) return null;
  const workout = history.workouts.find((w) => w.id === workoutId);
  if (!workout || workout.removed || workout.endedAt === null) return leaving ? null : <NotFound />;
  const sets = liveSets(history).filter((s) => s.workoutId === workout.id);
  const stats = summary(workout, sets, history);
  const kg = (v: number) => formatNumber(v, i18n.language, { digits: 2 });
  const cards = exerciseCards(workout, sets, t);

  const remove = async () => {
    setError(undefined);
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
      <PageHeader
        title={sessionTitle(workout.sessionCode, t)}
        back={
          <BackLink to="/workouts" search={{ tab: "history" }}>
            {t("workouts.tabs.history")}
          </BackLink>
        }
        action={
          <Link
            to="/workout/edit"
            search={{ id: workout.id }}
            className="inline-flex min-h-11 min-w-11 items-center justify-end px-1.5 font-medium text-primary"
          >
            {t("history.edit")}
          </Link>
        }
      >
        <p className="text-body text-muted-foreground">
          {formatStarted(workout.startedAt, i18n.language, today, t)}
        </p>
      </PageHeader>
      <Strip
        figures={[
          { label: t("summary.duration"), ...durationParts(stats.durationMs, t) },
          { label: t("summary.sets"), value: String(stats.workSets) },
          ...(volumeShown
            ? [
                {
                  label: t("summary.volume"),
                  value: formatNumber(stats.volumeKg, i18n.language, { digits: 0 }),
                  unit: "kg",
                },
              ]
            : []),
        ]}
      />
      {stats.records.map((r) => (
        <p
          key={r.exerciseId}
          className="flex items-start gap-2 rounded-[14px] bg-reference px-3 py-2.5 font-semibold text-reference-ink"
        >
          <PartyPopper aria-hidden className="mt-0.5 size-4 shrink-0" />
          {recordText(r, t, i18n.language)}
        </p>
      ))}
      {cards.length > 0 && (
        <section aria-labelledby={exercisesId} className="flex flex-col gap-2">
          <h2 id={exercisesId} className={sectionLabel}>
            {t("preview.exercises")}
          </h2>
          <div className="flex flex-col gap-4">
            {cards.map(({ key, ...c }) => (
              <ExerciseSets key={key} {...c} kg={kg} />
            ))}
          </div>
        </section>
      )}
      {workout.note && (
        <section aria-labelledby="note" className={`${cardSurface} p-4`}>
          <h2 id="note" className="text-[15px] font-semibold">
            {t("history.note")}
          </h2>
          <p className="mt-1 whitespace-pre-line">{workout.note}</p>
        </section>
      )}
      <GroupedList>
        <RowButton destructive label={t("history.remove")} onClick={() => setConfirm(true)} />
      </GroupedList>
      {error && (
        <p role="alert" className="px-4 text-body">
          {error}
        </p>
      )}
      {confirm && (
        <ActionSheet
          title={t("history.removeTitle")}
          body={t("history.removeBody")}
          confirm={t("history.removeConfirm")}
          busy={leaving}
          onConfirm={() => void remove()}
          onClose={() => setConfirm(false)}
        />
      )}
    </section>
  );
}

type Figure = { label: string; value: string; unit?: string };

// The session's figures in one card, side by side: the label small above, the figure large and
// tabular, its unit small beside it.
function Strip({ figures }: { figures: Figure[] }) {
  return (
    <dl
      className={`grid ${figures.length === 3 ? "grid-cols-3" : "grid-cols-2"} divide-x divide-border py-2.5 ${groupSurface}`}
    >
      {figures.map(({ label, value, unit }) => (
        <div key={label} className="flex min-w-0 flex-col items-center px-1 text-center">
          <dt className="text-[12px] font-semibold text-muted-foreground">{label}</dt>
          <dd className="text-[20px] font-bold tracking-[-0.01em] tabular-nums">
            {value}
            {unit && (
              <span className="text-[12px] font-semibold tracking-normal text-muted-foreground">
                {" "}
                {unit}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type ExerciseCard = {
  key: string;
  n: number;
  name: string;
  prescription: string;
  sets: WorkoutSet[];
  note: string | undefined;
};

// One card per exercise done, numbered in reading order: a slot replaced during the session holds
// the sets of each exercise apart, each card with the slot's prescription and the slot's note
// under the last one. The prescription is the session's own plan, as it stood when it started.
function exerciseCards(workout: Workout, sets: WorkoutSet[], t: TFunction): ExerciseCard[] {
  return workout.plan
    .flatMap((slot, slotIndex) => {
      const own = sets
        .filter((s) => s.slotIndex === slotIndex)
        .sort((a, b) => a.position - b.position);
      const note = workout.exerciseNotes[String(slotIndex)];
      if (own.length === 0 && !note) return [];
      const exercises = [...new Set(own.map((s) => s.exerciseId))];
      if (exercises.length === 0) exercises.push(slot.exerciseId);
      const prescription = `${formatSets(slot)} · ${formatRir(slot, t)}`;
      return exercises.map((exerciseId, k) => ({
        key: `${slotIndex}-${exerciseId}`,
        name: exerciseById(exerciseId)?.name ?? exerciseId,
        prescription,
        sets: own.filter((s) => s.exerciseId === exerciseId),
        note: k === exercises.length - 1 ? note : undefined,
      }));
    })
    .map((card, i) => ({ ...card, n: i + 1 }));
}

// A hairline across the top of a row, from under the exercise's name to the card's edge.
const hairline =
  "relative before:absolute before:top-0 before:right-0 before:left-14 before:h-px before:bg-border";

function ExerciseSets({
  n,
  name,
  prescription,
  sets,
  note,
  kg,
}: Omit<ExerciseCard, "key"> & { kg: (v: number) => string }) {
  const { t } = useTranslation();
  const secondary =
    "text-(length:--text-secondary) leading-(--text-secondary--line-height) text-muted-foreground";
  return (
    <section aria-label={name} className={groupSurface}>
      <div className="flex min-h-14 items-center gap-3 py-1.5 pr-3.5 pl-4">
        <NumberTile n={n} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-body font-semibold">{name}</h2>
          <p className={`truncate ${secondary}`}>{prescription}</p>
        </div>
      </div>
      <ol>
        {sets.map((s) => (
          <li
            key={s.id}
            className={`${hairline} grid min-h-10 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-1.5 pr-4 pl-2.5 text-body tabular-nums`}
          >
            <span
              className={
                s.warmup
                  ? "text-center text-[11px] leading-tight font-semibold text-primary-ink"
                  : `text-center font-semibold ${secondary}`
              }
            >
              {s.warmup ? t("history.warmup") : sets.filter((o) => !o.warmup).indexOf(s) + 1}
            </span>
            <span>
              {s.seconds != null
                ? s.weightKg > 0
                  ? t("history.loadSeconds", { kg: kg(s.weightKg), seconds: s.seconds })
                  : t("history.seconds", { seconds: s.seconds })
                : t("history.load", { kg: kg(s.weightKg), reps: s.reps })}
            </span>
            <span className={secondary}>
              {s.rir !== null && t("history.rir", { rir: s.rir === 4 ? "4+" : s.rir })}
            </span>
          </li>
        ))}
      </ol>
      {note && (
        <p className={`${hairline} pt-2 pr-4 pb-3 pl-14 whitespace-pre-line ${secondary}`}>
          {note}
        </p>
      )}
    </section>
  );
}
