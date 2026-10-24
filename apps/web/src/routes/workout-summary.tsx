import "@/i18n/lazy";
import { exerciseById } from "@belay/shared/exercises/catalog";
import { kgToLb } from "@belay/shared/tools/units";
import { liveSets, loggedByExercise, summary } from "@belay/shared/training/rules";
import { NOTE_MAX } from "@belay/shared/training/workout";
import { useNavigate, useParams } from "@tanstack/react-router";
import { PartyPopper } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GroupedList, groupSurface } from "@/components/grouped-list";
import { Button } from "@/components/ui/button";
import { readSessionVolume } from "@/lib/display-prefs";
import { formatNumber, formatWeekday, sessionTitle } from "@/lib/format";
import { useToday } from "@/lib/today";
import { readWeightUnit } from "@/lib/units";
import { cn } from "@/lib/utils";
import { type OpenAccount, useAccount, useHistory, useRecord } from "@/sync/account";
import { durationParts, formatLoad, recordText } from "@/workouts/format";
import { dayOf } from "@/workouts/history-panel";
import { NotFound } from "./fallbacks";

// The summary at the end of a session (§4.4): the session's own page, its duration, work sets and
// volume (warm-ups left out) in big figures, the volume unless this device hides it; records, what
// was logged per exercise, and an optional note; Save goes back Home.
export function WorkoutSummary() {
  const account = useAccount();
  if (account.kind === "loading") return null;
  if (account.kind !== "open") return <NotFound />;
  return <Summary account={account} />;
}

function Summary({ account }: { account: OpenAccount }) {
  const { t, i18n } = useTranslation();
  const today = useToday();
  const navigate = useNavigate();
  const { workoutId } = useParams({ from: "/workout/summary/$workoutId" });
  const history = useHistory(account).data;
  const record = useRecord(account);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  // A device preference, read once as the page opens.
  const [volumeShown] = useState(() => readSessionVolume() === "shown");
  if (!history) return null;
  const workout = history.workouts.find((w) => w.id === workoutId);
  if (!workout || workout.removed || workout.endedAt === null) return <NotFound />;
  const stats = summary(workout, liveSets(history), history);
  const unit = readWeightUnit();
  const n = (v: number, digits = 0) => formatNumber(v, i18n.language, { digits });
  const home = () => void navigate({ to: "/" });
  const save = async () => {
    try {
      if (note.trim() !== "")
        await record({
          kind: "workout",
          id: workout.id,
          field: "note",
          value: note.trim(),
          at: new Date().toISOString(),
        });
      home();
    } catch {
      setError(t("weighIn.saveFailed"));
    }
  };
  const logged = loggedByExercise(workout, history.sets);
  const duration = durationParts(stats.durationMs, t);

  return (
    <section className="flex flex-col gap-4">
      <div className="-mr-3 flex justify-end">
        <Button variant="text" onClick={home}>
          {t("summary.close")}
        </Button>
      </div>
      <div>
        <p className="text-[13px] font-semibold text-muted-foreground">
          {t("summary.eyebrow", {
            day: formatWeekday(dayOf(workout), i18n.language, today, {
              startOfLine: false,
              long: true,
            }),
          })}
        </p>
        <h1 className="text-[30px] leading-tight font-bold tracking-tight">
          {sessionTitle(workout.sessionCode, t)}
        </h1>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <Figure label={t("summary.duration")} value={duration.value} unit={duration.unit} />
        <Figure label={t("summary.sets")} value={String(stats.workSets)} />
        {volumeShown && (
          <Figure
            label={t("summary.volume")}
            value={n(unit === "kg" ? stats.volumeKg : kgToLb(stats.volumeKg))}
            unit={unit}
            className="col-span-2"
          />
        )}
      </dl>
      {stats.records.map((r) => (
        <p
          key={r.exerciseId}
          className="flex items-start gap-2 rounded-[14px] bg-reference px-3 py-2.5 font-semibold text-reference-ink"
        >
          <PartyPopper aria-hidden className="mt-0.5 size-4 shrink-0" />
          {recordText(r, t, i18n.language)}
        </p>
      ))}
      {logged.length > 0 && (
        <GroupedList label={t("summary.logged")}>
          {logged.map((e) => (
            <div
              key={`${e.slotIndex}|${e.exerciseId}`}
              className="flex min-h-14 items-center gap-3 px-4 py-2"
            >
              <span
                aria-hidden
                className="grid size-7 shrink-0 place-items-center rounded-icon bg-track text-[13px] font-semibold text-muted-foreground tabular-nums"
              >
                {e.slotIndex + 1}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-body font-semibold break-words">
                  {exerciseById(e.exerciseId)?.name ?? e.exerciseId}
                </span>{" "}
                <span className="text-(length:--text-secondary) leading-(--text-secondary--line-height) break-words text-muted-foreground">
                  {t("summary.loggedSets", {
                    count: e.workSets,
                    set: formatLoad(e.top, t, i18n.language),
                  })}
                </span>
              </span>
            </div>
          ))}
        </GroupedList>
      )}
      <p className="text-[13px] text-muted-foreground">
        {t("summary.warmups")} · {t("summary.warmupCount", { count: stats.warmupSets })}
      </p>
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        {t("summary.note")}
        <textarea
          value={note}
          maxLength={NOTE_MAX}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
          className="field px-3 py-2 text-base font-normal"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <Button className="w-full" onClick={() => void save()}>
        {t("summary.save")}
      </Button>
    </section>
  );
}

// A figure card: its label, then the figure large and tabular, its unit small beside it.
function Figure({
  label,
  value,
  unit,
  className,
}: {
  label: string;
  value: string;
  unit?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 p-4", groupSurface, className)}>
      <dt className="text-[13px] font-semibold text-muted-foreground">{label}</dt>
      <dd className="text-[44px] leading-none font-extrabold tracking-tight break-words tabular-nums">
        {value}
        {unit && (
          <span className="text-[17px] font-semibold tracking-normal text-muted-foreground">
            {" "}
            {unit}
          </span>
        )}
      </dd>
    </div>
  );
}
