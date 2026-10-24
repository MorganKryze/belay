import { newId } from "@belay/shared";
import { addSession, letterMoves, placeSession } from "@belay/shared/training/program-edits";
import {
  isSeedSession,
  MAX_ROTATION,
  type StoredPrograms,
} from "@belay/shared/training/stored-program";
import type { TFunction } from "i18next";
import { Plus } from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { sessionName } from "@/lib/format";
import { LETTERS, type PlacedSession, titleOf, useEditor } from "./editor-context";

// The panel the chips control, named after the shown chip.
export const PANEL = "program-editor-session";
export const chipId = (sessionId: string) => `program-editor-chip-${sessionId}`;

// A rotation session's name: its own, else a starting session's translated one; none for a session
// left without a name, whose chip shows its letter alone.
export function chipName({ session }: PlacedSession, t: TFunction): string | null {
  return session.name !== null || isSeedSession(session.id) ? sessionName(session, t) : null;
}

// A session as a sentence names it: its name, else « Séance D »; a set-aside one by its name.
export const spokenName = (p: PlacedSession, t: TFunction): string =>
  p.letter === null ? sessionName(p.session, t) : (chipName(p, t) ?? titleOf(p, t));

// The letter changes an edit makes, for a toast: « C devient B, D devient C. », or nothing.
export function movesSentence(before: readonly string[], after: readonly string[], t: TFunction) {
  const moves = letterMoves(before, after).map((m) => t("editor.letters.becomes", m));
  return moves.length === 0 ? "" : ` ${moves.join(", ")}.`;
}

const chipBase =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-control px-4 text-body -outline-offset-2";
const chipBox = `${chipBase} outline-ring focus-visible:outline-2`;
const chipOn = `${chipBox} bg-primary-soft font-semibold text-primary-ink ring-[1.5px] ring-primary-ink ring-inset`;
// The lifted chip as the lifted row: the soft tint and a ring drawn inside, raised above the rest.
const chipLifted = `${chipBase} z-10 bg-primary-soft font-semibold text-primary-ink shadow-float outline-2 outline-primary`;

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Lift {
  id: string;
  to: number; // the index it would take in the rotation
  by: "key" | "pointer";
}
// A chip just dropped, shown where it landed until the programs read again hold the move.
interface Held {
  ids: readonly string[];
  programs: StoredPrograms;
}
// Where the other chips sat when a drag began, in page coordinates, in their order.
type Boxes = { top: number; bottom: number; mid: number }[];

// The index the pointer stands for: the number of other chips before it in reading order, on the
// lines above it or to its left on its own line.
const indexAt = (boxes: Boxes, x: number, y: number) =>
  boxes.filter((b) => y > b.bottom || (y >= b.top && x > b.mid)).length;

const arrange = (list: readonly PlacedSession[], ids: readonly string[]) =>
  ids.map((id, i) => ({ ...list.find((p) => p.session.id === id)!, letter: LETTERS[i] ?? null }));

