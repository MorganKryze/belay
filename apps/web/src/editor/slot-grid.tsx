import { exerciseById } from "@belay/shared/exercises/catalog";
import { newId } from "@belay/shared";
import type { WarmupCount } from "@belay/shared/tools/warmup";
import type { ProgramEdit } from "@belay/shared/training/program-undo";
import {
  chainWithNext,
  copySlot,
  editSlot,
  leaveGroup,
  removeSlot,
  type SlotEdit,
  sectionOf,
} from "@belay/shared/training/program-edits";
import { parseCount, parseRange, parseRest, restClock } from "@belay/shared/training/slot-input";
import {
  moveNotes,
  placeSlot,
  type Stop,
  slotStops,
  stopOf,
} from "@belay/shared/training/slot-moves";
import {
  byPosition,
  type ProgramSlot,
  type StoredPrograms,
} from "@belay/shared/training/stored-program";
import { MAX_WARMUPS, RIR_MAX, SLOT_BOUNDS } from "@belay/shared/training/workout";
import type { TFunction } from "i18next";
import {
  Check,
  Copy,
  Ellipsis,
  GripVertical,
  Link2,
  Mountain,
  Trash2,
  Unlink2,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { FieldError } from "@/components/field-error";
import { LoopThumb } from "@/components/loop-thumb";
import { BodyThumb } from "@/exercises/body-map";
import { readHelp, readRestStyle, readThumbs } from "@/lib/editor-prefs";
import { formatRange, formatRest } from "@/workouts/format";
import { type EditOptions } from "./use-edits";
import { isMac, type PlacedSession, titleOf, useEditor } from "./editor-context";

// The eight columns: the exercise takes what the fixed value columns leave. The table keeps a
// minimum width, so a narrow window scrolls it inside its card.
const COLUMNS =
  "grid min-w-3xl grid-cols-[minmax(15rem,1fr)_4.25rem_5.25rem_4.25rem_6rem_4.5rem_4.75rem_2.75rem] items-center gap-x-1.5 pr-2.5 pl-1";
const COLUMN_KEYS = ["exercise", "sets", "reps", "rir", "rest", "warmups", "main", "actions"];
const ring = "outline-ring focus-visible:outline-2 -outline-offset-2";
const value = `relative grid h-11 place-items-center rounded-chip bg-track font-semibold whitespace-nowrap ${ring}`;
const opened =
  "relative grid h-11 place-items-center rounded-chip bg-card font-semibold ring-2 ring-primary ring-inset";
const line = "col-span-full flex items-center gap-2 text-section text-muted-foreground";

// The cells the keyboard reaches in a row, left to right: the handle, the values (all but Principal
// open as a field) and the ⋯.
const CELLS = ["handle", "sets", "reps", "rir", "rest", "warmups", "main", "more"] as const;
type Cell = (typeof CELLS)[number];
type TextCell = Exclude<Cell, "handle" | "main" | "more">;

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
  cell !== "handle" && cell !== "main" && cell !== "more" && (cell !== "rest" || row.rests);

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

interface Lift {
  id: string;
  stop: number; // in the row's stops
  by: "key" | "pointer";
}
// A row just dropped, shown where it landed until the programs read again hold the move.
interface Held {
  id: string;
  stop: Stop;
  programs: StoredPrograms;
}
// Where the rows sat when a drag began, in page coordinates: each section's row midpoints, the
// lifted row left out, the grid's top and bottom and the top of the no-climbing section.
interface Geometry {
  normal: number[];
  noClimbing: number[];
  top: number;
  noClimbingTop: number;
  bottom: number;
}

const applied = (s: ProgramSlot, c: ProgramEdit): ProgramSlot => {
  if (c.kind !== "programSlot" || c.id !== s.id) return s;
  if (c.field === "position") return { ...s, position: c.value };
  if (c.field === "group") return { ...s, groupKey: c.value };
  if (c.field === "rule") return { ...s, rule: c.value };
  return s;
};
// The session as it reads with the row at a stop: what the grid shows while a row is lifted.
function arranged(p: StoredPrograms, sessionId: string, id: string, stop: Stop) {
  const changes = placeSlot(p, id, stop, "") ?? [];
  const own = p.slots
    .filter((s) => s.sessionId === sessionId && !s.removed)
    .map((s) => changes.reduce(applied, s))
    .sort(byPosition);
  return {
    slots: own.filter((s) => s.rule === null),
    noClimbing: own.filter((s) => s.rule === "no_climbing"),
  };
}

// The stop under the pointer: the gap between the row midpoints it falls in, then, where a gap
// offers more than one stop (a group's edge), the stops share the gap from top to bottom, so the
// upper half of the gap above a group is outside it and the lower half inside.
function stopAt(g: Geometry, stops: readonly Stop[], y: number, current: number): number {
  const rule = y >= g.noClimbingTop ? "no_climbing" : null;
  const mids = rule ? g.noClimbing : g.normal;
  const index = mids.filter((m) => m < y).length;
  const here = stops.flatMap((s, i) => (s.rule === rule && s.index === index ? [i] : []));
  if (here.length === 0) return current;
  const lo = mids[index - 1] ?? (rule ? g.noClimbingTop : g.top);
  const hi = mids[index] ?? (rule ? g.bottom : Math.min(g.noClimbingTop, g.bottom));
  const share = Math.min(Math.max((y - lo) / Math.max(hi - lo, 1), 0), 0.999);
  return here[Math.floor(share * here.length)]!;
}

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// The shown session's slots as a grid with one Tab stop: arrows move from cell to cell, Enter or a
// click opens a cell as a field, Enter saves and stays, Tab saves and opens the next, Escape
// restores. A value that cannot be read keeps its field open with the reason and saves nothing.
export function SlotGrid({ placed }: { placed: PlacedSession }) {
  const { t } = useTranslation();
  const { edits, programs, announce } = useEditor();
  // Edits are written one after the other, so undo takes them back in the order they were made:
  // Tab saves a field and opens the next before the first write has landed.
  const latest = useRef(edits);
  latest.current = edits;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const run = (
    build: (p: StoredPrograms, at: string) => readonly ProgramEdit[] | null,
    options?: EditOptions,
  ) => {
    queue.current = queue.current.then(() => latest.current.record(build, options));
  };
  const write = (slotId: string, edit: SlotEdit) => run((p, at) => editSlot(p, slotId, edit, at));
  const grid = useRef<HTMLDivElement>(null);

  // A lifted row walks the stops the shared rules offer; the grid shows the session as it would
  // read with the row there, and only the drop writes.
  const [lift, setLift] = useState<Lift | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const liftedId = lift?.id ?? null;
  const stops = useMemo(
    () => (liftedId === null ? [] : slotStops(programs, liftedId)),
    [programs, liftedId],
  );
  const moving = lift
    ? { id: lift.id, stop: stops[lift.stop] }
    : held?.programs === programs
      ? held
      : null;
  const view = moving?.stop
    ? arranged(programs, placed.session.id, moving.id, moving.stop)
    : placed;
  const normal = rowsOf(view.slots);
  const noClimbing = rowsOf(view.noClimbing);
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

  const nameOf = (id: string) => {
    const exerciseId = programs.slots.find((s) => s.id === id)?.exerciseId ?? "";
    return exerciseById(exerciseId)?.name ?? exerciseId;
  };
  // « position 3 sur 6 » in the section the stop is in, the lifted row counted.
  const positionOf = (id: string, stop: Stop) => ({
    n: stop.index + 1,
    total: sectionOf(programs, placed.session.id, stop.rule, id).length + 1,
  });
  const start = (id: string, by: Lift["by"]) => {
    const at = stopOf(programs, id);
    const stop = slotStops(programs, id)[at];
    if (!stop) return;
    setLift({ id, stop: at, by });
    announce(t("editor.move.lifted", { name: nameOf(id), ...positionOf(id, stop) }));
  };
  const goTo = (next: number) => {
    const stop = stops[next];
    if (!lift || !stop || next === lift.stop) return;
    setLift({ ...lift, stop: next });
    const notes = moveNotes(programs, lift.id, stop).map((note) => t(`editor.move.${note}`));
    announce([t("editor.move.position", positionOf(lift.id, stop)), ...notes].join(", "));
  };
  const drop = () => {
    if (!lift) return;
    const { id } = lift;
    const stop = stops[lift.stop];
    setLift(null);
    if (!stop) return;
    setHeld({ id, stop, programs });
    run((p, at) => placeSlot(p, id, stop, at));
    announce(t("editor.move.dropped", { name: nameOf(id), ...positionOf(id, stop) }));
  };
  const cancel = () => {
    if (!lift) return;
    setLift(null);
    announce(t("editor.move.cancelled"));
  };
  // Space lifts and drops, ↑ ↓ walk the stops, Escape puts the row back; Tab leaves it where it was.
  const onHandleKey = (e: KeyboardEvent<HTMLElement>, row: Row): boolean => {
    const lifted = lift?.id === row.slot.id;
    if (e.key === " ") {
      e.preventDefault();
      if (lifted) drop();
      else if (!lift) start(row.slot.id, "key");
      return true;
    }
    if (!lifted) return false;
    if (e.key === "Tab") {
      cancel();
      return true;
    }
    e.preventDefault();
    if (e.key === "ArrowDown" || e.key === "ArrowUp")
      goTo(Math.min(Math.max(lift.stop + (e.key === "ArrowDown" ? 1 : -1), 0), stops.length - 1));
    else if (e.key === "Escape") cancel();
    return true;
  };

  // A drag follows the pointer over the whole page, so a row that moves under it never loses it.
  const geometry = useRef<Geometry | null>(null);
  const measure = (id: string): Geometry => {
    const box = grid.current!.getBoundingClientRect();
    const mid = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.top + scrollY + r.height / 2;
    };
    const mids = (rule: string) =>
      [...grid.current!.querySelectorAll(`[data-row][data-rule="${rule}"]`)]
        .filter((el) => el.getAttribute("data-row") !== id)
        .map(mid);
    const section = grid.current!.querySelector("[data-no-climbing]")?.getBoundingClientRect();
    return {
      normal: mids("normal"),
      noClimbing: mids("no_climbing"),
      top: box.top + scrollY,
      noClimbingTop: section ? section.top + scrollY : Infinity,
      bottom: box.bottom + scrollY,
    };
  };
  const pointer = useRef<{ move(y: number): void; drop(): void; cancel(): void } | null>(null);
  pointer.current = {
    move: (y) => {
      if (!lift) return;
      geometry.current ??= measure(lift.id);
      goTo(stopAt(geometry.current, stops, y, lift.stop));
    },
    drop,
    cancel,
  };
  const dragging = lift?.by === "pointer";
  useEffect(() => {
    if (!dragging) return;
    const move = (e: globalThis.PointerEvent) => pointer.current?.move(e.clientY + scrollY);
    const up = () => pointer.current?.drop();
    const lost = () => pointer.current?.cancel();
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      pointer.current?.cancel();
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", lost);
    addEventListener("keydown", key);
    return () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", lost);
      removeEventListener("keydown", key);
    };
  }, [dragging]);
  const onHandleDown = (e: PointerEvent<HTMLElement>, row: Row) => {
    if (e.button !== 0 || lift) return;
    e.preventDefault();
    // A touch holds its pointer on the handle; let it go, so the page keeps reporting it when the
    // row moves.
    if (e.currentTarget.hasPointerCapture?.(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    geometry.current = null;
    e.currentTarget.focus();
    start(row.slot.id, "pointer");
  };

  // The lifted row keeps the focus while it moves from one place to another in the grid.
  useLayoutEffect(() => {
    if (lift?.by !== "key") return;
    const handle = grid.current?.querySelector<HTMLElement>(
      `[data-cell="${keyOf(lift.id, "handle")}"]`,
    );
    if (handle && document.activeElement !== handle) handle.focus();
  });
  // The others slide out of the lifted row's way: each row starts where it was drawn and moves to
  // its new place, by its transform only; with reduced motion they move at once.
  const tops = useRef(new Map<string, number>());
  const layout = rows.map((r) => `${r.slot.id}${r.grouped ? "+" : ""}`).join() + (lift ? "|" : "");
  useLayoutEffect(() => {
    const now = new Map<string, number>();
    const slide = liftedId !== null && !reducedMotion();
    for (const el of grid.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []) {
      const id = el.dataset.row!;
      el.style.transition = "";
      el.style.transform = "";
      now.set(id, el.offsetTop);
      const was = tops.current.get(id);
      if (!slide || was === undefined || was === el.offsetTop) continue;
      el.style.transform = `translateY(${was - el.offsetTop}px)`;
      void el.offsetHeight;
      el.style.transition = "transform var(--dur-release) var(--ease-out)";
      el.style.transform = "";
    }
    tops.current = now;
  }, [layout, liftedId]);

  const removedText = (slot: ProgramSlot) =>
    placed.letter === null
      ? t("editor.toast.slotRemovedAside", {
          name: nameOf(slot.id),
          session: titleOf(placed, t),
        })
      : t("editor.toast.slotRemoved", { name: nameOf(slot.id), code: placed.letter });
  const refused = { refused: t("editor.limit.slots") };

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
    if (cell === "handle" && onHandleKey(e, row)) return;
    if (lift) return;
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

  const cells = (row: Row, r: number, last: boolean): RowCells => {
    const nodes = CELLS.map((cell, c) => {
      const key = keyOf(row.slot.id, cell);
      const focusable = {
        "data-cell": key,
        tabIndex: key === stop ? 0 : -1,
        onFocus: () => setFocus(key),
        onKeyDown: (e: KeyboardEvent<HTMLElement>) => onCellKey(e, r, c),
      };
      const name = nameOf(row.slot.id);
      if (cell === "handle")
        return (
          <button
            key={cell}
            type="button"
            {...focusable}
            aria-label={t("editor.row.handle", { name })}
            onPointerDown={(e) => onHandleDown(e, row)}
            className={`grid size-11 shrink-0 cursor-grab touch-none place-items-center rounded-control text-muted-foreground ${ring}`}
          >
            <GripVertical aria-hidden className="size-5" />
          </button>
        );
      if (cell === "more")
        return (
          <RowMenu
            key={cell}
            label={t("editor.row.more", { name })}
            focusable={focusable}
            up={r >= rows.length - 3}
            onDuplicate={() => run((p, at) => copySlot(p, newId(), row.slot.id, at), refused)}
            onChain={
              row.grouped || last
                ? null
                : () => run((p, at) => chainWithNext(p, row.slot.id, newId, at))
            }
            onLeave={row.grouped ? () => run((p, at) => leaveGroup(p, row.slot.id, at)) : null}
            onRemove={() =>
              run((p, at) => removeSlot(p, row.slot.id, at), { toast: removedText(row.slot) })
            }
          />
        );
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
    return { handle: nodes[0], values: nodes.slice(1, -1), more: nodes.at(-1) };
  };

  return (
    <div
      ref={grid}
      role="grid"
      aria-label={t("editor.grid.label", { session: titleOf(placed, t) })}
      // Positioned, so what is drawn out of the flow (a column's hidden name, a field's reason)
      // scrolls with the table inside its card instead of widening the page.
      className={`relative tabular-nums ${dragging ? "cursor-grabbing select-none" : ""}`}
    >
      <div role="rowgroup">
        <div role="row" className={`${COLUMNS} min-h-8.5 border-t border-border`}>
          {COLUMN_KEYS.map((key, i) => (
            <span
              key={key}
              role="columnheader"
              // The exercise's name starts after the row's handle.
              className={`text-section text-muted-foreground ${i === 0 ? "pl-14 text-left" : "text-center"}`}
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
      <Rows
        rows={normal}
        rule="normal"
        lifted={liftedId}
        cells={(row, i) => cells(row, i, i === normal.length - 1)}
      />
      {/* While a row is lifted the section shows even empty, as a place to drop it. */}
      {(noClimbing.length > 0 || lift) && (
        <Rows
          rows={noClimbing}
          rule="no_climbing"
          lifted={liftedId}
          label={t("editor.grid.noClimbing")}
          head={
            <div role="row" data-no-climbing className="grid min-w-3xl">
              <span
                role="gridcell"
                className={`${line} min-h-11 border-t border-border pt-2.5 pr-4 pb-1.5 pl-15`}
              >
                <Mountain aria-hidden className="size-4" />
                {t("editor.grid.noClimbing")}
              </span>
            </div>
          }
          cells={(row, i) => cells(row, normal.length + i, i === noClimbing.length - 1)}
        />
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

interface RowCells {
  handle: ReactNode;
  values: ReactNode;
  more: ReactNode;
}

function Rows({
  rows,
  rule,
  lifted,
  label,
  head,
  cells,
}: {
  rows: readonly Row[];
  rule: "normal" | "no_climbing";
  lifted: string | null;
  label?: string;
  head?: ReactNode;
  cells: (row: Row, index: number) => RowCells;
}) {
  const { t } = useTranslation();
  const slots = rows.map((r) => r.slot);
  // A section's heading row sits in its own row group: a row group holds rows, never another group.
  return (
    <div role="rowgroup" aria-label={label}>
      {head}
      {rows.flatMap((row, i) => {
        const slotRow = (
          <SlotRow
            key={row.slot.id}
            slot={row.slot}
            rule={rule}
            grouped={row.grouped}
            lifted={row.slot.id === lifted}
            cells={cells(row, i)}
          />
        );
        if (!groupPlace(slots, i).first) return [slotRow];
        return [
          <div key={`${row.slot.id}-group`} role="row" className="grid min-w-3xl">
            <span role="gridcell" className={`${line} min-h-8.5 pt-2 pl-15`}>
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

// A slot's row: its handle and its exercise, its values, its ⋯. Lifted, it takes the soft primary
// tint with a ring drawn inside, above the rows sliding past it.
function SlotRow({
  slot,
  rule,
  grouped,
  lifted,
  cells,
}: {
  slot: ProgramSlot;
  rule: "normal" | "no_climbing";
  grouped: boolean;
  lifted: boolean;
  cells: RowCells;
}) {
  const { t } = useTranslation();
  const exercise = exerciseById(slot.exerciseId);
  return (
    <div
      role="row"
      data-row={slot.id}
      data-rule={rule}
      aria-current={lifted || undefined}
      className={`${COLUMNS} relative min-h-15 border-t border-border ${
        grouped
          ? "before:absolute before:inset-y-0 before:left-13 before:w-0.5 before:rounded-full before:bg-muted-foreground"
          : ""
      } ${lifted ? "z-10 bg-primary-soft outline-2 -outline-offset-2 outline-primary" : ""}`}
    >
      <span role="gridcell" className="flex min-w-0 items-center gap-3 py-2">
        {cells.handle}
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
      {cells.values}
      <span role="gridcell" className="grid place-items-center">
        {cells.more}
      </span>
    </div>
  );
}

const item =
  "flex min-h-11 cursor-default items-center gap-3 rounded-chip px-3 text-body font-medium outline-hidden select-none data-highlighted:bg-(--press-tint)";

// A row's ⋯: Dupliquer, then Enchaîner avec le suivant or Sortir du groupe when the row has one,
// then Retirer de la séance in red, apart. Near the bottom of the table it opens upward.
function RowMenu({
  label,
  focusable,
  up,
  onDuplicate,
  onChain,
  onLeave,
  onRemove,
}: {
  label: string;
  focusable: Focusable;
  up: boolean;
  onDuplicate(): void;
  onChain: (() => void) | null;
  onLeave: (() => void) | null;
  onRemove(): void;
}) {
  const { t } = useTranslation();
  return (
    // Not modal: a modal menu hides the page from assistive technology while the page's own controls
    // stay focusable behind it. Focus still moves into the menu and Escape brings it back.
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          {...focusable}
          aria-label={label}
          className={`grid size-11 place-items-center rounded-control text-muted-foreground data-[state=open]:bg-track ${ring}`}
        >
          <Ellipsis aria-hidden className="size-5" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side={up ? "top" : "bottom"}
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 min-w-60 rounded-field bg-popover p-1 text-popover-foreground shadow-float data-[state=open]:animate-fade-in dark:border dark:border-border"
        >
          <DropdownMenu.Item className={item} onSelect={onDuplicate}>
            <Copy aria-hidden className="size-5 text-muted-foreground" />
            {t("editor.row.duplicate")}
          </DropdownMenu.Item>
          {onChain && (
            <DropdownMenu.Item className={item} onSelect={onChain}>
              <Link2 aria-hidden className="size-5 text-muted-foreground" />
              {t("editor.row.chain")}
            </DropdownMenu.Item>
          )}
          {onLeave && (
            <DropdownMenu.Item className={item} onSelect={onLeave}>
              <Unlink2 aria-hidden className="size-5 text-muted-foreground" />
              {t("editor.row.unchain")}
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-border" />
          <DropdownMenu.Item className={`${item} text-destructive`} onSelect={onRemove}>
            <Trash2 aria-hidden className="size-5" />
            {t("editor.row.remove")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
      {t("editor.help.edit")} · <Key>{t("editor.help.space")}</Key> {t("editor.help.on")}{" "}
      <GripVertical aria-hidden className="inline size-4 align-text-bottom" />{" "}
      {t("editor.help.lift")} · <Key>/</Key> {t("editor.help.search")} ·{" "}
      <Key>{isMac() ? "⌘" : "Ctrl"}</Key> <Key>Z</Key> {t("editor.help.undo")}
    </p>
  );
}

// Under a session « + Séance » has just added: where it went, and the search's keys.
export function AddedHelp({ code }: { code: string }) {
  const { t } = useTranslation();
  return (
    <p className="min-h-11 px-1 py-2.5 text-sm text-muted-foreground">
      {t("editor.help.added", { code })} · <Key>{t("editor.help.enter")}</Key>{" "}
      {t("editor.help.adds")} · <Key>{t("editor.help.escape")}</Key> {t("editor.help.closes")} ·{" "}
      <Key>{isMac() ? "⌘" : "Ctrl"}</Key> <Key>Z</Key> {t("editor.help.undo")}
    </p>
  );
}

const Key = ({ children }: { children: ReactNode }) => (
  <kbd className="mx-0.5 rounded-icon bg-track px-1.5 py-px font-sans font-semibold text-foreground">
    {children}
  </kbd>
);
