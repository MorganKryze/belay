import { describe, expect, it } from "vitest";
import { sessionByCode, starterProgram } from "../../training/program";
import { DEFAULT_SCHEDULE, SEED, seedId } from "../../training/stored-program";
import { mergeFields } from "../merge";
import { type Change, ChangeSchema } from "../schema";
import { isValidChange } from "../valid";
import { changesFromRows, countsOf, type ExportRows, overlapCount } from "./changes";

const T = (m: number) => new Date(Date.UTC(2026, 10, 20, 7, m)).toISOString();
const EXPORTED = new Date(Date.UTC(2026, 10, 26, 9, 0)).toISOString();
const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d${String(n).padStart(2, "0")}`;
const PLAN = [...sessionByCode("A", starterProgram)!.slots];
const seeded = SEED.slots[0]!;
const bench = {
  ...seeded,
  repRange: [...seeded.repRange] as [number, number],
  rirTarget: [...seeded.rirTarget] as [number, number],
};
const schedule = { mode: DEFAULT_SCHEDULE.mode, days: [...DEFAULT_SCHEDULE.days] };

const empty = (): ExportRows => ({
  weights: [],
  measures: [],
  intake: [],
  supplements: [],
  supplementLogs: [],
  annotations: [],
  steps: [],
  activities: [],
  workouts: [],
  sets: [],
  programs: [],
  programSessions: [],
  programSlots: [],
  activeProgram: null,
  target: null,
  profile: null,
});

const workout = (n: number, at: (k: number) => string | null) => ({
  id: id(n),
  sessionCode: "A",
  sessionId: seedId(1),
  sessionName: "Poussée",
  plan: PLAN,
  planAt: at(60),
  startedAt: T(n),
  startedAtAt: at(61),
  endedAt: T(n + 1),
  endedAtAt: at(62),
  note: "bonne séance",
  noteAt: at(63),
  exerciseNotes: { "0": "coudes serrés" },
  exerciseNotesAt: at(64),
  removed: at(65) !== null,
  removedAt: at(65),
});

// Every kind, one row with every field time set (each time unique), one with none, tombstones.
function fixture(): ExportRows {
  const all = (k: number) => T(100 + k);
  const none = () => null;
  return {
    weights: [
      { date: "2026-11-20", weightKg: 80.4, at: T(1) },
      { date: "2026-11-19", weightKg: null, at: T(2) },
    ],
    measures: [
      {
        date: "2026-11-20",
        waistCm: 85,
        waistAt: T(3),
        neckCm: 38,
        neckAt: T(4),
        hipCm: 99.5,
        hipAt: T(5),
      },
      {
        date: "2026-11-19",
        waistCm: null,
        waistAt: null,
        neckCm: null,
        neckAt: null,
        hipCm: null,
        hipAt: null,
      },
    ],
    intake: [
      { date: "2026-11-20", kcal: 2400, kcalAt: T(6), proteinG: 140, proteinAt: T(7) },
      { date: "2026-11-19", kcal: null, kcalAt: null, proteinG: null, proteinAt: null },
    ],
    supplements: [
      {
        id: id(10),
        name: "Créatine",
        nameAt: T(8),
        kind: "creatine",
        removed: true,
        removedAt: T(9),
      },
      {
        id: id(11),
        name: "Magnésium",
        nameAt: T(10),
        kind: "other",
        removed: false,
        removedAt: null,
      },
    ],
    supplementLogs: [{ supplementId: id(10), date: "2026-11-20", taken: true, at: T(11) }],
    annotations: [
      {
        id: id(12),
        date: "2026-11-20",
        type: "deload",
        label: "semaine légère",
        fieldsAt: T(12),
        removed: true,
        removedAt: T(13),
      },
      {
        id: id(13),
        date: "2026-11-18",
        type: "note",
        label: null,
        fieldsAt: T(14),
        removed: false,
        removedAt: null,
      },
    ],
    steps: [
      { date: "2026-11-20", steps: 9400, stepsAt: T(15) },
      { date: "2026-11-19", steps: null, stepsAt: null },
    ],
    activities: [
      {
        id: id(14),
        date: "2026-11-20",
        type: "climbing",
        durationMin: 90,
        cardioType: null,
        climbStyle: "boulder",
        climbRuns: 14,
        climbGrade: "6b+",
        climbColor: null,
        fieldsAt: T(16),
        removed: true,
        removedAt: T(17),
      },
    ],
    workouts: [workout(20, all), workout(30, none)],
    sets: [
      {
        id: id(21),
        workoutId: id(20),
        slotIndex: 0,
        position: 3,
        exerciseId: PLAN[0]!.exerciseId,
        warmup: false,
        weightKg: 62.5,
        reps: 7,
        seconds: null,
        rir: 1,
        doneAt: T(35),
        fieldsAt: T(36),
        removed: true,
        removedAt: T(37),
      },
      {
        id: id(22),
        workoutId: id(30),
        slotIndex: 0,
        position: 0,
        exerciseId: PLAN[0]!.exerciseId,
        warmup: true,
        weightKg: 40,
        reps: 10,
        seconds: null,
        rir: null,
        doneAt: T(38),
        fieldsAt: T(39),
        removed: false,
        removedAt: null,
      },
    ],
    programs: [
      {
        id: id(40),
        name: "Hiver",
        nameAt: T(40),
        schedule,
        scheduleAt: T(41),
        removed: true,
        removedAt: T(42),
      },
      {
        id: id(41),
        name: null,
        nameAt: null,
        schedule,
        scheduleAt: null,
        removed: false,
        removedAt: null,
      },
    ],
    programSessions: [
      {
        id: id(42),
        name: "Jambes",
        nameAt: T(43),
        programId: id(40),
        position: 0,
        placeAt: T(44),
        removed: true,
        removedAt: T(45),
      },
      {
        id: id(43),
        name: null,
        nameAt: null,
        programId: id(41),
        position: 1,
        placeAt: null,
        removed: false,
        removedAt: null,
      },
    ],
    programSlots: [
      {
        ...bench,
        measure: null,
        id: id(44),
        sessionId: id(42),
        positionAt: T(46),
        exerciseAt: T(47),
        repsAt: T(48),
        setsAt: T(49),
        rirAt: T(50),
        restAt: T(51),
        warmupsAt: T(52),
        mainAt: T(53),
        groupAt: T(54),
        ruleAt: T(55),
        removed: true,
        removedAt: T(56),
      },
      {
        ...bench,
        measure: null,
        id: id(45),
        sessionId: id(43),
        positionAt: null,
        exerciseAt: null,
        repsAt: null,
        setsAt: null,
        rirAt: null,
        restAt: null,
        warmupsAt: null,
        mainAt: null,
        groupAt: null,
        ruleAt: null,
        removed: false,
        removedAt: null,
      },
    ],
    activeProgram: { programId: id(41), at: T(57) },
    target: { minPct: 0.6, maxPct: 0.9, at: T(58) },
    profile: {
      formula: "male",
      formulaAt: T(59),
      birthYear: 1990,
      birthYearAt: T(70),
      heightCm: 180,
      heightAt: T(71),
    },
  };
}

// Every field time a row holds, and the start of each session (its creation's time).
function timesOf(rows: ExportRows): string[] {
  const out: string[] = [];
  const walk = (row: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(row))
      if (
        typeof v === "string" &&
        (k === "at" || (k.endsWith("At") && k !== "endedAt" && k !== "doneAt"))
      )
        out.push(v);
  };
  for (const v of Object.values(rows))
    for (const row of Array.isArray(v) ? v : v ? [v] : []) walk(row as Record<string, unknown>);
  return out;
}

describe("the changes that rebuild exported rows", () => {
  it("rebuilds each written field with its own time, every kind", () => {
    const rows = fixture();
    const changes = changesFromRows(rows, EXPORTED);
    for (const c of changes) {
      expect(ChangeSchema.safeParse(c).success, JSON.stringify(c)).toBe(true);
      expect(isValidChange(c), JSON.stringify(c)).toBe(true);
    }
    const times = changes.map((c) => c.at).filter((at) => at !== EXPORTED);
    expect([...new Set(times)].toSorted()).toEqual([...new Set(timesOf(rows))].toSorted());
    // One creation per program, program session and slot, at the export's time.
    expect(changes.filter((c) => c.at === EXPORTED)).toHaveLength(6);
    expect(changes).toContainEqual({
      kind: "set",
      id: id(21),
      workoutId: id(20),
      field: "removed",
      value: true,
      at: T(37),
    });
    expect(changes).toContainEqual({
      kind: "programSlot",
      id: id(44),
      field: "rest",
      value: bench.restSec,
      at: T(51),
    });
    expect(changes).toContainEqual({
      kind: "weight",
      date: "2026-11-19",
      weightKg: null,
      at: T(2),
    });
    const kinds = new Set(changes.map((c) => c.kind));
    expect(kinds.size).toBe(16);
  });

  it("carries a set's values after its creation, at the time they were written", () => {
    const changes = changesFromRows(fixture(), EXPORTED);
    expect(changes).toContainEqual({
      kind: "set",
      id: id(21),
      workoutId: id(20),
      field: "values",
      weightKg: 62.5,
      reps: 7,
      seconds: null,
      rir: 1,
      at: T(36),
    });
  });

  it("gives a set already stored the file's later values through the one merge", () => {
    const rows = fixture();
    rows.sets = [{ ...rows.sets[1]!, weightKg: 85, fieldsAt: T(50) }];
    const values = changesFromRows(rows, EXPORTED).filter(
      (c): c is Extract<Change, { kind: "set"; field: "values" }> =>
        c.kind === "set" && c.field === "values",
    );
    const stored = new Map([[id(22), T(40)]]);
    const won = mergeFields(stored, values, (c) => c.id, new Date(EXPORTED));
    expect(won.map((c) => c.weightKg)).toEqual([85]);
    // On a store that wrote the same time, what is stored stays.
    expect(
      mergeFields(new Map([[id(22), T(50)]]), values, (c) => c.id, new Date(EXPORTED)),
    ).toEqual([]);
  });

  it("carries the creatine flag only where the name would decide otherwise", () => {
    const rows = empty();
    const sup = (n: number, name: string, kind: "creatine" | "other") => ({
      id: id(n),
      name,
      nameAt: T(n),
      kind,
      removed: false,
      removedAt: null,
    });
    rows.supplements = [
      sup(1, "Créatine", "creatine"),
      sup(2, "Créatine", "other"),
      sup(3, "Magnésium", "creatine"),
      sup(4, "Magnésium", "other"),
    ];
    const flags = changesFromRows(rows, EXPORTED).map((c) => ("creatine" in c ? c.creatine : "-"));
    expect(flags).toEqual(["-", false, true, "-"]);
  });

  it("gives the same changes for the same rows", () => {
    expect(changesFromRows(fixture(), EXPORTED)).toEqual(changesFromRows(fixture(), EXPORTED));
  });
});

describe("the values an import would meet on both sides", () => {
  it("counts a value on both sides with other contents, and not an equal one or one side's only", () => {
    const here = fixture();
    expect(overlapCount(here, fixture())).toEqual({ count: 0, values: [] });
    expect(overlapCount(here, empty())).toEqual({ count: 0, values: [] });
    expect(overlapCount(empty(), here)).toEqual({ count: 0, values: [] });

    const other = fixture();
    other.weights[0]!.weightKg = 79;
    other.measures[0]!.neckCm = 39;
    other.intake[0]!.kcal = 2500;
    other.steps[0]!.steps = 9000;
    other.supplements[1]!.name = "Zinc";
    other.supplementLogs[0]!.taken = false;
    other.annotations[1]!.label = "repos";
    other.activities[0]!.durationMin = 60;
    other.workouts[0]!.note = "dure";
    other.sets[1]!.reps = 9;
    other.programs[0]!.name = "Été";
    other.programSessions[0]!.position = 2;
    other.programSlots[0]!.restSec = 90;
    other.activeProgram = { programId: id(40), at: T(80) };
    other.target = { minPct: 0.5, maxPct: 0.9, at: T(81) };
    other.profile = { ...other.profile!, heightCm: 181 };
    // Only on one side: never an overlap.
    other.weights.push({ date: "2026-11-21", weightKg: 80, at: T(82) });
    // Only a time differs: the same value.
    other.supplementLogs[0]!.at = T(83);

    const { count, values } = overlapCount(here, other);
    expect(values).toEqual([
      { kind: "weights", key: "2026-11-20", field: "weightKg" },
      { kind: "measures", key: "2026-11-20", field: "neckCm" },
      { kind: "intake", key: "2026-11-20", field: "kcal" },
      { kind: "supplements", key: id(11), field: "name" },
      { kind: "supplementLogs", key: `${id(10)}/2026-11-20`, field: "taken" },
      { kind: "annotations", key: id(13), field: "label" },
      { kind: "steps", key: "2026-11-20", field: "steps" },
      { kind: "activities", key: id(14), field: "durationMin" },
      { kind: "workouts", key: id(20), field: "note" },
      { kind: "sets", key: id(22), field: "reps" },
      { kind: "programs", key: id(40), field: "name" },
      { kind: "programSessions", key: id(42), field: "position" },
      { kind: "programSlots", key: id(44), field: "restSec" },
      { kind: "activeProgram", key: "", field: "programId" },
      { kind: "target", key: "", field: "minPct" },
      { kind: "profile", key: "", field: "heightCm" },
    ]);
    expect(count).toBe(16);
  });

  it("leaves out a value the file never wrote", () => {
    const other = fixture();
    other.programs[1]!.name = "Printemps";
    other.programSlots[1]!.restSec = 60;
    expect(overlapCount(fixture(), other)).toEqual({ count: 0, values: [] });
  });

  it("reads the same value whatever the order of its keys", () => {
    const other = fixture();
    other.programs[0]!.schedule = { days: [...schedule.days], mode: schedule.mode };
    other.workouts[0]!.plan = other.workouts[0]!.plan.map((slot) =>
      Object.fromEntries(Object.entries(slot).toReversed()),
    ) as typeof PLAN;
    expect(overlapCount(fixture(), other)).toEqual({ count: 0, values: [] });
  });

  it("reads an absent value as none", () => {
    const other = fixture();
    delete other.workouts[0]!.sessionName;
    const here = fixture();
    here.workouts[0]!.sessionName = null;
    expect(overlapCount(here, other)).toEqual({ count: 0, values: [] });
    expect(overlapCount(other, here)).toEqual({ count: 0, values: [] });
  });

  it("counts 0, 1 and 2 sessions", () => {
    const rows = empty();
    expect(countsOf(rows).sessions).toBe(0);
    rows.workouts = [workout(20, () => null)];
    expect(countsOf(rows).sessions).toBe(1);
    rows.workouts.push(workout(30, () => null));
    expect(countsOf(rows).sessions).toBe(2);
    rows.workouts.push(workout(40, (k) => T(k)));
    expect(countsOf(rows).sessions).toBe(2);

    const other = structuredClone(rows);
    other.workouts[0]!.note = "a";
    other.workouts[0]!.noteAt = T(90);
    expect(overlapCount(rows, other).count).toBe(1);
    other.workouts[1]!.note = "b";
    other.workouts[1]!.noteAt = T(91);
    expect(overlapCount(rows, other).count).toBe(2);
  });

  it("counts every kind, tombstones left out", () => {
    expect(countsOf(fixture())).toEqual({
      sessions: 1,
      sets: 1,
      activities: 0,
      weighIns: 1,
      measures: 1,
      intake: 1,
      steps: 1,
      supplements: 1,
      programs: 1,
    });
  });
});
