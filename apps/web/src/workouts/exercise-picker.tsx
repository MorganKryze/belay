import { EXERCISES, exerciseById } from "@belay/shared/exercises/catalog";
import type { Exercise } from "@belay/shared/exercises/library";
import { alternativesOf } from "@belay/shared/training/program";
import { type History, lastTime } from "@belay/shared/training/rules";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sheet } from "@/components/sheet";
import { BodyThumb } from "@/exercises/body-map";
import { filterExercises } from "@/exercises/exercises-panel";
import { formatNumber } from "@/lib/format";

// The library in a sheet shows the first matches only: a few words narrow 1 291 exercises to a
// handful, and a sheet never lays out the whole list.
const SHOWN = 20;
const collator = new Intl.Collator("en");
const ALL = [...EXERCISES].sort((a, b) => collator.compare(a.name, b.name));

// Remplacer and « + Exercice » (spec §4.3): the program's alternatives first, with when each
// was last done, then the whole library by search. For this session only.
export function ExercisePicker({
  replacing,
  history,
  onPick,
  onClose,
}: {
  replacing: Exercise | null; // null: an exercise added at the end
  history: History;
  onPick: (exercise: Exercise) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState("");
  const found = useMemo(
    () =>
      query.trim() === "" ? [] : filterExercises(ALL, { query, muscle: null, equipment: null }),
    [query],
  );
  const alternatives = (replacing ? alternativesOf(replacing.id) : []).flatMap(
    (id) => exerciseById(id) ?? [],
  );
  const kg = (v: number) => formatNumber(v, i18n.language, { digits: 2 });
  // "la dernière fois 24 kg × 10", or "jamais faite".
  const last = (e: Exercise) => {
    const groups = lastTime(history, e.id, e.measure);
    if (groups.length === 0) return t("session.picker.never");
    const unit = e.measure === "seconds" ? "\u00a0s" : "";
    const value = groups
      .map((g) => `${g.weightKg > 0 ? `${kg(g.weightKg)} kg × ` : ""}${g.counts.join(", ")}${unit}`)
      .join(" · ");
    return t("session.picker.lastTime", { value });
  };
  const title = "text-[15px] font-semibold";
  return (
    <Sheet
      title={
        replacing
          ? t("session.picker.replaceTitle", { exercise: replacing.name })
          : t("session.picker.addTitle")
      }
      onClose={onClose}
    >
      {alternatives.length > 0 && (
        <section aria-labelledby="planned" className="flex flex-col">
          <h3 id="planned" className={title}>
            {t("session.picker.planned")}
          </h3>
          <ul>
            {alternatives.map((e) => (
              <li key={e.id}>
                <Choice exercise={e} aside={last(e)} onPick={onPick} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="library" className="flex flex-col gap-2">
        <h3 id="library" className={title}>
          {t(
            replacing && alternatives.length > 0
              ? "session.picker.orLibrary"
              : "session.picker.library",
          )}
        </h3>
        <label className="relative flex items-center">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3.5 size-5 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("library.search")}
            aria-label={t("library.search")}
            className="field w-full min-w-0 pr-4 pl-11 text-base"
          />
        </label>
        {query.trim() !== "" && (
          <p role="status" className="text-sm text-muted-foreground">
            {found.length > 0
              ? t("library.found", {
                  count: found.length,
                  value: formatNumber(found.length, i18n.language, { digits: 0 }),
                })
              : t("library.none")}
          </p>
        )}
        <ul>
          {found.slice(0, SHOWN).map((e) => (
            <li key={e.id}>
              <Choice exercise={e} onPick={onPick} />
            </li>
          ))}
        </ul>
      </section>
      <p className="text-[13px] text-muted-foreground">{t("session.picker.note")}</p>
    </Sheet>
  );
}

function Choice({
  exercise: e,
  aside,
  onPick,
}: {
  exercise: Exercise;
  aside?: string;
  onPick: (exercise: Exercise) => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => onPick(e)}
      className="flex min-h-16 w-full items-center gap-3 border-t border-border py-2 text-left"
    >
      <BodyThumb primary={e.primary[0]!} secondary={e.secondary} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">{e.name}</span>
        <span className="text-[13px] text-muted-foreground">
          {[
            t(`library.muscles.${e.primary[0]}`),
            t(`library.equipment.${e.equipment}`),
            ...(aside ? [aside] : []),
          ].join(" · ")}
        </span>
      </span>
    </button>
  );
}