// The rotation's chips lettered by place, « + Séance » always last, then the set-aside chips under
// « De côté », outlined and without a letter, then the hint. Each list is one tab stop; a chip
// shows its session as soon as it has focus and ← → move. A rotation chip is reordered by drag,
// or by Space, ← →, Space, Escape cancelling; the chips read as they would after the drop.
export function SessionChips() {
  const { t } = useTranslation();
  const { rotation, aside, programs, edits, show, search, announce } = useEditor();
  const asideId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [lift, setLift] = useState<Lift | null>(null);
  const [held, setHeld] = useState<Held | null>(null);

  const ids = rotation.map((p) => p.session.id);
  const placedIds = (l: Lift) => {
    const rest = ids.filter((id) => id !== l.id);
    rest.splice(l.to, 0, l.id);
    return rest;
  };
  const shownIds = lift ? placedIds(lift) : held?.programs === programs ? held.ids : ids;
  const list = shownIds === ids ? rotation : arrange(rotation, shownIds);

  const nameOf = (id: string) => {
    const p = rotation.find((r) => r.session.id === id)!;
    return chipName(p, t) ?? p.letter ?? "";
  };
  // « Bras devient B ; Legs devient C », by name, or by letter for a chip without one.
  const movesSaid = (after: readonly string[]) =>
    letterMoves(ids, after)
      .map((m) => t("editor.letters.becomes", { from: nameOf(m.id), to: m.to }))
      .join(t("editor.letters.join"));
  const position = (to: number) => t("editor.move.position", { n: to + 1, total: ids.length });

  const start = (id: string, by: Lift["by"]) => {
    const at = ids.indexOf(id);
    if (at < 0) return;
    setLift({ id, to: at, by });
    show(id);
    announce(t("editor.move.chipLifted", { name: nameOf(id), n: at + 1, total: ids.length }));
  };
  const goTo = (to: number) => {
    if (!lift) return;
    const next = Math.min(Math.max(to, 0), ids.length - 1);
    if (next === lift.to) return;
    const moved = { ...lift, to: next };
    setLift(moved);
    const said = movesSaid(placedIds(moved));
    announce(said ? `${position(next)}, ${said}` : position(next));
  };
  const drop = () => {
    if (!lift) return;
    const { id, to } = lift;
    const after = placedIds(lift);
    setLift(null);
    setHeld({ ids: after, programs });
    // A move refused or not written shows the chips as they are again.
    void edits
      .record((p, at) => placeSession(p, id, p.activeId, to, at))
      .then((ok) => ok || setHeld(null));
    announce(movesSaid(after) || position(to));
  };
  const cancel = () => {
    if (!lift) return;
    setLift(null);
    announce(t("editor.move.cancelled"));
  };

  // Space lifts and drops, ← → move the lifted chip, Escape puts it back, Tab leaves it unmoved.
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, p: PlacedSession) => {
    const lifted = lift?.id === p.session.id;
    if (e.key === " ") {
      e.preventDefault();
      if (lifted) drop();
      else if (!lift) start(p.session.id, "key");
      return;
    }
    if (!lifted) return moveFocus(e);
    if (e.key === "Tab") return cancel();
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      goTo(lift.to + (e.key === "ArrowRight" ? 1 : -1));
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  // A drag begins once the pointer has moved a few pixels, so a click stays a click; it follows
  // the pointer over the whole page.
  const pending = useRef<{ id: string; x: number; y: number } | null>(null);
  const boxes = useRef<Boxes>([]);
  const pointer = useRef({ start, goTo, drop, cancel, lift });
  pointer.current = { start, goTo, drop, cancel, lift };
  useEffect(() => {
    const move = (e: globalThis.PointerEvent) => {
      const x = e.clientX + scrollX;
      const y = e.clientY + scrollY;
      const { lift: l } = pointer.current;
      const waiting = pending.current;
      if (!l && waiting) {
        if (Math.hypot(x - waiting.x, y - waiting.y) < 6) return;
        pending.current = null;
        boxes.current = [...(box.current?.querySelectorAll<HTMLElement>("[data-chip]") ?? [])]
          .filter((el) => el.dataset.chip !== waiting.id)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              top: r.top + scrollY,
              bottom: r.bottom + scrollY,
              mid: r.left + scrollX + r.width / 2,
            };
          });
        pointer.current.start(waiting.id, "pointer");
        return;
      }
      if (l?.by === "pointer") pointer.current.goTo(indexAt(boxes.current, x, y));
    };
    const up = () => {
      pending.current = null;
      if (pointer.current.lift?.by === "pointer") pointer.current.drop();
    };
    const lost = () => {
      pending.current = null;
      if (pointer.current.lift?.by === "pointer") pointer.current.cancel();
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || pointer.current.lift?.by !== "pointer") return;
      e.preventDefault();
      pointer.current.cancel();
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
  }, []);
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, p: PlacedSession) => {
    if (e.button !== 0 || lift) return;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    pending.current = { id: p.session.id, x: e.clientX + scrollX, y: e.clientY + scrollY };
  };

  // The lifted chip keeps the focus as the chips move around it, and the others slide out of its
  // way by their transform only; with reduced motion they move at once.
  useLayoutEffect(() => {
    if (lift?.by !== "key") return;
    const el = document.getElementById(chipId(lift.id));
    if (el && document.activeElement !== el) el.focus();
  });
  const places = useRef(new Map<string, { x: number; y: number }>());
  const layout = shownIds.join();
  useLayoutEffect(() => {
    const now = new Map<string, { x: number; y: number }>();
    const slide = lift !== null && !reducedMotion();
    for (const el of box.current?.querySelectorAll<HTMLElement>("[data-chip]") ?? []) {
      const id = el.dataset.chip!;
      el.style.transition = "";
      el.style.transform = "";
      const at = { x: el.offsetLeft, y: el.offsetTop };
      now.set(id, at);
      const was = places.current.get(id);
      if (!slide || id === lift.id || !was || (was.x === at.x && was.y === at.y)) continue;
      el.style.transform = `translate(${was.x - at.x}px, ${was.y - at.y}px)`;
      void el.offsetHeight;
      el.style.transition = "transform var(--dur-release) var(--ease-out)";
      el.style.transform = "";
    }
    places.current = now;
  }, [layout, lift]);

  const add = async () => {
    const id = newId();
    const code = LETTERS[rotation.length];
    const added = await edits.record((p, at) => addSession(p, id, p.activeId, at), {
      refused: t(
        rotation.length >= MAX_ROTATION ? "editor.limit.rotation" : "editor.limit.sessions",
      ),
    });
    if (!added) return;
    show(id);
    search.request(id);
    announce(t("editor.session.added", { code }));
  };

  return (
    <div className="flex flex-col gap-2">
      <div ref={box} className="relative flex flex-wrap gap-2">
        <div role="tablist" aria-label={t("editor.chips.label")} className="contents">
          <ChipList
            list={list}
            lifted={lift?.id ?? null}
            onKey={onKey}
            onPointerDown={onPointerDown}
          />
        </div>
        <button
          type="button"
          aria-label={t("editor.chips.addLabel")}
          onClick={() => void add()}
          className={`${chipBox} bg-track font-semibold text-foreground`}
        >
          <Plus aria-hidden className="size-5" />
          {t("editor.chips.add")}
        </button>
      </div>
      {aside.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span id={asideId} className="px-0.5 text-sm font-semibold text-muted-foreground">
            {t("editor.chips.aside")}
          </span>
          <div role="tablist" aria-labelledby={asideId} className="flex flex-wrap gap-2">
            <ChipList list={aside} lifted={null} onKey={(e) => moveFocus(e)} />
          </div>
        </div>
      )}
      <p className="text-sm text-muted-foreground">{t("editor.hint")}</p>
    </div>
  );
}

