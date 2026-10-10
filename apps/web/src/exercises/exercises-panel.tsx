import { EXERCISES } from "@belay/shared/exercises/catalog";
import type { Exercise } from "@belay/shared/exercises/library";
import {
  EQUIPMENT,
  type Equipment,
  LOWER_MUSCLES,
  type Muscle,
  UPPER_MUSCLES,
} from "@belay/shared/exercises/muscles";
import { starterProgram } from "@belay/shared/training/program";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { type ReactNode, type RefObject, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sheet } from "@/components/sheet";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { BodySymbols, BodyThumb } from "./body-map";

// Case, accents and word order aside: "press bench" finds "Barbell bench press".
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
export function matches(name: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const target = fold(name);
  return words.every((w) => target.includes(w));
}

const byName = (a: Exercise, b: Exercise) => a.name.localeCompare(b.name, "en");
const ALL = [...EXERCISES].sort(byName);
// The sessions of the program each exercise is in: "A", "A · C".
const SESSIONS = new Map<string, string[]>();
for (const s of starterProgram)
  for (const slot of s.slots) {
    const codes = SESSIONS.get(slot.exerciseId) ?? [];
    if (!codes.includes(s.code)) SESSIONS.set(slot.exerciseId, [...codes, s.code]);
  }
const IN_PROGRAM = [...SESSIONS.keys()].flatMap((id) => EXERCISES.filter((e) => e.id === id));

type Filters = { query: string; muscle: Muscle | null; equipment: Equipment | null };
export const filterExercises = (list: readonly Exercise[], f: Filters) =>
  list.filter(
    (e) =>
      matches(e.name, f.query) &&
      (f.muscle === null || e.primary.includes(f.muscle)) &&
      (f.equipment === null || e.equipment === f.equipment),
  );

const sectionTitle = "mx-0.5 mt-2 text-[15px] font-semibold";

