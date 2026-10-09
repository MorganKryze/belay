import "@/i18n/lazy";
import { exerciseById } from "@belay/shared/exercises/catalog";
import { loadSteps } from "@belay/shared/exercises/steps";
import { starterProgram } from "@belay/shared/training/program";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BodyMap, BodySymbols } from "@/exercises/body-map";
import { formatNumber, sessionTitle } from "@/lib/format";
import { formatRest, formatRir, formatSets, groupKind } from "@/workouts/format";
import { NotFound } from "./fallbacks";

const back = "-ml-1 inline-flex min-h-11 items-center gap-0.5 self-start font-medium text-primary";
const card = "rounded-card border border-border bg-card";

// An exercise's sheet (§4.5): its equipment, the body map, where the program uses it, and how
// to do it in the app's language.
export function ExercisePage() {
  const { t, i18n } = useTranslation();
  const { exerciseId } = useParams({ from: "/exercises/$exerciseId" });
  const exercise = exerciseById(exerciseId);
  const steps = useQuery({
    queryKey: ["steps", i18n.language.startsWith("fr") ? "fr" : "en"],
    queryFn: () => loadSteps(i18n.language),
    staleTime: Infinity,
    networkMode: "always",
  });
  if (!exercise) return <NotFound />;
  const uses = starterProgram.flatMap((s) =>
    s.slots.flatMap((slot, i) => (slot.exerciseId === exercise.id ? [{ s, slot, i }] : [])),
  );
  const how = steps.data?.[exercise.id] ?? [];

  return (
    <section className="flex flex-col gap-4">
      <BodySymbols />
      <div className="flex flex-col">
        <Link to="/workouts" search={{ tab: "exercises" }} className={back}>
          <ChevronLeft aria-hidden className="size-5" />
          {t("library.back")}
        </Link>
        <h1 className="text-[26px] leading-tight font-bold tracking-tight">{exercise.name}</h1>
        <p className="text-sm text-muted-foreground">
          {t("library.increment", {
            equipment: t(`library.equipment.${exercise.equipment}`),
            value: formatNumber(exercise.incrementKg, i18n.language, { digits: 2 }),
          })}
        </p>
      </div>
      <div className={`${card} p-4`}>
        <BodyMap primary={exercise.primary} secondary={exercise.secondary} />
      </div>
      {uses.map(({ s, slot, i }) => {
        const kind = groupKind(s.slots, i);
        return (
          <Link
            key={`${s.code}${i}`}
            to="/workouts"
            search={{ tab: "program" }}
            className={`${card} flex min-h-16 items-center justify-between gap-2 px-4 py-3`}
          >
            <span className="flex flex-col">
              <span className="font-semibold">{sessionTitle(s.code, t)}</span>
              <span className="text-[13px] text-muted-foreground">
                {[
                  formatSets(slot),
                  formatRir(slot, t),
                  ...(slot.restSec > 0 ? [formatRest(slot.restSec, t)] : []),
                  ...(kind ? [t(`workouts.program.${kind}`)] : []),
                ].join(" · ")}
              </span>
            </span>
            <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          </Link>
        );
      })}
      <section aria-labelledby="how" className="flex flex-col gap-2">
        <h2 id="how" className="text-[15px] font-semibold">
          {t("library.howTo")}
        </h2>
        {steps.isPending ? (
          <p className="text-sm text-muted-foreground">{t("library.loading")}</p>
        ) : (
          <ol className="flex list-decimal flex-col gap-2 pl-5 leading-relaxed">
            {how.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        )}
        <p className="text-xs text-muted-foreground">{t("library.credit")}</p>
      </section>
    </section>
  );
}
