import { fireEvent } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { markPresses } from "./press";

beforeAll(() => markPresses());

function row(className: string) {
  document.body.innerHTML = `<button class="${className}"><span>Intake</span></button>`;
  return document.querySelector("button")!;
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

  it("clears the mark when the pointer lifts, wherever it lifts", () => {
    const button = row("press-tint");
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(document.body);
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
});
