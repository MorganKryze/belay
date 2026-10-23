import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import i18n from "../i18n";
import { writeMedia } from "../lib/media-flag";
import { ExerciseLoop } from "./exercise-loop";

// jsdom plays nothing: play() and pause() only fire the events a browser would.
let played: MockInstance<HTMLMediaElement["play"]>;
let paused: MockInstance<HTMLMediaElement["pause"]>;
beforeEach(() => {
  localStorage.clear();
  writeMedia("on");
  played = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  paused = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    this.dispatchEvent(new Event("pause"));
  });
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

const reducedMotion = (reduce: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: reduce && q.includes("prefers-reduced-motion: reduce"),
    media: q,
  }));
const video = () => document.querySelector("video")!;
const figure = () => document.querySelector("figure");

describe("an exercise's loop", () => {
  it("renders nothing when there is no source", () => {
    const { container, rerender } = render(
      <ExerciseLoop exerciseId="belay:barbell-hip-thrust" name="Barbell hip thrust" />,
    );
    expect(container.innerHTML).toBe("");
    writeMedia("off");
    rerender(<ExerciseLoop exerciseId="ds:0025" name="Barbell bench press" />);
    expect(container.innerHTML).toBe("");
  });

  it("stays hidden until the first frame, then shows", () => {
    render(<ExerciseLoop exerciseId="ds:0025" name="Barbell bench press" />);
    expect(figure()!.hidden).toBe(true);
    expect(screen.queryByRole("figure")).toBeNull();
    expect(video().getAttribute("src")).toBe("/media/exercises/0025#t=0.001");
    fireEvent(video(), new Event("loadeddata"));
    expect(figure()!.hidden).toBe(false);
    expect(
      screen.getByRole("figure", { name: "Demonstration of Barbell bench press" }),
    ).toBeTruthy();
  });

  // A failed loop stays failed for the visit: this one uses its own number.
  it("removes itself on error and says nothing", () => {
    const { container } = render(
      <div>
        <ExerciseLoop exerciseId="ds:0043" name="Barbell squat" />
      </div>,
    );
    fireEvent(video(), new Event("error"));
    expect(container.firstElementChild!.innerHTML).toBe("");
    expect(container.textContent).toBe("");
  });

  it("autoplays muted when motion is allowed", () => {
    reducedMotion(false);
    render(<ExerciseLoop exerciseId="ds:0025" name="Barbell bench press" />);
    const v = video();
    expect(v.autoplay).toBe(true);
    expect(v.muted).toBe(true);
    expect(v.loop).toBe(true);
    expect(v.controls).toBe(false);
    expect(v.getAttribute("playsinline")).not.toBeNull();
    expect(v.getAttribute("preload")).toBe("auto");
    expect(v.getAttribute("aria-hidden")).toBe("true");
    fireEvent(v, new Event("loadeddata"));
    fireEvent(v, new Event("play"));
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("with reduced motion, starts nothing and offers Play", () => {
    reducedMotion(true);
    render(<ExerciseLoop exerciseId="ds:0025" name="Barbell bench press" />);
    fireEvent(video(), new Event("loadeddata"));
    expect(video().autoplay).toBe(false);
    expect(played).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Play the demonstration" })).toBeTruthy();
  });

  it("Pause pauses, Play resumes, the button's name follows", async () => {
    await i18n.changeLanguage("fr");
    render(<ExerciseLoop exerciseId="ds:0025" name="Barbell bench press" />);
    fireEvent(video(), new Event("loadeddata"));
    fireEvent(video(), new Event("play"));
    expect(
      screen.getByRole("figure", { name: "Démonstration de Barbell bench press" }),
    ).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Mettre en pause" })));
    expect(paused).toHaveBeenCalledTimes(1);
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Lire la démonstration" })),
    );
    expect(played).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Mettre en pause" })).toBeTruthy();
  });
});
