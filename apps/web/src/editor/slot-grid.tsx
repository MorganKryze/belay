import { exerciseById } from "@belay/shared/exercises/catalog";
import type { WarmupCount } from "@belay/shared/tools/warmup";
import { editSlot, type SlotEdit } from "@belay/shared/training/program-edits";
import { parseCount, parseRange, parseRest, restClock } from "@belay/shared/training/slot-input";
import type { ProgramSlot } from "@belay/shared/training/stored-program";
import { MAX_WARMUPS, RIR_MAX, SLOT_BOUNDS } from "@belay/shared/training/workout";
import type { TFunction } from "i18next";
import { Check, Link2, Mountain } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { FieldError } from "@/components/field-error";
import { LoopThumb } from "@/components/loop-thumb";
import { BodyThumb } from "@/exercises/body-map";
import { readHelp, readRestStyle, readThumbs } from "@/lib/editor-prefs";
import { formatRange, formatRest } from "@/workouts/format";
import { isMac, type PlacedSession, titleOf, useEditor } from "./editor-context";

// The eight columns: the exercise takes what the fixed value columns leave. The table keeps a
// minimum width, so a narrow window scrolls it inside its card.
const COLUMNS =
  "grid min-w-3xl grid-cols-[minmax(12rem,1fr)_4.25rem_5.25rem_4.25rem_6rem_4.5rem_4.75rem_2.75rem] items-center gap-x-1.5 pr-2.5 pl-4";
const COLUMN_KEYS = ["exercise", "sets", "reps", "rir", "rest", "warmups", "main", "actions"];
const ring = "outline-ring focus-visible:outline-2 -outline-offset-2";
const value = `relative grid h-11 place-items-center rounded-chip bg-track font-semibold whitespace-nowrap ${ring}`;
const opened =
  "relative grid h-11 place-items-center rounded-chip bg-card font-semibold ring-2 ring-primary ring-inset";
const line = "col-span-full flex items-center gap-2 text-section text-muted-foreground";

// The cells the keyboard reaches in a row, left to right; all but Principal open as a field.
const CELLS = ["sets", "reps", "rir", "rest", "warmups", "main"] as const;
type Cell = (typeof CELLS)[number];
type TextCell = Exclude<Cell, "main">;

interface Row {
  slot: ProgramSlot;
  grouped: boolean;
  rests: boolean;
}
interface Draft {
  key: string;
  text: string;
  error: string | null;
}
const keyOf = (slotId: string, cell: Cell) => `${slotId}:${cell}`;
// Only the last slot of a group rests, so the others' rest is no field.
const opens = (row: Row, cell: Cell): cell is TextCell =>
  cell !== "main" && (cell !== "rest" || row.rests);

// Where a slot sits in its group: chained slots share a group key with a neighbour; only the last
// of a group rests, the others go straight to the next exercise.
function groupPlace(slots: readonly ProgramSlot[], i: number) {
  const key = slots[i]!.groupKey;
  if (key === null) return { grouped: false, first: false, last: false };
  const before = slots[i - 1]?.groupKey === key;
  const after = slots[i + 1]?.groupKey === key;
  return { grouped: before || after, first: !before && after, last: before && !after };
}
const rowsOf = (slots: readonly ProgramSlot[]): Row[] =>
  slots.map((slot, i) => {
    const place = groupPlace(slots, i);
    return { slot, grouped: place.grouped, rests: !place.grouped || place.last };
  });

// A range as one types it, « 6-10 », or « 8 » for one number.
const typed = ([min, max]: readonly [number, number]) => (min === max ? `${min}` : `${min}-${max}`);
function draftOf(slot: ProgramSlot, cell: TextCell): string {
  if (cell === "reps") return typed(slot.repRange);
  if (cell === "rir") return typed(slot.rirTarget);
  if (cell === "rest") return restClock(slot.restSec);
  return String(cell === "sets" ? slot.sets : slot.warmupSets);
}

