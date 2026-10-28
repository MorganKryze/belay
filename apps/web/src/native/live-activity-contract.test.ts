import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { workPosition, type Workout } from "@belay/shared/training/workout";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import "@/i18n/lazy";
import { body, cases, fields, swift } from "@/test/swift";
import { type ActivityStatus, liveActivityOf } from "./live-activity";

// The page describes the open session as JSON and the iPhone app decodes it into Swift types by
// their field names: a key renamed, added or dropped on one side alone would make every update
// fail to decode. Both sides are read here, so such a drift fails before it reaches a phone.
const shared = swift("Shared/SessionActivity.swift");
const contentState = fields(body(shared, "struct", "ContentState"), "var");
const statuses = cases(body(shared, "enum", "Status"));
const payload = fields(
  body(swift("App/LiveActivity.swift"), "struct", "SessionActivityPayload"),
  "let",
);

const NOW = Date.parse("2026-10-28T18:00:00.000Z");
const A = sessionByCode("A", starterProgram)!;
const workout: Workout = {
  id: "0192c3a0-0000-7000-8000-000000000001",
  sessionCode: "A",
  plan: [...A.slots],
  startedAt: new Date(NOW - 600_000).toISOString(),
  endedAt: null,
  note: null,
  exerciseNotes: {},
  removed: false,
};
const t = () => i18n.getFixedT("fr") as TFunction;
// A session with its first set due, and the same once that set is logged and its rest runs.
const due = () =>
  liveActivityOf(
    { workout, sets: [] },
    { workoutId: workout.id, slotIndex: 0, restEndsAt: null },
    "all",
    NOW,
    t(),
  )!;
const resting = () =>
  liveActivityOf(
    {
      workout,
      sets: [
        {
          id: "s0-0",
          workoutId: workout.id,
          slotIndex: 0,
          position: workPosition(0),
          exerciseId: A.slots[0]!.exerciseId,
          warmup: false,
          weightKg: 80,
          reps: 8,
          rir: 1,
          doneAt: new Date(NOW - 30_000).toISOString(),
          removed: false,
        },
      ],
    },
    {
      workoutId: workout.id,
      slotIndex: 0,
      restEndsAt: new Date(NOW + 120_000).toISOString(),
    },
    "all",
    NOW,
    t(),
  )!;

describe("the lock screen description and the iPhone app's types", () => {
  it("the description's state keys are the Swift ContentState's fields, no more, no less", () => {
    for (const activity of [due(), resting()]) {
      expect(Object.keys(activity.state).sort()).toEqual(contentState);
    }
    expect(resting().state.status).toBe("rest");
  });

  it("its status values are the Swift Status cases", () => {
    // Every status of the description's own type, checked by the compiler: a status added there
    // fails to compile here until it is listed, and the comparison then fails until Swift has it.
    const all = { due: true, rest: true, paused: true, done: true } satisfies Record<
      ActivityStatus,
      true
    >;
    expect(Object.keys(all).sort()).toEqual(statuses);
  });

  it("the description's top keys are the Swift payload's fields", () => {
    for (const activity of [due(), resting()]) {
      expect(Object.keys(activity).sort()).toEqual(payload);
    }
  });
});
