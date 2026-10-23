import { exerciseById } from "@belay/shared/exercises/catalog";
import { sessionByCode } from "@belay/shared/training/program";
import type { History, Load } from "@belay/shared/training/rules";
import { workPosition, type Workout, type WorkoutSet } from "@belay/shared/training/workout";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../i18n";
import "../i18n/lazy";
import { writeMedia } from "../lib/media-flag";
import { ExerciseCard, type Row } from "./exercise-card";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

// The bench press of session A: 4 work sets, 2 warm-ups.
const slot = sessionByCode("A")!.slots[0]!;
const bench = exerciseById(slot.exerciseId)!;
const BAR = { barKg: 20, platesKg: [25, 20, 15, 10, 5, 2.5, 1.25] };

const workout = (patch: Partial<Workout>): Workout => ({
  id: "w-last",
  sessionCode: "A",
  plan: [slot],
  startedAt: "2026-10-05T17:00:00.000Z",
  endedAt: "2026-10-05T18:00:00.000Z",
  note: null,
  exerciseNotes: {},
  removed: false,
  ...patch,
});
const set = (workoutId: string, k: number, weightKg: number, reps: number): WorkoutSet => ({
  id: `${workoutId}-${k}`,
  workoutId,
  slotIndex: 0,
  position: workPosition(k),
  exerciseId: bench.id,
  warmup: false,
  weightKg,
  reps,
  seconds: null,
  rir: 1,
  doneAt: "2026-10-05T17:10:00.000Z",
  removed: false,
});

// Last time: 80 kg × 8, 8, 7, 6.
const LAST = workout({});
const HISTORY: History = {
  workouts: [LAST],
  sets: [8, 8, 7, 6].map((reps, k) => set(LAST.id, k, 80, reps)),
};
const TODAY = "w-today";

// The card as the session screen holds it: its sets and whether it is open.
function Card({ initial = [] as WorkoutSet[], unfolded = true }) {
  const [sets, setSets] = useState(initial);
  const [open, setOpen] = useState(unfolded);
  const validate = async (row: Row, load: Load, rir: number | null) => {
    setSets((s) => [
      ...s,
      { ...set(TODAY, row.position - workPosition(0), load.weightKg, load.reps!), rir },
    ]);
    return Promise.resolve();
  };
  return (
    <ExerciseCard
      slot={slot}
      slotIndex={0}
      exercise={bench}
      sets={sets}
      history={HISTORY}
      bar={BAR}
      open={open}
      current
      group={null}
      note=""
      chrono={null}
      clock={(n) => n}
      now={Date.now()}
      onToggle={() => setOpen((o) => !o)}
      onValidate={validate}
      onCorrect={() => Promise.resolve()}
      onNote={() => {}}
      onReplace={() => {}}
      onSkip={null}
      onChrono={() => {}}
    />
  );
}

const card = () => screen.getByRole("region", { name: /^Barbell bench press/ });
const tick = (n: number) =>
  within(card())
    .getByRole("img", { name: `Set ${n} logged` })
    .querySelector("svg")!;
const toggle = () => fireEvent.click(card().querySelector("[aria-expanded]")!);

