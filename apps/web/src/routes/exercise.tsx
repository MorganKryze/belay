import "@/i18n/lazy";
import { exerciseById } from "@belay/shared/exercises/catalog";
import { loadSteps } from "@belay/shared/exercises/steps";
import { incrementIn } from "@belay/shared/tools/units";
import {
  byPosition,
  type LetteredTemplate,
  type StoredPrograms,
} from "@belay/shared/training/stored-program";
import type { Slot } from "@belay/shared/training/workout";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ExerciseLoop } from "@/components/exercise-loop";
import { BackLink, PageHeader } from "@/components/page-header";
import { cardSurface } from "@/components/surfaces";
import { BodyMap, BodySymbols } from "@/exercises/body-map";
import { formatNumber, sessionTitle } from "@/lib/format";
import { readWeightUnit } from "@/lib/units";
import { useAccount, useProgram } from "@/sync/account";
import { formatRest, formatRir, formatSets, groupKind } from "@/workouts/format";
import { NotFound } from "./fallbacks";

// A session that uses the exercise, at slot i: lettered in the active rotation (its preview opens
// by the letter), or set aside in the collection, where it has only its name.
type Use = {
  key: string;
  code: string | null;
  name: string | null;
  slots: readonly Slot[];
  i: number;
};

// The active rotation's sessions first, then the collection's live ones in their order; normal
// slots only, as the rotation's own list (a no-climbing slot is a session's conditional rule).
function usesOf(
  { programs, rotation }: { programs: StoredPrograms; rotation: readonly LetteredTemplate[] },
  exerciseId: string,
): Use[] {
  const live = programs.slots.filter((s) => !s.removed && s.rule === null).sort(byPosition);
  const sessions = [
    ...rotation.map((s) => ({ key: s.sessionId, code: s.code, name: s.name, slots: s.slots })),
    ...programs.sessions
      .filter((s) => s.programId === null && !s.removed)
      .sort(byPosition)
      .map((s) => ({
        key: s.id,
        code: null,
        name: s.name,
        slots: live
          .filter((x) => x.sessionId === s.id)
          .map((x): Slot => ({ ...x, rule: undefined })),
      })),
  ];
  return sessions.flatMap((s) =>
    s.slots.flatMap((slot, i) => (slot.exerciseId === exerciseId ? [{ ...s, i }] : [])),
  );
}

// An exercise's sheet (§4.5): its equipment, its demonstration loop where the instance has one,
// the body map, where the program uses it, and how to do it in the app's language.
export function ExercisePage() {
  const unit = readWeightUnit();
  const { t, i18n } = useTranslation();
  const { exerciseId } = useParams({ from: "/exercises/$exerciseId" });
  // Opened from a session's preview, Back leads to that preview, as it was opened.
  const { from, session } = useSearch({ from: "/exercises/$exerciseId" });
  const exercise = exerciseById(exerciseId);
  const account = useAccount();
  const program = useProgram(account.kind === "open" ? account : null).data;
  const steps = useQuery({
    queryKey: ["steps", i18n.language.startsWith("fr") ? "fr" : "en"],
    queryFn: () => loadSteps(i18n.language),
    staleTime: Infinity,
    networkMode: "always",
  });
  if (!exercise) return <NotFound />;
  // While the account opens, none: the starting program would show before the person's own.
  const uses = program && account.kind !== "loading" ? usesOf(program, exercise.id) : [];
  const how = steps.data?.[exercise.id] ?? [];

  return (
    <section className="flex flex-col gap-4">
      <BodySymbols />
      <PageHeader
        title={exercise.name}
        back={
          session ? (
            <BackLink
              to="/workouts/session/$code"
              params={{ code: session }}
              search={from === "home" ? { from } : {}}
            >
              {t("sessionBar.session", { code: session })}
            </BackLink>
          ) : (
            <BackLink to="/workouts" search={{ tab: "exercises" }}>
              {t("library.back")}
            </BackLink>
          )
        }
      >
        <p className="text-sm text-muted-foreground">
          {t("library.increment", {
            equipment: t(`library.equipment.${exercise.equipment}`),
            value: formatNumber(incrementIn(exercise, unit), i18n.language, { digits: 2 }),
            unit,
          })}
        </p>
      </PageHeader>
      <ExerciseLoop key={exercise.id} exerciseId={exercise.id} name={exercise.name} />
      <div className={`${cardSurface} p-4`}>
        <BodyMap primary={exercise.primary} secondary={exercise.secondary} />
      </div>
      {uses.map(({ key, code, name, slots, i }) => {
        const slot = slots[i]!;
        const kind = groupKind(slots, i);
        const body = (
          <span className="flex flex-col">
            <span className="font-semibold">
              {code ? sessionTitle(code, t) : (name ?? t("program.untitledSession"))}
            </span>
            <span className="text-[13px] text-muted-foreground">
              {[
                formatSets(slot),
                formatRir(slot, t),
                ...(slot.restSec > 0 ? [formatRest(slot.restSec, t)] : []),
                ...(kind ? [t(`workouts.program.${kind}`)] : []),
              ].join(" · ")}
            </span>
          </span>
        );
        const surface = `${cardSurface} flex min-h-16 items-center justify-between gap-2 px-4 py-3`;
        // A set-aside session has no letter, so no preview to open.
        return code ? (
          <Link
            key={`${key}${i}`}
            to="/workouts/session/$code"
            params={{ code }}
            className={surface}
          >
            {body}
            <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          </Link>
        ) : (
          <div key={`${key}${i}`} className={surface}>
            {body}
          </div>
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
