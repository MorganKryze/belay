import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { workPosition, type Workout } from "@belay/shared/training/workout";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import "@/i18n/lazy";
import { type ActivityStatus, liveActivityOf } from "./live-activity";

// The page describes the open session as JSON and the iPhone app decodes it into Swift types by
// their field names: a key renamed, added or dropped on one side alone would make every update
// fail to decode. Both sides are read here, so such a drift fails before it reaches a phone.
const app = join(dirname(fileURLToPath(import.meta.url)), "../../../ios/ios/App");
const swift = (path: string) => readFileSync(join(app, path), "utf8");

// The body of `struct <name>` or `enum <name>`, between its brace and the one that closes it.
function body(source: string, kind: "struct" | "enum", name: string): string {
  const start = new RegExp(`\\b${kind} ${name}\\b[^{]*\\{`).exec(source);
  if (!start) throw new Error(`${kind} ${name} not found`);
  const from = start.index + start[0].length;
  let depth = 1;
  for (let i = from; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(from, i);
  }
  throw new Error(`${kind} ${name} is not closed`);
}
// The stored properties declared right in a body: what a nested function or type declares inside
// its own braces is left out.
function fields(block: string, keyword: "var" | "let"): string[] {
  const nested = /\{[^{}]*\}/g;
  let outer = block;
  while (nested.test(outer)) outer = outer.replace(nested, "");
  return [...outer.matchAll(new RegExp(`^\\s*${keyword} (\\w+):`, "gm"))].map((m) => m[1]!).sort();
}

const shared = swift("Shared/SessionActivity.swift");
const contentState = fields(body(shared, "struct", "ContentState"), "var");
const statuses = /\bcase ([\w, ]+)/
  .exec(body(shared, "enum", "Status"))![1]!
  .split(",")
  .map((s) => s.trim())
  .sort();
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
