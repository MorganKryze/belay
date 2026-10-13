import { type RefObject, useEffect, useRef } from "react";

// The motion spec's numbers: the axis locks after 8 px, a sheet closes past 90 px or on a flick
// faster than 0.6 px/ms, the flick read over the last 100 ms of the move.
const AXIS_LOCK_PX = 8;
const CLOSE_PX = 90;
const FLICK_PX_PER_MS = 0.6;
const FLICK_WINDOW_MS = 100;

export function axisOf(dx: number, dy: number): "vertical" | "horizontal" | null {
  const across = Math.abs(dx);
  const down = Math.abs(dy);
  if (Math.max(across, down) < AXIS_LOCK_PX) return null;
  return across > down ? "horizontal" : "vertical";
}

export function releaseOf(dy: number, velocity: number): "close" | "snap" {
  return dy > CLOSE_PX || (dy > 0 && velocity > FLICK_PX_PER_MS) ? "close" : "snap";
}

// On a computer the sheet is a centred dialog: nothing to pull down.
const wide = () => typeof matchMedia === "function" && matchMedia("(width >= 64rem)").matches;

// A swipe that starts in scrolled content is the content's own scroll, and one that starts in a
// field is a selection or a caret move.
function startsInContent(target: EventTarget | null, card: HTMLElement) {
  if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]"))
    return true;
  for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
    if (el.scrollTop > 0) return true;
    if (el === card) break;
  }
  return false;
}

// Pulls a phone sheet down with the finger. The card follows without a transition; let go past
// the threshold, it asks to close with --swipe-y set so the exit starts where the finger left it;
// short of it, it goes back up through --swipe-snap-transition (a fade with reduced motion).
// The close button, the overlay and Escape stay the guaranteed ways out.
export function useSwipeToClose(
  card: RefObject<HTMLElement | null>,
  request: () => void,
  enabled: boolean,
): void {
  const latestRequest = useRef(request);
  useEffect(() => {
    latestRequest.current = request;
  });

  useEffect(() => {
    if (!enabled) return;
    // Listens on the document: the card mounts through a portal after this effect has run.
    const cardOf = (target: EventTarget | null) => {
      const el = card.current;
      return el && target instanceof Node && el.contains(target) ? el : null;
    };

    // The card's classes hand a downward pan at the top to the gesture and leave the browser
    // scrolling the content up; once scrolled, every pan is the browser's again.
    const onScroll = (e: Event) => {
      const el = card.current;
      if (el && e.target === el) el.style.touchAction = el.scrollTop > 0 ? "auto" : "";
    };

    let el: HTMLElement | null = null;
    let id: number | null = null;
    let x0 = 0;
    let y0 = 0;
    let axis: ReturnType<typeof axisOf> = null;
    let dy = 0;
    let samples: { y: number; t: number }[] = [];

    const stop = () => {
      id = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };

    const snap = (el: HTMLElement) => {
      // Reduced motion starts the way back from a hidden card and fades it in; otherwise the
      // card slides up from where it was let go.
      el.style.transition = "none";
      el.style.opacity = "var(--swipe-snap-from)";
      void el.offsetHeight;
      el.style.transition = "var(--swipe-snap-transition)";
      el.style.transform = "";
      el.style.opacity = "";
    };

    const onDown = (e: PointerEvent) => {
      el = cardOf(e.target);
      if (!el || id !== null || !e.isPrimary || wide() || startsInContent(e.target, el)) return;
      id = e.pointerId;
      x0 = e.clientX;
      y0 = e.clientY;
      axis = null;
      dy = 0;
      samples = [{ y: e.clientY, t: e.timeStamp }];
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== id || !el) return;
      if (axis === null) {
        axis = axisOf(e.clientX - x0, e.clientY - y0);
        if (axis === "horizontal") return stop();
        if (axis === null) return;
      }
      const now = e.timeStamp;
      dy = Math.max(0, e.clientY - y0);
      samples.push({ y: e.clientY, t: now });
      while (samples.length > 2 && now - samples[0]!.t > FLICK_WINDOW_MS) samples.shift();
      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== id || !el) return;
      stop();
      if (axis !== "vertical") return;
      const first = samples[0]!;
      const last = samples[samples.length - 1]!;
      const velocity = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
      if (releaseOf(dy, velocity) === "close") {
        el.style.setProperty("--swipe-y", `${dy}px`);
        latestRequest.current();
      } else snap(el);
    };

    // The browser took the pan over (a scroll, a zoom): the card goes back.
    const onCancel = (e: PointerEvent) => {
      if (e.pointerId !== id || !el) return;
      stop();
      if (axis === "vertical") snap(el);
    };

    document.addEventListener("pointerdown", onDown);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      stop();
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [card, enabled]);
}
