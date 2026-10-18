import { fireEvent } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { markPointer } from "./pointer";

beforeAll(() => markPointer());

const pointer = () => document.documentElement.hasAttribute("data-pointer");

describe("markPointer", () => {
  it("marks the page once a pointer lands, and clears the mark on a key press", () => {
    document.body.innerHTML = `<button>Paused</button>`;
    const button = document.querySelector("button")!;
    fireEvent.pointerDown(button);
    expect(pointer()).toBe(true);
    fireEvent.keyDown(button, { key: "Tab" });
    expect(pointer()).toBe(false);
  });

  // A control that stops the event still counts: the listeners run in the capture phase.
  it("sees a pointer even when the control stops its propagation", () => {
    document.body.innerHTML = `<button>Paused</button>`;
    const button = document.querySelector("button")!;
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    fireEvent.pointerDown(button);
    expect(pointer()).toBe(true);
    fireEvent.keyDown(button, { key: "Tab" });
  });
});
