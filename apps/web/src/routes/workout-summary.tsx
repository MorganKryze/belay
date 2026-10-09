import "@/i18n/lazy";
import { exerciseById } from "@belay/shared/exercises/catalog";
import { liveSets, summary } from "@belay/shared/training/rules";
import { NOTE_MAX } from "@belay/shared/training/workout";
import { useNavigate, useParams } from "@tanstack/react-router";
import { PartyPopper } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { formatNumber, formatWeekday, sessionTitle } from "@/lib/format";
import { useToday } from "@/lib/today";
import { type OpenAccount, useAccount, useHistory, useRecord } from "@/sync/account";
import { formatDuration } from "@/workouts/format";
import { dayOf } from "@/workouts/history-panel";
import { NotFound } from "./fallbacks";

// The summary at the end of a session (§4.4): duration, work sets, volume (warm-ups left out),
// records, and an optional note; Save goes back Home.
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
  if (!history) return null;
  const workout = history.workouts.find((w) => w.id === workoutId);
  if (!workout || workout.removed || workout.endedAt === null) return <NotFound />;
  const stats = summary(workout, liveSets(history), history);
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
  const stat = "flex flex-col";
  const label = "text-[13px] text-muted-foreground";
  const value = "text-[30px] leading-tight font-extrabold tabular-nums";

  return (
    <section className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="outline" onClick={home}>
          {t("summary.close")}
        </Button>
      </div>
      <div>
        <h1 className="text-[22px] leading-tight font-bold tracking-tight">{t("summary.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {formatWeekday(dayOf(workout), i18n.language, today)} ·{" "}
          {sessionTitle(workout.sessionCode, t)}
        </p>
      </div>
      {stats.records.map((r) => (
        <p
          key={r.exerciseId}
          className="flex items-start gap-2 rounded-[14px] bg-reference px-3 py-2.5 font-semibold text-reference-ink"
        >
          <PartyPopper aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t("summary.record", {
            exercise: exerciseById(r.exerciseId)?.name,
            kg: n(r.weightKg, 2),
            reps: r.reps,
          })}
        </p>
      ))}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <div className={stat}>
          <dt className={label}>{t("summary.duration")}</dt>
          <dd className={value}>{formatDuration(stats.durationMs, t)}</dd>
        </div>
        <div className={stat}>
          <dt className={label}>{t("summary.workSets")}</dt>
          <dd className={value}>{stats.workSets}</dd>
        </div>
        <div className={stat}>
          <dt className={label}>{t("summary.volume")}</dt>
          <dd className={value}>
            {n(stats.volumeKg)}
            <span className="text-[13px] font-semibold text-muted-foreground"> kg</span>
          </dd>
        </div>
        <div className={stat}>
          <dt className={label}>{t("summary.warmups")}</dt>
          <dd className="text-xl leading-tight font-bold text-muted-foreground">
            {t("summary.warmupCount", { count: stats.warmupSets })}
          </dd>
        </div>
      </dl>
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        {t("summary.note")}
        <textarea
          value={note}
          maxLength={NOTE_MAX}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
          className="rounded-field border border-input bg-card px-3 py-2 text-base font-normal"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <Button size="lg" className="w-full font-semibold" onClick={() => void save()}>
        {t("summary.save")}
      </Button>
    </section>
  );
}