// The text of a field read for its slot: the edit to save, or the key of the error to show.
function read(slot: ProgramSlot, cell: TextCell, text: string): SlotEdit | string {
  const timed = slot.measure === "seconds";
  switch (cell) {
    case "sets": {
      const v = parseCount(text, 1, SLOT_BOUNDS.sets);
      return v === null ? "editor.cell.sets" : { field: "sets", value: v };
    }
    case "reps": {
      const v = parseRange(text, 1, timed ? SLOT_BOUNDS.seconds : SLOT_BOUNDS.reps);
      return v === null ? `editor.cell.${timed ? "seconds" : "reps"}` : { field: "reps", value: v };
    }
    case "rir": {
      const v = parseRange(text, 0, RIR_MAX);
      return v === null ? "editor.cell.rir" : { field: "rir", value: v };
    }
    case "rest": {
      const v = parseRest(text);
      return v === null ? "editor.cell.rest" : { field: "rest", value: v };
    }
    case "warmups": {
      // A timed exercise has no warm-up sets.
      const v = parseCount(text, 0, timed ? 0 : MAX_WARMUPS);
      if (v === null) return `editor.cell.${timed ? "warmupsTimed" : "warmups"}`;
      // Read within 0 to 3 just above, which the type system cannot follow.
      return { field: "warmups", value: v as WarmupCount };
    }
  }
}
const CURRENT = {
  sets: (s: ProgramSlot) => s.sets,
  reps: (s: ProgramSlot) => s.repRange,
  rir: (s: ProgramSlot) => s.rirTarget,
  rest: (s: ProgramSlot) => s.restSec,
  warmups: (s: ProgramSlot) => s.warmupSets,
};
const same = (slot: ProgramSlot, cell: TextCell, edit: SlotEdit) =>
  JSON.stringify(CURRENT[cell](slot)) === JSON.stringify(edit.value);

function shownValue(slot: ProgramSlot, cell: TextCell, t: TFunction): string {
  if (cell === "sets") return String(slot.sets);
  if (cell === "warmups") return String(slot.warmupSets);
  if (cell === "rir") return formatRange(slot.rirTarget);
  if (cell === "rest")
    return readRestStyle() === "clock" ? restClock(slot.restSec) : formatRest(slot.restSec, t);
  const range = formatRange(slot.repRange);
  return slot.measure === "seconds" ? t("editor.grid.seconds", { range }) : range;
}

