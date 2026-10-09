import "@/i18n/lazy";
import { openWorkout } from "@belay/shared/training/rules";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "@/components/segmented";
import { Button } from "@/components/ui/button";
import { ExercisesPanel } from "@/exercises/exercises-panel";
import { HistoryPanel } from "@/workouts/history-panel";
import { type OpenAccount, useAccount, useHistory } from "@/sync/account";
import { ProgramPanel } from "@/workouts/program-panel";
import { isWorkoutTab, WORKOUT_TABS, type WorkoutTab } from "@/workouts/tabs";

// The segment last chosen, on this device (§4.5).
const KEY = "belay.workouts.tab";

function readTab(): WorkoutTab {
  try {
    const stored = localStorage.getItem(KEY);
    return isWorkoutTab(stored) ? stored : WORKOUT_TABS[0];
  } catch {
    return WORKOUT_TABS[0];
  }
}

// The Sessions tab (§4.5): the history, the program and the exercise library, one segment each.
export function Workouts() {
  const { t } = useTranslation();
  const search = useSearch({ from: "/workouts" });
  const navigate = useNavigate();
  const account = useAccount();
  const tab = search.tab ?? readTab();
  useEffect(() => {
    try {
      localStorage.setItem(KEY, tab);
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
  }, [tab]);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-[26px] leading-tight font-bold tracking-tight">{t("workouts.title")}</h1>
      <Segmented
        label={t("workouts.tabs.label")}
        labelHidden
        value={tab}
        onChange={(next) =>
          void navigate({ to: "/workouts", search: { tab: next }, replace: true })
        }
        options={[
          { value: "history", label: t("workouts.tabs.history") },
          { value: "program", label: t("workouts.tabs.program") },
          { value: "exercises", label: t("workouts.tabs.exercises") },
        ]}
      />
      {tab === "history" ? (
        <HistoryPanel />
      ) : tab === "program" ? (
        <ProgramPanel
          action={
            account.kind === "open"
              ? (s) => <StartButton account={account} code={s.code} />
              : undefined
          }
        />
      ) : (
        <ExercisesPanel />
      )}
    </section>
  );
}

// Start this session; while one is open, every session offers to resume it instead (§9.2).
function StartButton({ account, code }: { account: OpenAccount; code: string }) {
  const { t } = useTranslation();
  const history = useHistory(account).data;
  if (!history) return null;
  const open = openWorkout(history.workouts);
  return (
    <Button
      asChild
      size="lg"
      variant={open ? "outline" : "default"}
      className="w-full font-semibold"
    >
      <Link to="/workout" search={{ start: open?.sessionCode ?? code }}>
        {open ? t("workouts.program.resume") : t("workouts.program.start")}
      </Link>
    </Button>
  );
}