describe("ExerciseCard", () => {
  it("a tick logged before the card mounted does not pop", () => {
    render(<Card initial={[set(TODAY, 0, 80, 8)]} />);
    expect(tick(1).getAttribute("class")).not.toContain("animate-pop-in");
  });

  it("the tick tapped now pops once", async () => {
    render(<Card />);
    fireEvent.click(within(card()).getByRole("button", { name: "Log set 1" }));
    await waitFor(() => expect(tick(1).getAttribute("class")).toContain("animate-pop-in"));
    toggle();
    expect(within(card()).queryByRole("img", { name: "Set 1 logged" })).toBeNull();
    toggle();
    expect(tick(1).getAttribute("class")).not.toContain("animate-pop-in");
  });

  it("a folded card with every planned set done shows the check tile and 4 sets logged", () => {
    render(<Card initial={[0, 1, 2, 3].map((k) => set(TODAY, k, 80, 8))} unfolded={false} />);
    expect(within(card()).getByText("4 sets logged")).toBeTruthy();
    const tile = card().querySelector(".bg-reference");
    expect(tile?.querySelector("svg")?.getAttribute("class")).toContain("text-reference-ink");
  });

  it("a folded card with some sets done counts them, without the tile", () => {
    render(<Card initial={[0, 1].map((k) => set(TODAY, k, 80, 8))} unfolded={false} />);
    expect(within(card()).getByText("2 of 4 sets")).toBeTruthy();
    expect(card().querySelector(".bg-reference")).toBeNull();
  });

  it("the subline gives the last time's top set", async () => {
    await i18n.changeLanguage("fr");
    render(<Card />);
    expect(within(card()).getByText("4 × 6–8 · RIR 1–2 · la dernière fois 80 kg × 8")).toBeTruthy();
  });
});

// The bench press has a loop wherever the instance serves them (ds:0025).
describe("ExerciseCard's loop", () => {
  // The control waits for its still: a loop that fails never offers one.
  const control = () => {
    const still = card().querySelector<HTMLVideoElement>("button video");
    if (still) fireEvent(still, new Event("loadeddata"));
    return within(card()).queryByRole("button", { name: /movement$/ });
  };
  const sheet = () => screen.queryByRole("dialog");

  it("an open card offers the loop when there is one, never when there is none", () => {
    writeMedia("on");
    render(<Card />);
    const button = control()!;
    expect(button.getAttribute("aria-label")).toBe("Show the movement");
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(card().querySelector("figure")).toBeNull();
    expect(sheet()).toBeNull();
    cleanup();

    writeMedia("off");
    render(<Card />);
    expect(control()).toBeNull();
    expect(card().querySelector("video, figure")).toBeNull();
  });

  it("the still opens a sheet holding only the loop, named after the exercise", () => {
    writeMedia("on");
    render(<Card />);
    fireEvent.click(control()!);
    const dialog = sheet()!;
    expect(within(dialog).getByRole("heading", { name: "Barbell bench press" })).toBeTruthy();
    fireEvent(dialog.querySelector("video")!, new Event("loadeddata"));
    const figure = within(dialog).getByRole("figure", {
      name: "Demonstration of Barbell bench press",
    });
    expect(figure.querySelector("video")!.getAttribute("src")).toBe(
      "/media/exercises/0025#t=0.001",
    );
    // The only loop is the sheet's: nothing lands in the card, so its rows never move.
    expect(document.querySelectorAll("figure")).toHaveLength(1);
    expect(within(dialog).queryAllByRole("textbox")).toHaveLength(0);
  });

  it("closing the sheet takes the loop away, and a folded card offers nothing", async () => {
    writeMedia("on");
    render(<Card />);
    fireEvent.click(control()!);
    fireEvent.click(within(sheet()!).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(sheet()).toBeNull());
    expect(screen.queryByRole("figure")).toBeNull();
    expect(control()!.getAttribute("aria-label")).toBe("Show the movement");
    fireEvent.click(control()!);
    expect(within(sheet()!).getByRole("heading", { name: "Barbell bench press" })).toBeTruthy();
    fireEvent.click(within(sheet()!).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(sheet()).toBeNull());
    toggle();
    expect(card().querySelector("video, figure")).toBeNull();
  });

  it("the still shows only once its first frame is in, and goes when the loop fails", () => {
    writeMedia("on");
    render(<Card />);
    const still = card().querySelector<HTMLVideoElement>("button video")!;
    expect(within(card()).queryByRole("button", { name: /movement$/ })).toBeNull();
    fireEvent(still, new Event("loadeddata"));
    expect(within(card()).getByRole("button", { name: /movement$/ })).toBeTruthy();
    fireEvent(still, new Event("error"));
    expect(within(card()).queryByRole("button", { name: /movement$/ })).toBeNull();
    expect(card().querySelector("video")).toBeNull();
  });
});
