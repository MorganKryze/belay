import { describe, expect, it } from "vitest";
import type { ProgramSlotChange } from "../sync/schema";
import { isValidChange } from "../sync/valid";
import { moveNotes, placeSlot, type Stop, slotStops, stopOf } from "./slot-moves";
import {
  DEFAULT_SCHEDULE,
  type ProgramSlot,
  seedId,
  type StoredPrograms,
  withSeed,
} from "./stored-program";

const AT = "2026-10-25T08:00:00.000Z";
const P2 = seedId(0xa02);
const X = seedId(0xb01);
const R = (i: number) => seedId(0x1000 + i); // normal rows
const N = (i: number) => seedId(0x1100 + i); // no-climbing rows

const slot = (id: string, position: number, groupKey: string | null, rule: ProgramSlot["rule"]) =>
  ({
    id,
    sessionId: X,
    position,
    exerciseId: "ds:0025",
    sets: 3,
    repRange: [8, 12],
    rirTarget: [1, 2],
    restSec: 90,
    warmupSets: 0,
    isMain: false,
    groupKey,
    rule,
    removed: false,
  }) satisfies ProgramSlot;
// Session X with its rows given by group key, normal ones then no-climbing ones.
const rows = (
  normal: readonly (string | null)[],
  noClimbing: readonly (string | null)[] = [],
): StoredPrograms =>
  withSeed({
    programs: [{ id: P2, name: null, schedule: DEFAULT_SCHEDULE, removed: false }],
    sessions: [{ id: X, name: null, programId: P2, position: 0, removed: false }],
    slots: [
      ...normal.map((g, i) => slot(R(i), i, g, null)),
      ...noClimbing.map((g, i) => slot(N(i), i, g, "no_climbing")),
    ],
  });
const stop = (index: number, groupKey: string | null = null, rule: Stop["rule"] = null): Stop => ({
  rule,
  index,
  groupKey,
});
const NC = (index: number, groupKey: string | null = null) => stop(index, groupKey, "no_climbing");
const change = (id: string, field: "position" | "group" | "rule", value: unknown) => ({
  kind: "programSlot",
  id,
  field,
  value,
  at: AT,
});
// What placeSlot returns, checked as the phone checks it before queueing.
function placed(p: StoredPrograms, id: string, to: Stop): ProgramSlotChange[] {
  const changes = placeSlot(p, id, to, AT);
  expect(changes).not.toBeNull();
  expect(changes!.filter((c) => !isValidChange(c))).toEqual([]);
  return changes!;
}

describe("stops", () => {
  it("a plain section gives one stop per gap", () => {
    expect(slotStops(rows([null, null, null], [null]), R(0))).toEqual([
      stop(0),
      stop(1),
      stop(2),
      NC(0),
      NC(1),
    ]);
  });

  it("a group's edge gives outside then inside", () => {
    expect(slotStops(rows([null, null, "G", "G", null]), R(0))).toEqual([
      stop(0),
      stop(1),
      stop(1, "G"),
      stop(2, "G"),
      stop(3, "G"),
      stop(3),
      stop(4),
      NC(0),
    ]);
  });

  it("inside a group one stop", () => {
    const stops = slotStops(rows(["G", "G", "G", null]), R(3));
    expect(stops.filter((s) => s.index === 1)).toEqual([stop(1, "G")]);
    expect(stops.filter((s) => s.index === 2)).toEqual([stop(2, "G")]);
  });

  it("two adjacent groups give inside, outside, inside", () => {
    const stops = slotStops(rows(["G", "G", "H", "H", null]), R(4));
    expect(stops.filter((s) => s.index === 2)).toEqual([stop(2, "G"), stop(2), stop(2, "H")]);
  });

  it("the empty no-climbing section gives one stop after the normal section", () => {
    const stops = slotStops(rows([null, null]), R(1));
    expect(stops).toEqual([stop(0), stop(1), NC(0)]);
    // A grouped no-climbing section has its own edges.
    expect(slotStops(rows([null, null], ["K", "K"]), R(1)).slice(2)).toEqual([
      NC(0),
      NC(0, "K"),
      NC(1, "K"),
      NC(2, "K"),
      NC(2),
    ]);
  });

  it("leaves the lifted row out, and gives none for a row the account lacks", () => {
    expect(slotStops(rows([null]), R(0))).toEqual([stop(0), NC(0)]);
    expect(slotStops(rows([null]), seedId(0xfff))).toEqual([]);
  });

  it("finds the row's current stop by section, place and group", () => {
    const state = rows([null, "G", "G"], [null]);
    expect(slotStops(state, R(1))[stopOf(state, R(1))]).toEqual(stop(1, "G"));
    expect(slotStops(state, R(0))[stopOf(state, R(0))]).toEqual(stop(0));
    expect(slotStops(state, N(0))[stopOf(state, N(0))]).toEqual(NC(0));
    expect(stopOf(state, seedId(0xfff))).toBe(-1);
  });
});