// The shown session's slots as a grid with one Tab stop: arrows move from cell to cell, Enter or a
// click opens a cell as a field, Enter saves and stays, Tab saves and opens the next, Escape
// restores. A value that cannot be read keeps its field open with the reason and saves nothing.
export function SlotGrid({ placed }: { placed: PlacedSession }) {
  const { t } = useTranslation();
  const { edits } = useEditor();
  // Edits are written one after the other, so undo takes them back in the order they were made:
  // Tab saves a field and opens the next before the first write has landed.
  const latest = useRef(edits);
  latest.current = edits;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const write = (slotId: string, edit: SlotEdit) => {
    queue.current = queue.current.then(() =>
      latest.current.record((p, at) => editSlot(p, slotId, edit, at)),
    );
  };
  const grid = useRef<HTMLDivElement>(null);
  const normal = rowsOf(placed.slots);
  const noClimbing = rowsOf(placed.noClimbing);
  const rows = [...normal, ...noClimbing];
  const [focus, setFocus] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // The field whose leaving still counts: a field left by Enter, Tab or Escape is settled already.
  const live = useRef<string | null>(null);
  const refocus = useRef<string | null>(null);
  const first = rows[0] && keyOf(rows[0].slot.id, "sets");
  const stop =
    focus !== null && rows.some((r) => focus.startsWith(`${r.slot.id}:`)) ? focus : first;

  const focusCell = (key: string) =>
    grid.current?.querySelector<HTMLElement>(`[data-cell="${key}"]`)?.focus();
  // A field closed from the keyboard hands the focus back to its cell once it is gone.
  useLayoutEffect(() => {
    if (draft !== null || refocus.current === null) return;
    focusCell(refocus.current);
    refocus.current = null;
  }, [draft]);

  const openCell = (row: Row, cell: TextCell) => {
    const key = keyOf(row.slot.id, cell);
    live.current = key;
    setFocus(key);
    setDraft({ key, text: draftOf(row.slot, cell), error: null });
  };
  const close = (key: string) => {
    live.current = null;
    refocus.current = key;
    setDraft(null);
  };
  const commit = (row: Row, cell: TextCell, edit: SlotEdit) => {
    if (!same(row.slot, cell, edit)) write(row.slot.id, edit);
  };
  // False, the field kept open with its reason, when the text cannot be read.
  const save = (row: Row, cell: TextCell, text: string): boolean => {
    const edit = read(row.slot, cell, text);
    if (typeof edit === "string") {
      setDraft({ key: keyOf(row.slot.id, cell), text, error: t(edit) });
      return false;
    }
    commit(row, cell, edit);
    return true;
  };
  const toggle = (slot: ProgramSlot) => write(slot.id, { field: "main", value: !slot.isMain });

  // The next field after a cell in reading order, or before it with Shift.
  const fieldAfter = (r: number, c: number, back: boolean) => {
    const order = rows.flatMap((row) => CELLS.map((cell) => ({ row, cell })));
    const at = r * CELLS.length + c;
    const rest = back ? order.slice(0, at).reverse() : order.slice(at + 1);
    for (const { row, cell } of rest) if (opens(row, cell)) return { row, cell };
    return null;
  };

  const onCellKey = (e: KeyboardEvent<HTMLElement>, r: number, c: number) => {
    if (e.target !== e.currentTarget) return;
    const row = rows[r]!;
    const cell = CELLS[c]!;
    const to: Partial<Record<string, [number, number]>> = {
      ArrowRight: [r, Math.min(c + 1, CELLS.length - 1)],
      ArrowLeft: [r, Math.max(c - 1, 0)],
      ArrowDown: [Math.min(r + 1, rows.length - 1), c],
      ArrowUp: [Math.max(r - 1, 0), c],
      Home: [r, 0],
      End: [r, CELLS.length - 1],
    };
    const move = to[e.key];
    if (move) {
      e.preventDefault();
      focusCell(keyOf(rows[move[0]]!.slot.id, CELLS[move[1]]!));
    } else if (cell === "main" && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      toggle(row.slot);
    } else if (e.key === "Enter" && opens(row, cell)) {
      e.preventDefault();
      openCell(row, cell);
    }
  };

  const onFieldKey = (e: KeyboardEvent<HTMLInputElement>, row: Row, r: number, c: number) => {
    const cell = CELLS[c] as TextCell;
    const key = keyOf(row.slot.id, cell);
    if (e.key === "Escape") {
      e.preventDefault();
      close(key);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (save(row, cell, e.currentTarget.value)) close(key);
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (!save(row, cell, e.currentTarget.value)) return;
      const next = fieldAfter(r, c, e.shiftKey);
      if (next) openCell(next.row, next.cell);
      else close(key);
    }
  };
  // Leaving a field by a click elsewhere keeps a readable value and drops any other.
  const onFieldBlur = (key: string, row: Row, cell: TextCell, text: string) => {
    if (live.current !== key) return;
    live.current = null;
    const edit = read(row.slot, cell, text);
    if (typeof edit !== "string") commit(row, cell, edit);
    setDraft(null);
  };

  const cells = (row: Row, r: number) =>
    CELLS.map((cell, c) => {
      const key = keyOf(row.slot.id, cell);
      const focusable = {
        "data-cell": key,
        tabIndex: key === stop ? 0 : -1,
        onFocus: () => setFocus(key),
        onKeyDown: (e: KeyboardEvent<HTMLElement>) => onCellKey(e, r, c),
      };
      if (cell === "main")
        return <MainCell key={cell} slot={row.slot} focusable={focusable} onToggle={toggle} />;
      if (!opens(row, cell))
        return (
          <span
            key={cell}
            role="gridcell"
            {...focusable}
            className={`grid h-11 place-items-center rounded-chip font-medium text-muted-foreground ${ring}`}
          >
            {t("editor.grid.noRest")}
          </span>
        );
      const open = draft?.key === key ? draft : null;
      return (
        <span
          key={cell}
          role="gridcell"
          {...focusable}
          onClick={() => {
            if (!open) openCell(row, cell);
          }}
          className={open ? opened : value}
        >
          {open ? (
            <Field
              draft={open}
              label={t(`editor.col.${cell}`)}
              above={r === rows.length - 1}
              inputMode={cell === "sets" || cell === "warmups" ? "numeric" : "text"}
              onChange={(text) => setDraft({ ...open, text })}
              onKeyDown={(e) => onFieldKey(e, row, r, c)}
              onBlur={(text) => onFieldBlur(key, row, cell, text)}
            />
          ) : (
            shownValue(row.slot, cell, t)
          )}
        </span>
      );
    });

  return (
    <div
      ref={grid}
      role="grid"
      aria-label={t("editor.grid.label", { session: titleOf(placed, t) })}
      // Positioned, so what is drawn out of the flow (a column's hidden name, a field's reason)
      // scrolls with the table inside its card instead of widening the page.
      className="relative tabular-nums"
    >
      <div role="rowgroup">
        <div role="row" className={`${COLUMNS} min-h-8.5 border-t border-border`}>
          {COLUMN_KEYS.map((key, i) => (
            <span
              key={key}
              role="columnheader"
              className={`text-section text-muted-foreground ${i === 0 ? "text-left" : "text-center"}`}
            >
              {key === "actions" ? (
                <span className="sr-only">{t("editor.col.actions")}</span>
              ) : (
                t(`editor.col.${key}`)
              )}
            </span>
          ))}
        </div>
      </div>
      <Rows rows={normal} cells={(row, i) => cells(row, i)} />
      {noClimbing.length > 0 && (
        <div role="rowgroup" aria-label={t("editor.grid.noClimbing")}>
          <div role="row" className="grid min-w-3xl">
            <span
              role="gridcell"
              className={`${line} min-h-11 border-t border-border px-4 pt-2.5 pb-1.5`}
            >
              <Mountain aria-hidden className="size-4" />
              {t("editor.grid.noClimbing")}
            </span>
          </div>
          <Rows rows={noClimbing} cells={(row, i) => cells(row, normal.length + i)} />
        </div>
      )}
    </div>
  );
}

