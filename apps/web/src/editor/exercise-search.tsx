import { newId } from "@belay/shared";
import { EXERCISES } from "@belay/shared/exercises/catalog";
import type { Exercise } from "@belay/shared/exercises/library";
import { addSlot, sectionOf } from "@belay/shared/training/program-edits";
import { Search } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BodyThumb } from "@/exercises/body-map";
import { filterExercises } from "@/exercises/exercises-panel";
import { readAdded } from "@/lib/editor-prefs";
import { type PlacedSession, useEditor } from "./editor-context";

const BY_NAME = [...EXERCISES].sort((a, b) => a.name.localeCompare(b.name, "en"));
// ponytail: the list draws the first 50 matches, enough for a query of a few letters; the header
// counts them all. Upgrade: draw the visible rows only if people scroll far into a short query.
const DRAWN = 50;

// The library filtered as the Exercises tab filters it, the names holding the query as typed first.
function found(query: string): Exercise[] {
  if (query.trim() === "") return [];
  const all = filterExercises(BY_NAME, { query, muscle: null, equipment: null });
  const phrase = query.trim().toLowerCase();
  const whole = (e: Exercise) => (e.name.toLowerCase().includes(phrase) ? 0 : 1);
  return all.sort((a, b) => whole(a) - whole(b));
}

// The card's search: « Ajouter un exercice » until something is typed, then the library's matches
// in a list just below. ↑ ↓ move the active option, Enter or a click adds it at the end of the
// session's normal section, and the field stays open, emptied, for the next one. / reaches it from
// anywhere but a field; the editor asks for it after adding a session.
export function ExerciseSearch({ placed }: { placed: PlacedSession }) {
  const { t } = useTranslation();
  const { edits, announce, search } = useEditor();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useId();
  const results = useMemo(() => found(query), [query]);
  const shown = results.slice(0, DRAWN);
  const optionId = (i: number) => `${list}-${i}`;
  const sessionId = placed.session.id;

  const asked = search.for === sessionId;
  const { done } = search;
  useEffect(() => {
    if (!asked) return;
    input.current?.focus();
    done();
  }, [asked, done]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const el = document.activeElement;
      if (
        el instanceof HTMLElement &&
        (el.isContentEditable || el.matches("input, textarea, select"))
      )
        return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (active >= 0)
      document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" });
  });

  const pick = (query: string) => {
    setQuery(query);
    setActive(-1);
  };
  const add = async (exercise: Exercise) => {
    const added = await edits.record(
      (p, at) => {
        // The last normal row, when new rows copy the row above.
        const like = readAdded() === "above" ? sectionOf(p, sessionId, null).at(-1) : undefined;
        return addSlot(p, newId(), sessionId, exercise, at, null, like);
      },
      { refused: t("editor.limit.slots") },
    );
    if (!added) return;
    pick("");
    announce(t("editor.search.added", { name: exercise.name }));
    input.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (shown.length === 0) return;
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive(Math.min(Math.max(active + step, 0), shown.length - 1));
    } else if (e.key === "Enter") {
      const chosen = shown[active] ?? shown[0];
      if (!chosen) return;
      e.preventDefault();
      void add(chosen);
    } else if (e.key === "Escape" && query !== "") {
      e.preventDefault();
      pick("");
    }
  };

  const expanded = open && query.trim() !== "";
  return (
    <div className="relative min-w-0">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={input}
        role="combobox"
        aria-label={t("editor.card.add")}
        aria-expanded={expanded}
        aria-controls={list}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        placeholder={t("editor.card.add")}
        value={query}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          pick(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="h-11 w-full min-w-0 rounded-field bg-track pr-3 pl-11 text-body outline-ring placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      />
      <div
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-field bg-popover text-popover-foreground shadow-float dark:border dark:border-border"
      >
        <p id={`${list}-head`} className="px-3 pt-2.5 pb-1.5 text-section text-muted-foreground">
          {results.length === 0
            ? t("editor.search.empty")
            : t("editor.search.results", { count: results.length, query: query.trim() })}
        </p>
        {/* Always drawn, so the field's aria-controls names it; empty, it shows nothing. */}
        <ul
          id={list}
          role="listbox"
          aria-labelledby={`${list}-head`}
          // Eight rows show; the others scroll.
          className="max-h-112 overflow-y-auto pb-1"
        >
          {shown.map((exercise, i) => (
            <li
              key={exercise.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              // The field keeps the focus: a click picks without leaving it.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void add(exercise)}
              className={`flex h-14 cursor-pointer items-center gap-3 px-3 ${i === active ? "bg-primary-soft" : ""}`}
            >
              <BodyThumb primary={exercise.primary[0]!} secondary={exercise.secondary} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body font-semibold">{exercise.name}</span>
                <span className="truncate text-sm text-muted-foreground">
                  {t("editor.grid.sub", {
                    muscle: t(`library.muscles.${exercise.primary[0]}`),
                    equipment: t(`library.equipment.${exercise.equipment}`),
                  })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