describe("placing a row", () => {
  it("placing into a group writes its key and the positions that move", () => {
    expect(placed(rows([null, null, "G", "G"]), R(0), stop(2, "G"))).toEqual([
      change(R(0), "group", "G"),
      change(R(1), "position", 0),
      change(R(2), "position", 1),
      change(R(0), "position", 2),
    ]);
  });

  it("placing above a group clears the key", () => {
    expect(placed(rows(["G", "G", "G", null]), R(1), stop(0))).toEqual([
      change(R(1), "group", null),
      change(R(1), "position", 0),
      change(R(0), "position", 1),
    ]);
  });

  it("placing into the no-climbing section writes the rule", () => {
    expect(placed(rows([null, null], [null]), R(0), NC(1))).toEqual([
      change(R(0), "rule", "no_climbing"),
      change(R(0), "position", 1),
      change(R(1), "position", 0),
    ]);
    // Back to the normal section at the place it had in its own: no position for the row itself.
    expect(placed(rows([null, null], [null, null]), N(1), stop(1))).toEqual([
      change(N(1), "rule", null),
      change(R(1), "position", 2),
    ]);
  });

  it("the last other member of a group left behind is cleared", () => {
    expect(placed(rows(["G", "G", null]), R(0), stop(2))).toEqual([
      change(R(0), "group", null),
      change(R(1), "position", 0),
      change(R(2), "position", 1),
      change(R(0), "position", 2),
      change(R(1), "group", null),
    ]);
    // A group of three keeps its two others.
    expect(placed(rows(["G", "G", "G", null]), R(0), stop(3))).not.toContainEqual(
      expect.objectContaining({ field: "group", value: null, id: R(1) }),
    );
  });

  it("a plain row between two groups of one key stays plain where it is", () => {
    const state = rows(["K", "K", null, "K", "K"]);
    // Taking the key there would merge the two groups: only the outside stop is offered.
    expect(slotStops(state, R(2)).filter((s) => s.index === 2)).toEqual([stop(2)]);
    expect(placeSlot(state, R(2), stop(2, "K"), AT)).toBeNull();
    expect(placed(state, R(2), slotStops(state, R(2))[stopOf(state, R(2))]!)).toEqual([]);
  });

  it("a row still holding the key of a group it is alone in stays where it is", () => {
    const state = rows(["H", "H", "K", null]);
    expect(slotStops(state, R(2))[stopOf(state, R(2))]).toEqual(stop(2));
    expect(placed(state, R(2), slotStops(state, R(2))[stopOf(state, R(2))]!)).toEqual([]);
    expect(moveNotes(state, R(2), stop(2))).toEqual([]);
  });

  it("a row alone with a key loses it next to a group of that key", () => {
    expect(placed(rows(["K", "K", null, "K"]), R(3), stop(2))).toEqual([
      change(R(3), "group", null),
      change(R(3), "position", 2),
      change(R(2), "position", 3),
    ]);
  });

  it("leaving a group for another of the same key clears the one left behind", () => {
    const state = rows(["K", "K", null, "K", "K"]);
    expect(placed(state, R(0), stop(3, "K"))).toEqual([
      change(R(1), "position", 0),
      change(R(2), "position", 1),
      change(R(3), "position", 2),
      change(R(0), "position", 3),
      change(R(1), "group", null),
    ]);
    expect(moveNotes(state, R(0), stop(3, "K"))).toEqual(["leaveGroup", "joinGroup"]);
  });

  it("a row leaving a group of two clears the other even when its key comes back further down", () => {
    expect(placed(rows(["K", "K", null, "K", "K", "K"]), R(0), stop(2))).toEqual([
      change(R(0), "group", null),
      change(R(1), "position", 0),
      change(R(2), "position", 1),
      change(R(0), "position", 2),
      change(R(1), "group", null),
    ]);
  });

  it("the only row between two runs of one key leaves them apart: the lower takes a key of its own", () => {
    const apart = rows(["G", "G", null, "G", "G"]);
    const key = (id: string) => id.replace(/-/g, "").slice(-12);
    expect(placed(apart, R(2), stop(0))).toEqual([
      change(R(2), "position", 0),
      change(R(0), "position", 1),
      change(R(1), "position", 2),
      change(R(3), "group", key(R(3))),
      change(R(4), "group", key(R(3))),
    ]);
    expect(placed(apart, R(2), NC(0))).toEqual([
      change(R(2), "rule", "no_climbing"),
      change(R(2), "position", 0),
      change(R(3), "position", 2),
      change(R(4), "position", 3),
      change(R(3), "group", key(R(3))),
      change(R(4), "group", key(R(3))),
    ]);
    // Joining the lower run, the row leaves the upper one a key of its own instead.
    expect(placed(apart, R(2), stop(3, "G"))).toEqual([
      change(R(2), "group", "G"),
      change(R(3), "position", 2),
      change(R(2), "position", 3),
      change(R(0), "group", key(R(0))),
      change(R(1), "group", key(R(0))),
    ]);
  });

  it("writes nothing for the row's own stop, and refuses a stop it does not offer", () => {
    const state = rows([null, "G", "G"]);
    expect(placed(state, R(1), slotStops(state, R(1))[stopOf(state, R(1))]!)).toEqual([]);
    expect(placeSlot(state, R(0), stop(1, "Z"), AT)).toBeNull();
    expect(placeSlot(state, R(0), stop(9), AT)).toBeNull();
    expect(placeSlot(state, seedId(0xfff), stop(0), AT)).toBeNull();
  });
});

describe("move notes", () => {
  it("notes say join, leave, to the section, back to permanent", () => {
    const state = rows([null, "G", "G", "H", "H"], [null]);
    expect(moveNotes(state, R(0), stop(1, "G"))).toEqual(["joinGroup"]);
    expect(moveNotes(state, R(1), stop(0))).toEqual(["leaveGroup"]);
    expect(moveNotes(state, R(2), stop(2, "H"))).toEqual(["leaveGroup", "joinGroup"]);
    expect(moveNotes(state, R(0), NC(1))).toEqual(["toNoClimbing"]);
    expect(moveNotes(state, N(0), stop(5))).toEqual(["toPermanent"]);
    expect(moveNotes(state, R(1), NC(0))).toEqual(["leaveGroup", "toNoClimbing"]);
    expect(moveNotes(state, R(1), stop(1, "G"))).toEqual([]);
  });
});
