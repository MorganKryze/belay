import { useCallback, useLayoutEffect, useRef } from "react";

// The display face is wide, so its titles and figures grow with the text size only until they meet
// the edge of their box: there --fit, which type.css multiplies into their step, holds them. A
// figure keeps one line and shrinks; a title's longest word is what must fit.

// Below this a figure would no longer read as the step it is.
const FLOOR = 0.4;
// What a pass that leaves something beside the scaled text (a unit at its own size) needs to settle.
const PASSES = 3;

const round = (n: number) => Math.round(n * 1000) / 1000;
const current = (el: HTMLElement) => Number(el.style.getPropertyValue("--fit") || 1);

function write(el: HTMLElement, fit: number): void {
  if (fit === 1) el.style.removeProperty("--fit");
  else el.style.setProperty("--fit", String(fit));
}

// Measures the text at its full step, then shrinks it until it fits, never under `min`. Returns
// whether the value changed.
function measure(el: HTMLElement, min: number): boolean {
  const before = current(el);
  if (before !== 1) write(el, 1);
  let fit = 1;
  for (let pass = 0; pass < PASSES && el.scrollWidth > el.clientWidth && fit > min; pass++) {
    fit = Math.max(min, round((fit * el.clientWidth) / el.scrollWidth));
    write(el, fit);
  }
  return fit !== before;
}

const refits = new WeakMap<HTMLElement, () => void>();

export function fitToBox(el: HTMLElement, min = FLOOR): () => void {
  // Without a size to observe the text keeps its step, as it did before fitting.
  if (typeof ResizeObserver === "undefined") return () => {};
  // A change of ours resizes the box, the line shorter or taller: the report that follows finds
  // the size the change left and is let go, so the observer never wakes itself. Any other size,
  // a new width or a new text size, is measured again.
  let ours = "";
  const size = () => `${el.clientWidth}x${el.clientHeight}`;
  const refit = () => {
    ours = measure(el, min) ? size() : "";
  };
  const observer = new ResizeObserver(() => {
    if (ours !== "" && ours === size()) ours = "";
    else refit();
  });
  observer.observe(el);
  refit();
  // The face arriving after the first layout changes the text's width, not its box.
  document.fonts?.addEventListener("loadingdone", refit);
  refits.set(el, refit);
  return () => {
    observer.disconnect();
    document.fonts?.removeEventListener("loadingdone", refit);
    refits.delete(el);
  };
}

// A ref for a fitted element: it is fitted when it mounts, and again after each render, since new
// text (a timer's next second, a tool's next result) does not resize its box.
export function useFit<T extends HTMLElement>(min?: number): (el: T | null) => void {
  const node = useRef<T | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    if (node.current) refits.get(node.current)?.();
  });
  // React calls it with the element on mount and with null when it goes.
  return useCallback(
    (el: T | null) => {
      stop.current?.();
      node.current = el;
      stop.current = el ? fitToBox(el, min) : null;
    },
    [min],
  );
}