// An open cell: its value selected when it opens, so typing replaces it, and the reason under it
// (above it on the last row, which the card would cut) when the value cannot be read.
function Field({
  draft,
  label,
  above,
  inputMode,
  onChange,
  onKeyDown,
  onBlur,
}: {
  draft: Draft;
  label: string;
  above: boolean;
  inputMode: "numeric" | "text";
  onChange(text: string): void;
  onKeyDown(e: KeyboardEvent<HTMLInputElement>): void;
  onBlur(text: string): void;
}) {
  const errorId = useId();
  return (
    <>
      <input
        ref={(el) => {
          if (!el || document.activeElement === el) return;
          el.focus();
          el.select();
        }}
        value={draft.text}
        aria-label={label}
        aria-invalid={draft.error !== null}
        aria-describedby={draft.error === null ? undefined : errorId}
        inputMode={inputMode}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={(e) => onBlur(e.target.value)}
        className="size-full min-w-0 rounded-chip bg-transparent text-center font-semibold outline-none"
      />
      {draft.error !== null && (
        <span
          className={`absolute left-1/2 z-10 w-56 -translate-x-1/2 rounded-field bg-popover p-2.5 font-normal whitespace-normal shadow-float ${
            above ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          <FieldError id={errorId}>{draft.error}</FieldError>
        </span>
      )}
    </>
  );
}

interface Focusable {
  "data-cell": string;
  tabIndex: number;
  onFocus(): void;
  onKeyDown(e: KeyboardEvent<HTMLElement>): void;
}

// Principal is a box ticked by Space, Enter or a click, never a field.
function MainCell({
  slot,
  focusable,
  onToggle,
}: {
  slot: ProgramSlot;
  focusable: Focusable;
  onToggle(slot: ProgramSlot): void;
}) {
  const { t } = useTranslation();
  return (
    <span role="gridcell" className="grid place-items-center">
      <span
        role="checkbox"
        aria-checked={slot.isMain}
        aria-label={t("editor.grid.main")}
        {...focusable}
        onClick={() => onToggle(slot)}
        className={`grid size-11 cursor-pointer place-items-center rounded-control ${ring}`}
      >
        <span
          className={`grid size-5.5 place-items-center rounded-icon ${
            slot.isMain
              ? "bg-primary text-primary-foreground"
              : "ring-[1.5px] ring-input ring-inset"
          }`}
        >
          {slot.isMain && <Check aria-hidden className="size-4" strokeWidth={3} />}
        </span>
      </span>
    </span>
  );
}

function Rows({
  rows,
  cells,
}: {
  rows: readonly Row[];
  cells: (row: Row, index: number) => ReactNode;
}) {
  const { t } = useTranslation();
  const slots = rows.map((r) => r.slot);
  return (
    <div role="rowgroup">
      {rows.flatMap((row, i) => {
        const slotRow = (
          <SlotRow key={row.slot.id} slot={row.slot} grouped={row.grouped}>
            {cells(row, i)}
          </SlotRow>
        );
        if (!groupPlace(slots, i).first) return [slotRow];
        return [
          <div key={`${row.slot.id}-group`} role="row" className="grid min-w-3xl">
            <span role="gridcell" className={`${line} min-h-8.5 pt-2 pl-4`}>
              <Link2 aria-hidden className="size-4" />
              {t("editor.grid.group")}
            </span>
          </div>,
          slotRow,
        ];
      })}
    </div>
  );
}

function SlotRow({
  slot,
  grouped,
  children,
}: {
  slot: ProgramSlot;
  grouped: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const exercise = exerciseById(slot.exerciseId);
  return (
    <div
      role="row"
      className={`${COLUMNS} relative min-h-15 border-t border-border ${
        grouped
          ? "before:absolute before:inset-y-0 before:left-1.5 before:w-0.5 before:rounded-full before:bg-muted-foreground"
          : ""
      }`}
    >
      <span role="gridcell" className="flex min-w-0 items-center gap-3 py-2">
        {exercise && readThumbs() === "shown" && (
          <LoopThumb
            exerciseId={exercise.id}
            fallback={<BodyThumb primary={exercise.primary[0]!} secondary={exercise.secondary} />}
          />
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body font-semibold">
            {exercise?.name ?? slot.exerciseId}
          </span>
          {exercise && (
            <span className="truncate text-(length:--text-secondary) leading-(--text-secondary--line-height) text-muted-foreground">
              {t("editor.grid.sub", {
                muscle: t(`library.muscles.${exercise.primary[0]}`),
                equipment: t(`library.equipment.${exercise.equipment}`),
              })}
            </span>
          )}
        </span>
      </span>
      {children}
      <span role="gridcell" />
    </div>
  );
}

// The grid's keys, under the card: always, or only while a cell has the focus when the person
// chose so. The undo key is the system's.
export function GridHelp() {
  const { t } = useTranslation();
  const always = readHelp() === "always";
  const [inGrid, setInGrid] = useState(false);
  useEffect(() => {
    if (always) return;
    const track = (e: FocusEvent) => {
      const to = e.type === "focusin" ? e.target : e.relatedTarget;
      setInGrid(to instanceof Element && to.closest("[role=grid]") !== null);
    };
    document.addEventListener("focusin", track);
    document.addEventListener("focusout", track);
    return () => {
      document.removeEventListener("focusin", track);
      document.removeEventListener("focusout", track);
    };
  }, [always]);
  if (!always && !inGrid) return null;
  return (
    <p className="min-h-11 px-1 py-2.5 text-sm text-muted-foreground">
      <Key>↑</Key>
      <Key>↓</Key>
      <Key>←</Key>
      <Key>→</Key> {t("editor.help.move")} · <Key>{t("editor.help.enter")}</Key>{" "}
      {t("editor.help.edit")} · <Key>{isMac() ? "⌘" : "Ctrl"}</Key> <Key>Z</Key>{" "}
      {t("editor.help.undo")}
    </p>
  );
}

const Key = ({ children }: { children: ReactNode }) => (
  <kbd className="mx-0.5 rounded-icon bg-track px-1.5 py-px font-sans font-semibold text-foreground">
    {children}
  </kbd>
);
