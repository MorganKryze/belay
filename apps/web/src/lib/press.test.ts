import { fireEvent } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { markPresses, settlePresses } from "./press";

beforeAll(() => markPresses());

afterEach(() => {
  settlePresses(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function row(className: string) {
  document.body.innerHTML = `<button class="${className}"><span>Intake</span></button>`;
  return document.querySelector("button")!;
}

function rowLink(href = "/tools/plates") {
  document.body.innerHTML = `<a class="press-tint" href="${href}"><span>Plates</span></a>`;
  return document.querySelector("a")!;
}

// Frames run on the fake clock, one every 16 ms.
function fakeFrames() {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) =>
    setTimeout(() => run(Date.now()), 16),
  );
}

describe("markPresses", () => {
  it("marks a pressed row as soon as the pointer lands, even on its label", () => {
    const button = row("press-tint");
    fireEvent.pointerDown(button.querySelector("span")!);
    expect(button.hasAttribute("data-pressed")).toBe(true);
  });

  it("marks a pressed button that scales", () => {
    const button = row("press");
    fireEvent.pointerDown(button);
    expect(button.hasAttribute("data-pressed")).toBe(true);
  });

  // A tab tints like a row but is not held: its icon springs back as the finger lifts.
  it("a pressed tab is marked, and released on lift", () => {
    document.body.innerHTML = `<a class="press-tint press-icon" href="/tools"><svg></svg><span>Tools</span></a>`;
    const tab = document.querySelector("a")!;
    fireEvent.pointerDown(tab.querySelector("span")!);
    expect(tab.hasAttribute("data-pressed")).toBe(true);
    fireEvent.pointerUp(tab.querySelector("span")!);
    expect(tab.hasAttribute("data-pressed")).toBe(false);
  });

  it("clears the mark when the pointer lifts, wherever it lifts", () => {
    const button = row("press-tint");
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(document.body);
    expect(button.hasAttribute("data-pressed")).toBe(false);
  });

  it("a pressed button clears on release, as before", () => {
    const button = row("press-tint");
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    expect(button.hasAttribute("data-pressed")).toBe(false);
  });

  it("clears the mark when the touch turns into a scroll", () => {
    const button = row("press-tint");
    fireEvent.pointerDown(button);
    fireEvent.pointerCancel(button);
    expect(button.hasAttribute("data-pressed")).toBe(false);
  });

  it("leaves a control without press feedback unmarked", () => {
    const button = row("plain");
    fireEvent.pointerDown(button);
    expect(button.hasAttribute("data-pressed")).toBe(false);
  });

  it("a row link released under the finger stays tinted until its navigation resolves", () => {
    const link = rowLink();
    fireEvent.pointerDown(link.querySelector("span")!);
    fireEvent.pointerUp(link.querySelector("span")!);
    expect(link.hasAttribute("data-pressed")).toBe(true);
    settlePresses("push");
    expect(link.hasAttribute("data-pressed")).toBe(false);
  });

  it("a row link released elsewhere clears at once", () => {
    const link = rowLink();
    fireEvent.pointerDown(link);
    fireEvent.pointerUp(document.body);
    expect(link.hasAttribute("data-pressed")).toBe(false);
  });

  it("a held mark clears on the next press or a cancelled touch", () => {
    const link = rowLink();
    fireEvent.pointerDown(link);
    fireEvent.pointerUp(link);
    fireEvent.pointerCancel(document.body);
    expect(link.hasAttribute("data-pressed")).toBe(false);
    fireEvent.pointerDown(link);
    fireEvent.pointerUp(link);
    fireEvent.pointerDown(document.body);
    expect(link.hasAttribute("data-pressed")).toBe(false);
  });

  it("a held mark clears by itself after 600 ms", () => {
    vi.useFakeTimers();
    const link = rowLink();
    fireEvent.pointerDown(link);
    fireEvent.pointerUp(link);
    vi.advanceTimersByTime(599);
    expect(link.hasAttribute("data-pressed")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(link.hasAttribute("data-pressed")).toBe(false);
  });

  it("after Back, the row the person left from tints, then clears over the untint", () => {
    fakeFrames();
    const left = rowLink();
    fireEvent.pointerDown(left);
    fireEvent.pointerUp(left);
    settlePresses("push");
    // The deeper page, then the list again, with a fresh row.
    document.body.innerHTML = `<a class="press-tint" href="/tools/plates/equipment">Equipment</a>`;
    const back = rowLink();
    settlePresses("pop");
    vi.advanceTimersByTime(16);
    expect(back.hasAttribute("data-pressed")).toBe(true);
    expect(back.hasAttribute("data-untint")).toBe(true);
    vi.advanceTimersByTime(16);
    expect(back.hasAttribute("data-pressed")).toBe(false);
    expect(back.hasAttribute("data-untint")).toBe(true);
    fireEvent.transitionEnd(back);
    expect(back.hasAttribute("data-untint")).toBe(false);
  });

  it("the untint mark goes after 300 ms when no transition ends, and plays once", () => {
    fakeFrames();
    const left = rowLink();
    fireEvent.pointerDown(left);
    fireEvent.pointerUp(left);
    settlePresses("push");
    const back = rowLink();
    settlePresses("pop");
    vi.advanceTimersByTime(32);
    expect(back.hasAttribute("data-untint")).toBe(true);
    vi.advanceTimersByTime(300);
    expect(back.hasAttribute("data-untint")).toBe(false);
    // The href is forgotten: a second Back plays nothing.
    settlePresses("pop");
    vi.advanceTimersByTime(16);
    expect(back.hasAttribute("data-pressed")).toBe(false);
  });

  it("nothing plays when that row is not back within 300 ms", () => {
    fakeFrames();
    const left = rowLink();
    fireEvent.pointerDown(left);
    fireEvent.pointerUp(left);
    settlePresses("push");
    document.body.innerHTML = "";
    settlePresses("pop");
    vi.advanceTimersByTime(320);
    const late = rowLink();
    vi.advanceTimersByTime(100);
    expect(late.hasAttribute("data-pressed")).toBe(false);
    expect(late.hasAttribute("data-untint")).toBe(false);
  });
});