// ← → Home End move the focus between the chips of one list, which shows the chip reached.
function moveFocus(e: KeyboardEvent<HTMLButtonElement>) {
  const tabs = [
    ...e.currentTarget.closest("[role=tablist]")!.querySelectorAll<HTMLElement>("[role=tab]"),
  ];
  const at = tabs.indexOf(e.currentTarget);
  const to =
    e.key === "ArrowRight"
      ? (at + 1) % tabs.length
      : e.key === "ArrowLeft"
        ? (at - 1 + tabs.length) % tabs.length
        : e.key === "Home"
          ? 0
          : e.key === "End"
            ? tabs.length - 1
            : null;
  if (to === null) return;
  e.preventDefault();
  tabs[to]!.focus();
}

function ChipList({
  list,
  lifted,
  onKey,
  onPointerDown,
}: {
  list: readonly PlacedSession[];
  lifted: string | null;
  onKey(e: KeyboardEvent<HTMLButtonElement>, p: PlacedSession): void;
  onPointerDown?(e: PointerEvent<HTMLButtonElement>, p: PlacedSession): void;
}) {
  const { t } = useTranslation();
  const { shown, show } = useEditor();
  const holdsShown = list.some((p) => p.session.id === shown?.session.id);
  return list.map((p, i) => {
    const on = p.session.id === shown?.session.id;
    const name = p.letter === null ? null : chipName(p, t);
    return (
      <button
        key={p.session.id}
        id={chipId(p.session.id)}
        data-chip={onPointerDown ? p.session.id : undefined}
        type="button"
        role="tab"
        aria-selected={on}
        aria-controls={on ? PANEL : undefined}
        aria-label={
          p.letter !== null && name !== null
            ? t("editor.chips.named", { code: p.letter, name })
            : undefined
        }
        tabIndex={on || (!holdsShown && i === 0) ? 0 : -1}
        onFocus={() => show(p.session.id)}
        onClick={() => show(p.session.id)}
        onKeyDown={(e) => onKey(e, p)}
        onPointerDown={onPointerDown && ((e) => onPointerDown(e, p))}
        className={`${
          p.session.id === lifted
            ? chipLifted
            : on
              ? chipOn
              : p.letter === null
                ? `${chipBox} font-medium text-foreground ring-[1.5px] ring-input ring-inset`
                : `${chipBox} bg-track font-semibold text-muted-foreground`
        } ${onPointerDown ? "touch-none select-none" : ""}`}
      >
        {p.letter === null ? (
          sessionName(p.session, t)
        ) : (
          <>
            <span className={on ? "font-bold" : "font-bold text-foreground"}>{p.letter}</span>
            {name}
          </>
        )}
      </button>
    );
  });
}