// Exercises (§4.5): search, a muscle and an equipment filter, the program's exercises first.
export function ExercisesPanel() {
  const { t, i18n } = useTranslation();
  const [filters, setFilters] = useState<Filters>({ query: "", muscle: null, equipment: null });
  const [open, setOpen] = useState<"muscle" | "equipment" | null>(null);
  const filtered = useMemo(() => filterExercises(ALL, filters), [filters]);
  const narrowed =
    filters.query.trim() !== "" || filters.muscle !== null || filters.equipment !== null;
  const count = (n: number) => formatNumber(n, i18n.language, { digits: 0 });

  return (
    <div className="flex flex-col gap-3">
      <BodySymbols />
      <label className="relative flex items-center">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3.5 size-5 text-muted-foreground"
        />
        <input
          type="search"
          value={filters.query}
          onChange={(e) => setFilters({ ...filters, query: e.target.value })}
          placeholder={t("library.search")}
          aria-label={t("library.search")}
          className="min-h-12 w-full min-w-0 rounded-field border border-input bg-card pr-4 pl-11 text-base outline-offset-2"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <FilterButton
          label={t("library.muscle")}
          value={filters.muscle && t(`library.muscles.${filters.muscle}`)}
          onOpen={() => setOpen("muscle")}
          onClear={() => setFilters({ ...filters, muscle: null })}
        />
        <FilterButton
          label={t("library.equipmentLabel")}
          value={filters.equipment && t(`library.equipment.${filters.equipment}`)}
          onOpen={() => setOpen("equipment")}
          onClear={() => setFilters({ ...filters, equipment: null })}
        />
      </div>
      {narrowed ? (
        <>
          <p role="status" className="mx-0.5 text-sm text-muted-foreground">
            {filtered.length > 0
              ? t("library.found", { count: filtered.length, value: count(filtered.length) })
              : t("library.none")}
          </p>
          <ExerciseList items={filtered} />
        </>
      ) : (
        <>
          <h2 className={sectionTitle}>{t("library.inProgram")}</h2>
          <ul className="flex flex-col">
            {IN_PROGRAM.map((e) => (
              <li key={e.id}>
                <Row exercise={e} />
              </li>
            ))}
          </ul>
          <h2 className={sectionTitle}>{t("library.everything", { value: count(ALL.length) })}</h2>
          <ExerciseList items={ALL} />
        </>
      )}
      {open === "muscle" && (
        <ChoiceSheet
          title={t("library.muscle")}
          groups={[
            { label: t("library.upper"), values: UPPER_MUSCLES },
            { label: t("library.lower"), values: LOWER_MUSCLES },
          ]}
          name={(m) => t(`library.muscles.${m}`)}
          value={filters.muscle}
          count={(m) => filterExercises(ALL, { ...filters, muscle: m }).length}
          onApply={(muscle) => {
            setFilters({ ...filters, muscle });
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {open === "equipment" && (
        <ChoiceSheet
          title={t("library.equipmentLabel")}
          groups={[{ label: null, values: EQUIPMENT }]}
          name={(e) => t(`library.equipment.${e}`)}
          value={filters.equipment}
          count={(e) => filterExercises(ALL, { ...filters, equipment: e }).length}
          onApply={(equipment) => {
            setFilters({ ...filters, equipment });
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function FilterButton({
  label,
  value,
  onOpen,
  onClear,
}: {
  label: string;
  value: string | null;
  onOpen: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const chip = "inline-flex min-h-11 items-center gap-1 rounded-chip border px-3 font-semibold";
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={value ? t("library.filtered", { label, value }) : undefined}
        onClick={onOpen}
        className={
          value
            ? `${chip} border-foreground bg-foreground text-background`
            : `${chip} border-border bg-card`
        }
      >
        {value ?? label}
        <ChevronDown aria-hidden className="size-4" />
      </button>
      {value && (
        <button
          type="button"
          onClick={onClear}
          aria-label={t("library.clearFilter", { name: value })}
          className="grid size-11 place-items-center rounded-chip text-muted-foreground"
        >
          <X aria-hidden className="size-5" />
        </button>
      )}
    </span>
  );
}

// One choice among a few groups of chips; "All" first. The button says how many will show.
function ChoiceSheet<T extends string>({
  title,
  groups,
  name,
  value,
  count,
  onApply,
  onClose,
}: {
  title: string;
  groups: { label: string | null; values: readonly T[] }[];
  name: (value: T) => string;
  value: T | null;
  count: (value: T | null) => number;
  onApply: (value: T | null) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [chosen, setChosen] = useState<T | null>(value);
  const chip =
    "min-h-11 rounded-chip border border-border bg-card px-3.5 font-semibold data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background";
  const n = count(chosen);
  return (
    <Sheet title={title} onClose={onClose}>
      <RadioGroup.Root
        aria-label={title}
        value={chosen ?? "all"}
        onValueChange={(v) => setChosen(v === "all" ? null : (v as T))}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap gap-2">
          <RadioGroup.Item value="all" className={chip}>
            {t("library.all")}
          </RadioGroup.Item>
        </div>
        {groups.map((g, i) => (
          <div key={i} className="flex flex-col gap-2">
            {g.label && <span className="text-[13px] text-muted-foreground">{g.label}</span>}
            <div className="flex flex-wrap gap-2">
              {g.values.map((v) => (
                <RadioGroup.Item key={v} value={v} className={chip}>
                  {name(v)}
                </RadioGroup.Item>
              ))}
            </div>
          </div>
        ))}
      </RadioGroup.Root>
      <Button size="lg" className="mt-1 w-full font-semibold" onClick={() => onApply(chosen)}>
        {t("library.show", { count: n, value: formatNumber(n, i18n.language, { digits: 0 }) })}
      </Button>
    </Sheet>
  );
}

const ROW = 72; // px, every row the same height: the list only renders what is on screen

// The rows on screen, plus a few: 1 290 rows would take seconds to lay out on a phone.
function useVisibleRange(list: RefObject<HTMLElement | null>, count: number) {
  const [range, setRange] = useState({ start: 0, end: Math.min(count, 24) });
  useLayoutEffect(() => {
    const update = () => {
      const top = list.current?.getBoundingClientRect().top ?? 0;
      const overscan = 8;
      const start = Math.max(0, Math.floor(-top / ROW) - overscan);
      const end = Math.min(count, Math.ceil((window.innerHeight - top) / ROW) + overscan);
      setRange((r) => (r.start === start && r.end === end ? r : { start, end }));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [list, count]);
  return range;
}

export function ExerciseList({ items }: { items: readonly Exercise[] }) {
  const list = useRef<HTMLUListElement>(null);
  const { start, end } = useVisibleRange(list, items.length);
  return (
    <ul ref={list} className="relative" style={{ height: items.length * ROW }}>
      {items.slice(start, end).map((e, i) => (
        <li
          key={e.id}
          aria-setsize={items.length}
          aria-posinset={start + i + 1}
          className="absolute inset-x-0"
          style={{ top: (start + i) * ROW, height: ROW }}
        >
          <Row exercise={e} />
        </li>
      ))}
    </ul>
  );
}

function Row({ exercise: e }: { exercise: Exercise }) {
  const { t } = useTranslation();
  const codes = SESSIONS.get(e.id);
  const aside: ReactNode = codes ? (
    <span className="shrink-0 rounded-chip bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary-ink">
      <span className="sr-only">{t("library.inSessions")} </span>
      {codes.join(" · ")}
    </span>
  ) : (
    <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
  );
  return (
    <Link
      to="/exercises/$exerciseId"
      params={{ exerciseId: e.id }}
      className="flex h-[72px] items-center gap-3 border-t border-border px-0.5"
    >
      <BodyThumb primary={e.primary[0]!} secondary={e.secondary} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold">{e.name}</span>
        <span className="truncate text-[13px] text-muted-foreground">
          {t(`library.muscles.${e.primary[0]}`)} · {t(`library.equipment.${e.equipment}`)}
        </span>
      </span>
      {aside}
    </Link>
  );
}
