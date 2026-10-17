import { sessionByCode } from "@belay/shared/training/program";
import { workPosition, type Workout, type WorkoutSet } from "@belay/shared/training/workout";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { expectTokensOnly } from "../test/design-rules";
import { SessionBar } from "./session-bar";

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await i18n.changeLanguage("en");
});

const C = sessionByCode("C")!;
const startedAt = "2026-10-05T17:00:00.000Z";
const workout: Workout = {
  id: "w1",
  sessionCode: "C",
  plan: [...C.slots],
  startedAt,
  endedAt: null,
  note: null,
  exerciseNotes: {},
  removed: false,
};
const set = (slotIndex: number, round: number, minute: number): WorkoutSet => ({
  id: `s${slotIndex}-${round}`,
  workoutId: workout.id,
  slotIndex,
  position: workPosition(round),
  exerciseId: C.slots[slotIndex]!.exerciseId,
  warmup: false,
  weightKg: 60,
  reps: 8,
  rir: 1,
  doneAt: new Date(Date.parse(startedAt) + minute * 60_000).toISOString(),
  removed: false,
});
// Two sets of the first slot done: its third is up next.
const twoDone = [set(0, 0, 3), set(0, 1, 6)];

// A router around the bar, so its link resolves and a tap lands on the session.
async function show(props: Parameters<typeof SessionBar>[0]) {
  const root = createRootRoute({ component: Outlet });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/",
        component: () => <SessionBar {...props} />,
      }),
      createRoute({
        getParentRoute: () => root,
        path: "/workout",
        component: () => <h1>Session</h1>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  return { link: await screen.findByRole("link"), router };
}

describe("SessionBar", () => {
  it("names the exercise of the next set, set 3 of 4 and the session letter from 390 px, 3/4 below", async () => {
    await i18n.changeLanguage("fr");
    const { link } = await show({ workout, sets: twoDone });
    expect(C.slots[0]!.sets).toBe(4);
    const long = screen.getByText("En cours · série 3 sur 4 · Séance C");
    const short = screen.getByText("En cours · série 3/4");
    expect(long.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["hidden", "min-[390px]:block"]),
    );
    expect(short.className.split(/\s+/)).toContain("min-[390px]:hidden");
    // The 13 px step, not the colour token that shares its name.
    for (const line of [long, short]) {
      expect(line.className.split(/\s+/)).toContain("text-(length:--text-secondary)");
      expect(line.className.split(/\s+/)).not.toContain("text-secondary");
    }
    expect(screen.getByText("Barbell hip thrust")).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/workout?start=C");
    expect(link.className.split(/\s+/)).toContain("lg:hidden");
    expectTokensOnly("components/session-bar.tsx");
  });

  it("shows the letter and En cours only once every set is done", async () => {
    await i18n.changeLanguage("fr");
    const all = C.slots.flatMap((s, i) =>
      Array.from({ length: s.skipped ? 0 : s.sets }, (_, r) => set(i, r, 5)),
    );
    const { link } = await show({ workout, sets: all });
    expect(screen.getByText("Séance C")).toBeTruthy();
    expect(screen.getByText("En cours")).toBeTruthy();
    expect(link.textContent).not.toMatch(/série/);
  });

  it("shows the time since the start", async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      now: Date.parse(startedAt) + 24 * 60_000 + 10_000,
    });
    await show({ workout, sets: twoDone });
    expect(screen.getByText("24:10")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("24:11")).toBeTruthy();
  });

  it("a tap reopens the session", async () => {
    const { link } = await show({ workout, sets: twoDone });
    fireEvent.click(link);
    expect(await screen.findByRole("heading", { name: "Session" })).toBeTruthy();
  });

  it("rises in and fades out", async () => {
    const onAnimationEnd = vi.fn();
    const { link } = await show({ workout, sets: twoDone });
    expect(link.className.split(/\s+/)).toContain("animate-rise-in");
    cleanup();
    const leaving = await show({ workout, sets: twoDone, leaving: true, onAnimationEnd });
    expect(leaving.link.className.split(/\s+/)).toContain("animate-fade-out");
    fireEvent.animationEnd(leaving.link);
    expect(onAnimationEnd).toHaveBeenCalledOnce();
  });
});
