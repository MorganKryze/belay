import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fitToBox } from "./fit";

// Every ResizeObserver the module makes, with what it watches, so a test can say "this resized".
class FakeResizeObserver {
  static made: FakeResizeObserver[] = [];
  readonly watched = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.made.push(this);
  }
  observe(target: Element) {
    this.watched.add(target);
  }
  unobserve(target: Element) {
    this.watched.delete(target);
  }
  disconnect() {
    this.watched.clear();
  }
  fire() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

// jsdom lays nothing out: the text is `natural` px wide at its full step and scales with --fit,
// in a box `box` px wide whose height follows the text. scrollWidth never reads below the box, as
// in a browser.
function figure(natural: number, box: number) {
  const el = document.createElement("div");
  const size = { natural, box };
  const fit = () => Number(el.style.getPropertyValue("--fit") || 1);
  Object.defineProperty(el, "clientWidth", { get: () => size.box });
  Object.defineProperty(el, "clientHeight", { get: () => Math.round((size.natural * fit()) / 4) });
  Object.defineProperty(el, "scrollWidth", {
    get: () => Math.max(size.box, Math.round(size.natural * fit())),
  });
  document.body.append(el);
  return { el, size, fit };
}

beforeEach(() => {
  FakeResizeObserver.made = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("fitToBox", () => {
  it("shrinks a figure wider than its box until it meets the edge", () => {
    // « 1:04:12 » in the display face: 196 px at its step, in the summary's 126 px cell.
    const { el } = figure(196, 126);
    fitToBox(el);
    expect(el.style.getPropertyValue("--fit")).toBe("0.643");
  });

  it("holds the full step when the text fits", () => {
    const { el } = figure(90, 126);
    fitToBox(el);
    expect(el.style.getPropertyValue("--fit")).toBe("");
  });

  it("never goes below 40 % of the step, or the floor it is given", () => {
    const { el } = figure(600, 126);
    fitToBox(el);
    expect(el.style.getPropertyValue("--fit")).toBe("0.4");
    const other = figure(600, 126).el;
    fitToBox(other, 0.5);
    expect(other.style.getPropertyValue("--fit")).toBe("0.5");
  });

  it("grows back when the box widens, and follows the text when it grows", () => {
    const { el, size } = figure(196, 126);
    fitToBox(el);
    const [observer] = FakeResizeObserver.made;
    size.box = 300;
    observer!.fire();
    expect(el.style.getPropertyValue("--fit")).toBe("");
    // A larger text size: the same box, the text wider at its step.
    size.natural = 450;
    observer!.fire();
    expect(el.style.getPropertyValue("--fit")).toBe("0.667");
  });

  it("makes one observer per element, watching that element, and lets it go", () => {
    const a = figure(196, 126).el;
    const b = figure(196, 126).el;
    const stopA = fitToBox(a);
    fitToBox(b);
    expect(FakeResizeObserver.made).toHaveLength(2);
    expect([...FakeResizeObserver.made[0]!.watched]).toEqual([a]);
    expect([...FakeResizeObserver.made[1]!.watched]).toEqual([b]);
    stopA();
    expect(FakeResizeObserver.made[0]!.watched.size).toBe(0);
  });

  it("does not write again when its own change is what resized the box", () => {
    const { el } = figure(196, 126);
    fitToBox(el);
    const set = vi.spyOn(el.style, "setProperty");
    const remove = vi.spyOn(el.style, "removeProperty");
    // The smaller text made the box shorter: the observer reports it, and nothing is rewritten,
    // so the observer is not woken again.
    FakeResizeObserver.made[0]!.fire();
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(el.style.getPropertyValue("--fit")).toBe("0.643");
  });

  it("leaves the step alone where the browser cannot observe a size", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const { el } = figure(196, 126);
    expect(() => fitToBox(el)()).not.toThrow();
    expect(el.style.getPropertyValue("--fit")).toBe("");
  });
});
