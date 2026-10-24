import { describe, expect, it } from "vitest";
import { MIN_WEIGH_IN_DATE } from "../body/weighings";
import { sessionByCode, starterProgram } from "../training/program";
import { DEFAULT_SCHEDULE } from "../training/stored-program";
import { MAX_CHANGES } from "./limits";
import {
  clampAt,
  isNewer,
  mergeFields,
  mergeSlotChange,
  mergeTarget,
  mergeWeights,
  staleKeys,
} from "./merge";
import {
  type Change,
  ChangeSchema,
  type ProgramSlotChange,
  type ProgramSlotRow,
  SyncRequestSchema,
  SyncResponseSchema,
  type TargetChange,
  type WeightChange,
} from "./schema";
import { isRecordable, isRecordableWeight, isValidChange } from "./valid";

const AT = "2026-10-07T06:30:00.000Z";
const weight = (date: string, weightKg: number | null, at = AT): WeightChange => ({
  kind: "weight",
  date,
  weightKg,
  at,
});
const target = (minPct: number, maxPct: number, at = AT): TargetChange => ({
  kind: "target",
  minPct,
  maxPct,
  at,
});
const ACCOUNT = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d8e";
const ID = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d8f"; // a supplement or an annotation
const year = new Date().getUTCFullYear();
// One sample of every new kind, as the phone writes them.
const SAMPLES: Change[] = [
  { kind: "measure", date: "2026-10-06", field: "waist", value: 82, at: AT },
  { kind: "measure", date: "2026-10-06", field: "neck", value: null, at: AT },
  { kind: "intake", date: "2026-10-07", field: "kcal", value: 2130, at: AT },
  { kind: "intake", date: "2026-10-07", field: "protein", value: 140, at: AT },
  { kind: "profile", field: "formula", value: "male", at: AT },
  { kind: "profile", field: "birthYear", value: 1995, at: AT },
  { kind: "profile", field: "height", value: null, at: AT },
  { kind: "supplement", id: ID, field: "name", value: "Créatine", at: AT },
  { kind: "supplement", id: ID, field: "removed", value: true, at: AT },
  { kind: "supplementLog", supplementId: ID, date: "2026-10-07", taken: true, at: AT },
  {
    kind: "annotation",
    id: ID,
    field: "fields",
    date: "2026-09-15",
    type: "diet_break",
    label: null,
    at: AT,
  },
  { kind: "annotation", id: ID, field: "removed", value: true, at: AT },
];
const WORKOUT = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d90";
const SET = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d91";
const PLAN = [...sessionByCode("A", starterProgram)!.slots];
const LATER = "2026-10-07T06:45:00.000Z";
// A session and its sets, as the phone writes them.
const SESSION: Change[] = [
  {
    kind: "workout",
    id: WORKOUT,
    field: "start",
    sessionCode: "A",
    plan: PLAN,
    startedAt: AT,
    at: AT,
  },
  {
    kind: "set",
    id: SET,
    workoutId: WORKOUT,
    field: "create",
    slotIndex: 0,
    position: 3,
    exerciseId: "ds:0025",
    warmup: false,
    weightKg: 82.5,
    reps: 8,
    rir: 1,
    doneAt: LATER,
    at: LATER,
  },
  {
    kind: "set",
    id: ID,
    workoutId: WORKOUT,
    field: "create",
    slotIndex: 0,
    position: 0,
    exerciseId: "ds:0025",
    warmup: true,
    weightKg: 40,
    reps: 8,
    rir: null,
    doneAt: AT,
    at: AT,
  },
  {
    kind: "set",
    id: SET,
    workoutId: WORKOUT,
    field: "values",
    weightKg: 85,
    reps: 6,
    rir: null,
    at: LATER,
  },
  { kind: "set", id: SET, workoutId: WORKOUT, field: "removed", value: true, at: LATER },
  { kind: "workout", id: WORKOUT, field: "ended", value: LATER, at: LATER },
  { kind: "workout", id: WORKOUT, field: "ended", value: null, at: LATER },
  { kind: "workout", id: WORKOUT, field: "note", value: "Bonne séance", at: LATER },
  { kind: "workout", id: WORKOUT, field: "note", value: null, at: LATER },
  {
    kind: "workout",
    id: WORKOUT,
    field: "exerciseNotes",
    value: { "0": "Prise large" },
    at: LATER,
  },
  { kind: "workout", id: WORKOUT, field: "removed", value: true, at: LATER },
];
const request = (changes: unknown[], cursor = "0") =>
  SyncRequestSchema.safeParse({ account: ACCOUNT, cursor, changes });

describe("SyncRequestSchema", () => {
  it("accepts a weigh-in, a deletion and a target range", () => {
    const changes: Change[] = [
      weight("2026-10-07", 79.8),
      weight("2026-10-06", null),
      target(0.5, 1),
    ];
    expect(request(changes).success).toBe(true);
  });

  it.each([
    ["under 20 kg", weight("2026-10-07", 19.9)],
    ["over 400 kg", weight("2026-10-07", 400.1)],
    ["finer than 0.1 kg", weight("2026-10-07", 79.85)],
    ["an impossible date", weight("2027-02-29", 80)],
    ["a day before 1900", weight("1899-12-31", 80)],
    ["year 0000", weight("0000-01-01", 80)],
    ["a time with an offset", weight("2026-10-07", 80, "2026-10-07T08:30:00+02:00")],
    ["a range under 0.25 %", target(0.2, 1)],
    ["a range over 1 %", target(0.5, 1.05)],
    ["bounds closer than 0.1", target(0.9, 0.95)],
    ["an unknown kind", { kind: "waist", date: "2026-10-07", at: AT }],
  ])("refuses %s", (_, change) => {
    expect(request([change]).success).toBe(false);
  });

  it("accepts every new kind of change", () => {
    for (const change of SAMPLES)
      expect(request([change]).success, JSON.stringify(change)).toBe(true);
  });

  it.each([
    ["a waist under 40 cm", { ...SAMPLES[0], value: 39.5 }],
    ["a neck over 80 cm", { ...SAMPLES[1], value: 80.5 }],
    ["a measurement finer than 0.1 cm", { ...SAMPLES[0], value: 82.25 }],
    ["an unknown measurement", { ...SAMPLES[0], field: "chest" }],
    ["fractional calories", { ...SAMPLES[2], value: 2100.5 }],
    ["over 10 000 kcal", { ...SAMPLES[2], value: 10_050 }],
    ["over 500 g of protein", { ...SAMPLES[3], value: 505 }],
    ["an intake dated before 1900", { ...SAMPLES[2], date: "1899-12-31" }],
    ["an unknown formula", { ...SAMPLES[4], value: "other" }],
    ["a birth year for an age over 101", { ...SAMPLES[5], value: year - 102 }],
    ["a birth year for an age under 14", { ...SAMPLES[5], value: year - 13 }],
    ["a height of 231 cm", { ...SAMPLES[6], value: 231 }],
    ["a height in half centimetres", { ...SAMPLES[6], value: 178.5 }],
    ["an empty supplement name", { ...SAMPLES[7], value: "  " }],
    ["a supplement name of 41 characters", { ...SAMPLES[7], value: "x".repeat(41) }],
    ["a supplement id that is not a UUID", { ...SAMPLES[7], id: "creatine" }],
    ["a name sent as a removal", { ...SAMPLES[8], value: "Créatine" }],
    ["a tick without its day", { ...SAMPLES[9], date: undefined }],
    ["an annotation text of 81 characters", { ...SAMPLES[10], label: "x".repeat(81) }],
    ["an unknown annotation type", { ...SAMPLES[10], type: "holiday" }],
    ["an annotation field that does not exist", { ...SAMPLES[11], field: "label" }],
  ])("refuses %s", (_, change) => {
    expect(request([change]).success).toBe(false);
  });

  it("accepts a session and its sets", () => {
    expect(request(SESSION).success).toBe(true);
  });

  it("refuses a session or a set out of bounds", () => {
    const [start, create, , values] = SESSION as [Change, Change, Change, Change];
    const refused = [
      { ...start, sessionCode: "a" },
      { ...start, plan: [] },
      { ...start, plan: Array.from({ length: 31 }, () => PLAN[0]) },
      { ...start, plan: [{ ...PLAN[0], sets: 11 }] },
      { ...start, startedAt: "1899-12-31T23:00:00.000Z" },
      { ...create, exerciseId: "bench" },
      { ...create, slotIndex: 30 },
      { ...create, position: 50 },
      { ...create, weightKg: 80.1 },
      { ...create, weightKg: 500.25 },
      { ...create, reps: 101 },
      { ...create, rir: 5 },
      { ...values, reps: 7.5 },
      { kind: "workout", id: WORKOUT, field: "note", value: "x".repeat(501), at: AT },
      { kind: "workout", id: WORKOUT, field: "exerciseNotes", value: { "30": "x" }, at: AT },
    ];
    for (const change of refused)
      expect(request([change]).success, JSON.stringify(change).slice(0, 120)).toBe(false);
  });

  it("accepts the first day of 1900, the floor of a weigh-in date", () => {
    expect(MIN_WEIGH_IN_DATE).toBe("1900-01-01");
    expect(request([weight("1900-01-01", 80)]).success).toBe(true);
  });

  it("names the account it belongs to", () => {
    expect(SyncRequestSchema.safeParse({ cursor: "0", changes: [] }).success).toBe(false);
    expect(SyncRequestSchema.safeParse({ account: "me", cursor: "0", changes: [] }).success).toBe(
      false,
    );
  });

  it("takes 500 changes and refuses 501", () => {
    const many = (n: number) => Array.from({ length: n }, () => weight("2026-10-07", 80));
    expect(request(many(MAX_CHANGES)).success).toBe(true);
    expect(request(many(MAX_CHANGES + 1)).success).toBe(false);
  });

  it.each([
    ["0", true],
    ["42", true],
    ["999999999999999999", true],
    ["-1", false],
    ["01", false],
    ["1e3", false],
    ["9999999999999999999", false],
  ])("cursor %s → %s", (cursor, ok) => {
    expect(request([], cursor).success).toBe(ok);
  });
});

describe("SyncResponseSchema", () => {
  it("reads rows, a target that was never written, and the paging flag", () => {
    const parsed = SyncResponseSchema.parse({
      cursor: "12",
      weights: [{ date: "2026-10-07", weightKg: null, at: AT }],
      measures: [
        {
          date: "2026-10-06",
          waistCm: 82,
          waistAt: AT,
          neckCm: null,
          neckAt: null,
          hipCm: null,
          hipAt: null,
        },
      ],
      intake: [{ date: "2026-10-07", kcal: 2100, kcalAt: AT, proteinG: null, proteinAt: null }],
      supplements: [
        { id: ID, name: "Créatine", nameAt: AT, kind: "creatine", removed: false, removedAt: null },
      ],
      supplementLogs: [{ supplementId: ID, date: "2026-10-07", taken: true, at: AT }],
      annotations: [
        {
          id: ID,
          date: "2026-09-15",
          type: "note",
          label: "voyage",
          fieldsAt: AT,
          removed: false,
          removedAt: null,
        },
      ],
      steps: [{ date: "2026-10-07", steps: 8400, stepsAt: AT }],
      activities: [
        {
          id: ID,
          date: "2026-10-07",
          type: "climbing",
          durationMin: 90,
          cardioType: null,
          climbStyle: "boulder",
          climbRuns: 14,
          climbGrade: "6b+",
          climbColor: null,
          fieldsAt: AT,
          removed: false,
          removedAt: null,
        },
      ],
      workouts: [
        {
          id: WORKOUT,
          sessionCode: "A",
          plan: PLAN,
          planAt: null,
          startedAt: AT,
          startedAtAt: null,
          endedAt: null,
          endedAtAt: null,
          note: null,
          noteAt: null,
          exerciseNotes: {},
          exerciseNotesAt: null,
          removed: false,
          removedAt: null,
        },
      ],
      sets: [
        {
          id: SET,
          workoutId: WORKOUT,
          slotIndex: 0,
          position: 3,
          exerciseId: "ds:0025",
          warmup: false,
          weightKg: 82.5,
          reps: 8,
          seconds: null,
          rir: 1,
          doneAt: AT,
          fieldsAt: AT,
          removed: false,
          removedAt: null,
        },
      ],
      target: { minPct: 0.5, maxPct: 1, at: null },
      profile: {
        formula: null,
        formulaAt: null,
        birthYear: 1995,
        birthYearAt: AT,
        heightCm: null,
        heightAt: null,
      },
      rejected: [{ index: 3, reason: "refused" }],
      hasMore: false,
    });
    expect(parsed.weights[0]!.weightKg).toBeNull();
    expect(parsed.target?.at).toBeNull();
    expect(parsed.rejected).toEqual([{ index: 3, reason: "refused" }]);
    expect(parsed.workouts[0]!.plan).toEqual(PLAN);
    expect(parsed.sets[0]!.weightKg).toBe(82.5);
    expect(parsed.steps[0]!.steps).toBe(8400);
    expect(parsed.activities[0]!.climbGrade).toBe("6b+");
  });

  it("refuses a refusal that does not point at a change", () => {
    const answer = (rejected: unknown) =>
      SyncResponseSchema.safeParse({
        cursor: "1",
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
        target: null,
        profile: null,
        rejected,
        hasMore: false,
      }).success;
    expect(answer([{ index: 0, reason: "unknown" }])).toBe(true);
    expect(answer([{ index: 0, reason: "unknown_exercise" }])).toBe(true);
    expect(answer([{ index: 0, reason: "too_many_sets" }])).toBe(true);
    expect(answer([{ index: 0, reason: "wrong_measure" }])).toBe(true);
    expect(answer([{ index: -1, reason: "refused" }])).toBe(false);
    expect(answer([{ index: 0.5, reason: "refused" }])).toBe(false);
    expect(answer([{ index: 0, reason: "because" }])).toBe(false);
    expect(answer(undefined)).toBe(false);
  });
});

describe("isValidChange", () => {
  // The phone checks without Zod; whatever it queues, the server must accept.
  const samples: Change[] = [
    weight("2026-10-07", 79.8),
    weight("2026-10-07", null),
    weight("2028-02-29", 80),
    weight("2027-02-29", 80),
    weight("2026-10-07", 19.9),
    weight("2026-10-07", 79.85),
    weight("2026-10-07", 80, "2026-10-07T08:30:00Z"),
    weight("2026-10-07", 80, "yesterday"),
    target(0.5, 1),
    target(0.85, 0.95),
    target(0.9, 0.95),
  ];

  // The new kinds, each valid and with one field pushed out of bounds or out of shape.
  const broken = (c: Change, patch: Record<string, unknown>) => ({ ...c, ...patch }) as Change;
  const S = SAMPLES;
  const more: Change[] = [
    ...S.map((c) => broken(c, { at: "2026-10-07T06:30:00Z" })), // no milliseconds
    broken(S[0]!, { value: 200.5 }),
    broken(S[0]!, { date: "2026-02-30" }),
    broken(S[1]!, { field: "chest" }),
    broken(S[2]!, { value: 2100.5 }),
    broken(S[3]!, { value: 505 }),
    broken(S[4]!, { value: "other" }),
    broken(S[5]!, { value: 1925 }), // 101 years old in 2026
    broken(S[6]!, { value: 119 }),
    broken(S[7]!, { value: " Créatine" }), // the phone trims a name before writing it
    broken(S[7]!, { id: ID.toUpperCase() }),
    broken(S[8]!, { value: "yes" }),
    broken(S[9]!, { supplementId: "x" }),
    broken(S[9]!, { taken: "yes" }),
    broken(S[10]!, { label: "a\nb" }),
    broken(S[10]!, { type: "holiday" }),
    broken(S[11]!, { field: "label" }),
  ];

  it("accepts nothing the server would refuse", () => {
    for (const change of [...samples, ...SAMPLES, ...more])
      if (isValidChange(change))
        expect(ChangeSchema.safeParse(change).success, JSON.stringify(change)).toBe(true);
  });

  // A session's changes, each valid, then pushed out of bounds or out of shape.
  const [start, create, warmup, values] = SESSION as [Change, Change, Change, Change];
  const brokenSession: Change[] = [
    broken(start, { id: "x" }),
    broken(start, { sessionCode: "AB" }),
    broken(start, { plan: [{ ...PLAN[0], restSec: 901 }] }),
    broken(start, { startedAt: "2026-10-07T06:30:00.001Z" }), // after the change's own time
    broken(create, { workoutId: "x" }),
    broken(create, { warmup: true }), // position 3 is a work set
    broken(warmup, { rir: 2 }), // a warm-up has no RIR
    broken(create, { position: 50 }),
    broken(create, { exerciseId: "ds:" }),
    broken(create, { weightKg: 82.6 }),
    broken(create, { doneAt: "2026-10-07T06:46:00.000Z" }),
    broken(values, { rir: 4.5 }),
    broken(SESSION[5]!, { value: "2026-10-07T06:46:00.000Z" }),
    broken(SESSION[7]!, { value: "  " }), // an empty note is a null one
    broken(SESSION[9]!, { value: { "0": "" } }),
    broken(SESSION[10]!, { value: "yes" }),
  ];

  it("accepts a session's changes as the phone writes them, and refuses each broken one", () => {
    expect(SESSION.filter((c) => !isValidChange(c))).toEqual([]);
    expect(brokenSession.filter(isValidChange)).toEqual([]);
    for (const change of [...SESSION, ...brokenSession])
      if (isValidChange(change))
        expect(ChangeSchema.safeParse(change).success, JSON.stringify(change)).toBe(true);
  });

  it("accepts every new kind as the phone writes it, and refuses each broken one", () => {
    expect(SAMPLES.every(isValidChange)).toBe(true);
    expect(more.filter(isValidChange)).toEqual([]);
  });

  it("checks a birth year against the year of the change, for ages 15 to 100", () => {
    const born = (value: number, at = "2026-10-07T06:30:00.000Z"): Change => ({
      kind: "profile",
      field: "birthYear",
      value,
      at,
    });
    expect([1926, 2011, 1925, 2012].map((y) => isValidChange(born(y)))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(isValidChange(born(2012, "2027-01-01T00:00:00.000Z"))).toBe(true);
  });

  it("accepts what the phone writes and refuses the rest", () => {
    expect(samples.map(isValidChange)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false, // the phone always writes milliseconds, as toISOString() does
      false,
      true,
      true,
      false,
    ]);
  });
});

describe("steps, activities, a session's own plan and start, timed sets (spec §7)", () => {
  const plan = [...sessionByCode("C", starterProgram)!.slots];
  const climb: Change = {
    kind: "activity",
    id: ID,
    field: "fields",
    date: "2026-10-07",
    type: "climbing",
    durationMin: 90,
    cardioType: null,
    climbStyle: "boulder",
    climbRuns: 14,
    climbGrade: "6b+",
    climbColor: null,
    at: AT,
  };
  const cardio: Change = {
    ...climb,
    type: "cardio",
    durationMin: 45,
    cardioType: "bike",
    climbStyle: null,
    climbRuns: null,
    climbGrade: null,
  } as Change;
  const timed: Change = {
    kind: "set",
    id: SET,
    workoutId: WORKOUT,
    field: "create",
    slotIndex: 8,
    position: 3,
    exerciseId: "ds:2135",
    warmup: false,
    weightKg: 0,
    reps: null,
    seconds: 45,
    rir: null,
    doneAt: AT,
    at: AT,
  };
  const NEW: Change[] = [
    { kind: "steps", date: "2026-10-07", value: 8400, at: AT },
    { kind: "steps", date: "2026-10-07", value: null, at: AT },
    climb,
    { ...climb, climbGrade: null, climbColor: "blue" } as Change,
    cardio,
    { kind: "activity", id: ID, field: "removed", value: true, at: AT },
    {
      kind: "workout",
      id: WORKOUT,
      field: "plan",
      value: [...plan, { ...plan[0]!, skipped: true }],
      at: LATER,
    },
    { kind: "workout", id: WORKOUT, field: "startedAt", value: AT, at: LATER },
    timed,
    {
      kind: "set",
      id: SET,
      workoutId: WORKOUT,
      field: "values",
      weightKg: 5,
      reps: null,
      seconds: 60,
      rir: null,
      at: LATER,
    },
    { ...(SESSION[1] as Change), position: 49, seconds: null } as Change, // « + Série » up to 50 positions
  ];
  const broken = (c: Change, patch: Record<string, unknown>) => ({ ...c, ...patch }) as Change;
  const BROKEN: Change[] = [
    broken(NEW[0]!, { value: 100_001 }),
    broken(NEW[0]!, { value: 10.5 }),
    broken(climb, { durationMin: 7 }),
    broken(climb, { durationMin: 485 }),
    broken(climb, { climbRuns: 201 }),
    broken(climb, { climbGrade: "9a" }),
    broken(climb, { climbColor: "blue" }), // a grade and a colour
    broken(climb, { cardioType: "run" }),
    broken(cardio, { cardioType: "ski" }),
    broken(cardio, { climbRuns: 3 }),
    broken(NEW[6]!, { value: [] }),
    broken(NEW[6]!, { value: [{ ...plan[0]!, rule: "rain" }] }),
    broken(NEW[6]!, { value: [{ ...plan[0]!, exerciseId: "bench" }] }),
    broken(NEW[7]!, { value: "1899-12-31T23:00:00.000Z" }),
    broken(timed, { reps: 8 }), // reps and seconds
    broken(timed, { seconds: null }), // neither
    broken(timed, { seconds: 3601 }),
    broken(SESSION[1]!, { position: 50 }),
  ];

  it("crosses the wire, and each broken change is refused", () => {
    expect(request(NEW).success).toBe(true);
    for (const change of BROKEN)
      expect(request([change]).success, JSON.stringify(change).slice(0, 120)).toBe(false);
  });

  it("is what the phone writes; it refuses each broken change, and the rest crosses", () => {
    expect(NEW.filter((c) => !isValidChange(c))).toEqual([]);
    const phone = [
      ...BROKEN,
      broken(timed, { rir: 1 }), // a timed set has no RIR
      broken(NEW[7]!, { value: LATER, at: AT }), // a start after its change's own time
      broken(timed, { warmup: true, position: 0 }), // a warm-up counts reps
    ];
    expect(phone.filter(isValidChange)).toEqual([]);
  });

  it("still takes a set queued before timed sets, without seconds", () => {
    const old = SESSION[1]!;
    expect("seconds" in old).toBe(false);
    expect(isValidChange(old)).toBe(true);
    expect(request([old]).success).toBe(true);
  });
});

describe("the weigh-in date floor", () => {
  it("is 1900-01-01 on the phone as on the server", () => {
    for (const [date, ok] of [
      ["1899-12-31", false],
      ["0202-10-07", false],
      ["0000-01-01", false],
      ["1900-01-01", true],
    ] as const) {
      expect(isValidChange(weight(date, 80)), date).toBe(ok);
      expect(ChangeSchema.safeParse(weight(date, 80)).success, date).toBe(ok);
    }
  });
});

describe("isRecordable", () => {
  it("refuses any dated entry after today, and takes an undated one", () => {
    const tomorrow = { ...SAMPLES[2]!, date: "2026-10-08" } as Change;
    expect(isRecordable(SAMPLES[2]!, "2026-10-07")).toBe(true);
    expect(isRecordable(tomorrow, "2026-10-07")).toBe(false);
    expect(isRecordable(SAMPLES[4]!, "2026-10-07")).toBe(true); // the profile has no day
  });
});

describe("isRecordableWeight", () => {
  it("refuses a weigh-in before 1900, on the phone", () => {
    expect(isRecordableWeight(weight("1899-12-31", 80), "2026-10-07")).toBe(false);
    expect(isRecordableWeight(weight("0000-01-01", 80), "2026-10-07")).toBe(false);
    expect(isRecordableWeight(weight("1900-01-01", 80), "2026-10-07")).toBe(true);
  });

  it("refuses a weigh-in dated after today, on the phone", () => {
    expect(isRecordableWeight(weight("2026-10-07", 80), "2026-10-07")).toBe(true);
    expect(isRecordableWeight(weight("2026-10-08", 80), "2026-10-07")).toBe(false);
    expect(isRecordableWeight(weight("2026-10-07", 401), "2026-10-07")).toBe(false);
  });
});

describe("merge", () => {
  const now = new Date("2026-10-07T07:00:00.000Z");

  it("lets the strictly later write win, and keeps what is stored on a tie", () => {
    expect(isNewer("2026-10-07T07:00:00.001Z", "2026-10-07T07:00:00.000Z")).toBe(true);
    expect(isNewer(AT, AT)).toBe(false);
    expect(isNewer(AT, null)).toBe(true);
  });

  it("brings a time from a clock running ahead back to now", () => {
    expect(clampAt("2026-10-07T09:00:00.000Z", now)).toBe(now.toISOString());
    expect(clampAt(AT, now)).toBe(AT);
  });

  it("writes a day only when the change is newer than what is stored", () => {
    const stored = new Map([
      ["2026-10-06", "2026-10-06T06:00:00.000Z"],
      ["2026-10-05", "2026-10-07T06:45:00.000Z"],
    ]);
    const winners = mergeWeights(
      stored,
      [weight("2026-10-07", 79.8), weight("2026-10-06", 80.1), weight("2026-10-05", 80.4)],
      now,
    );
    expect(winners.map((c) => c.date)).toEqual(["2026-10-07", "2026-10-06"]);
  });

  it("changes nothing when a batch is replayed", () => {
    const batch = [
      weight("2026-10-07", 80),
      weight("2026-10-07", 79.8, "2026-10-07T06:31:00.000Z"),
    ];
    const [won] = mergeWeights(new Map(), batch, now);
    expect(won).toMatchObject({ weightKg: 79.8 });
    expect(mergeWeights(new Map([["2026-10-07", won!.at]]), batch, now)).toEqual([]);
  });

  it("keeps the person's last edit when a clock ahead clamps two edits to the same time", () => {
    const ahead = [
      weight("2026-10-07", 80, "2026-10-07T09:00:00.000Z"),
      weight("2026-10-07", 79.8, "2026-10-07T09:01:00.000Z"),
    ];
    expect(mergeWeights(new Map(), ahead, now)).toEqual([
      weight("2026-10-07", 79.8, now.toISOString()),
    ]);
  });

  it("keeps the stored value when the clamped time equals the stored time", () => {
    const tie = weight("2026-10-07", 79.8, "2026-10-07T09:00:00.000Z"); // clamps to now
    expect(mergeWeights(new Map([["2026-10-07", now.toISOString()]]), [tie], now)).toEqual([]);
  });

  it("a clock running ahead degrades to last arrival (documented ceiling)", () => {
    const t1 = "2026-10-07T07:00:00.000Z"; // device B, written at the server's t1
    const ahead = weight("2026-10-07", 79.8, "2027-01-01T00:00:00.000Z"); // device A, clock ahead
    const t2 = new Date("2026-10-07T07:05:00.000Z");
    const t3 = new Date("2026-10-07T07:10:00.000Z");
    const [first] = mergeWeights(new Map([["2026-10-07", t1]]), [ahead], t2);
    expect(first!.at).toBe(t2.toISOString()); // overwrites B's later-in-reality edit
    // the replay after a lost response clamps to t3 and still wins over what t2 stored
    const [replay] = mergeWeights(new Map([["2026-10-07", t2.toISOString()]]), [ahead], t3);
    expect(replay!.at).toBe(t3.toISOString());
  });

  it("keeps what the server tags a change with", () => {
    const tagged = { ...weight("2026-10-07", 79.8), index: 4 };
    expect(mergeWeights(new Map(), [tagged], now)).toEqual([tagged]);
    expect(mergeTarget(null, [{ ...target(0.25, 0.75), index: 2 }], now)?.index).toBe(2);
  });

  it("names the days whose stored write is strictly newer than a change sent for them", () => {
    const stored = new Map([
      ["2026-10-07", "2026-10-07T06:45:00.000Z"], // later than AT: the change lost
      ["2026-10-06", AT], // a tie: the phone already holds this write
      ["2026-10-05", null], // never written
    ]);
    const changes = ["2026-10-07", "2026-10-06", "2026-10-05", "2026-10-04"].map((d) =>
      weight(d, 80),
    );
    expect([...staleKeys(stored, changes, (c) => c.date, now)]).toEqual(["2026-10-07"]);
  });

  it("judges a day by the last change sent for it, as the phone shows that one", () => {
    const stored = new Map([["2026-10-07", "2026-10-07T06:31:00.000Z"]]);
    const replay = [
      weight("2026-10-07", 80),
      weight("2026-10-07", 79.8, "2026-10-07T06:31:00.000Z"),
    ];
    expect(staleKeys(stored, replay, (c) => c.date, now).size).toBe(0);
  });

  it("compares a change from a clock running ahead at its clamped time", () => {
    const stored = new Map([["2026-10-07", "2026-10-07T06:59:00.000Z"]]);
    const ahead = weight("2026-10-07", 80, "2026-10-08T00:00:00.000Z"); // clamps to now, wins
    expect(staleKeys(stored, [ahead], (c) => c.date, now).size).toBe(0);
  });

  it("merges each field under its own key", () => {
    const at = (m: number) => `2026-10-07T06:${String(m).padStart(2, "0")}:00.000Z`;
    const changes = [
      { key: "a|waist", v: 1, at: at(1) },
      { key: "a|neck", v: 2, at: at(1) },
      { key: "a|waist", v: 3, at: at(2) },
    ];
    const stored = new Map([["a|neck", at(5)]]);
    expect(mergeFields(stored, changes, (c) => c.key, now)).toEqual([changes[2]]);
  });

  it("merges the target range under its single timestamp", () => {
    expect(mergeTarget(null, [target(0.25, 0.75)], now)).toEqual(target(0.25, 0.75));
    expect(mergeTarget("2026-10-07T06:45:00.000Z", [target(0.25, 0.75)], now)).toBeNull();
  });
});

describe("programs, the active one, their sessions and slots (SY1, SY7, SY9, SY10)", () => {
  const PROGRAM = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d92";
  const PSESSION = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d93";
  const PSLOT = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d94";
  const fixed = { mode: "fixed", days: [PSESSION, null, null, PSESSION, null, null, null] };
  const program = (patch: Record<string, unknown>) =>
    ({ kind: "program", id: PROGRAM, at: AT, ...patch }) as Change;
  const session = (patch: Record<string, unknown>) =>
    ({ kind: "programSession", id: PSESSION, at: AT, ...patch }) as Change;
  const slot = (patch: Record<string, unknown>) =>
    ({ kind: "programSlot", id: PSLOT, at: AT, ...patch }) as Change;
  // A slot created at every upper bound, and a timed one at the lower ones.
  const counted = slot({
    field: "create",
    sessionId: PSESSION,
    position: 999,
    rule: null,
    exerciseId: "ds:0025",
    sets: 10,
    repRange: [1, 100],
    rirTarget: [0, 4],
    restSec: 900,
    warmupSets: 3,
    isMain: true,
    groupKey: "A".repeat(16),
  });
  const timed = slot({
    field: "create",
    sessionId: PSESSION,
    position: 0,
    rule: "no_climbing",
    exerciseId: "ds:2135",
    measure: "seconds",
    sets: 1,
    repRange: [1, 3600],
    rirTarget: [0, 0],
    restSec: 0,
    warmupSets: 0,
    isMain: false,
    groupKey: null,
  });
  const VALID: Change[] = [
    program({ field: "create", name: null, schedule: DEFAULT_SCHEDULE }),
    program({ field: "create", name: "P".repeat(60), schedule: fixed }),
    program({ field: "name", value: "Force" }),
    program({ field: "name", value: null }),
    program({ field: "schedule", value: fixed }),
    program({ field: "removed", value: true }),
    { kind: "activeProgram", programId: PROGRAM, at: AT },
    session({ field: "create", name: null, programId: PROGRAM, position: 0 }),
    session({ field: "create", name: "S".repeat(40), programId: null, position: 999 }),
    session({ field: "name", value: "Tirage" }),
    session({ field: "name", value: null }),
    session({ field: "place", programId: PROGRAM, position: 25 }),
    session({ field: "place", programId: null, position: 0 }),
    session({ field: "removed", value: false }),
    counted,
    timed,
    slot({
      field: "exercise",
      exerciseId: "ds:2135",
      measure: "seconds",
      repRange: [1, 3600],
      warmupSets: 0,
    }),
    slot({
      field: "exercise",
      exerciseId: "belay:dead-hang",
      measure: null,
      repRange: [1, 100],
      warmupSets: 3,
    }),
    slot({ field: "reps", value: [1, 3600], measure: "seconds" }),
    slot({ field: "reps", value: [8, 8], measure: null }),
    slot({ field: "sets", value: 1 }),
    slot({ field: "sets", value: 10 }),
    slot({ field: "rir", value: [0, 4] }),
    slot({ field: "rest", value: 0 }),
    slot({ field: "rest", value: 900 }),
    slot({ field: "warmups", value: 0, measure: "seconds" }),
    slot({ field: "warmups", value: 3, measure: null }),
    slot({ field: "main", value: true }),
    slot({ field: "group", value: null }),
    slot({ field: "group", value: "A1" }),
    slot({ field: "rule", value: "no_climbing" }),
    slot({ field: "rule", value: null }),
    slot({ field: "position", value: 0 }),
    slot({ field: "position", value: 999 }),
    slot({ field: "removed", value: true }),
  ];
  const broken = (c: Change, patch: Record<string, unknown>) => ({ ...c, ...patch }) as Change;
  const [create, , rename, , reschedule, remove, active, sCreate, , sName, , place] = VALID;
  const PAST: Change[] = [
    broken(create!, { id: "x" }),
    broken(create!, { name: "" }),
    broken(create!, { name: "P".repeat(61) }),
    broken(rename!, { value: " Force" }),
    broken(rename!, { value: "a\nb" }),
    broken(reschedule!, { value: { mode: "fixed", days: fixed.days.slice(1) } }),
    broken(reschedule!, { value: { mode: "weekly", days: fixed.days } }),
    broken(reschedule!, { value: { mode: "fixed", days: ["A", ...fixed.days.slice(1)] } }),
    broken(remove!, { value: "yes" }),
    broken(active!, { programId: "x" }),
    broken(active!, { programId: null }),
    broken(sCreate!, { name: "S".repeat(41) }),
    broken(sCreate!, { position: 1000 }),
    broken(sCreate!, { position: -1 }),
    broken(sCreate!, { position: 1.5 }),
    broken(sCreate!, { programId: "x" }),
    broken(sName!, { value: "" }),
    broken(place!, { position: 1000 }),
    broken(place!, { programId: "x" }),
    broken(counted, { sessionId: "x" }),
    broken(counted, { position: 1000 }),
    broken(counted, { sets: 11 }),
    broken(counted, { sets: 0 }),
    broken(counted, { repRange: [1, 101] }), // a counted range stops at 100
    broken(counted, { repRange: [12, 8] }),
    broken(counted, { rirTarget: [0, 5] }),
    broken(counted, { restSec: 901 }),
    broken(counted, { warmupSets: 4 }),
    broken(counted, { groupKey: "A".repeat(17) }),
    broken(counted, { groupKey: "a-b" }),
    broken(counted, { rule: "rain" }),
    broken(counted, { exerciseId: "bench" }),
    broken(timed, { repRange: [1, 3601] }),
    broken(timed, { measure: "minutes" }),
    broken(VALID[16]!, { exerciseId: "bench" }),
    broken(VALID[16]!, { measure: "reps" }),
    // The exercise brings its range and warm-ups, bounded by its measure (ED4).
    broken(VALID[16]!, { repRange: [1, 3601] }),
    broken(VALID[16]!, { repRange: undefined }),
    broken(VALID[16]!, { warmupSets: 4 }),
    broken(VALID[16]!, { warmupSets: undefined }),
    broken(VALID[17]!, { repRange: [1, 101] }),
    broken(VALID[17]!, { repRange: [9, 8] }),
    broken(VALID[18]!, { value: [0, 10] }),
    broken(VALID[18]!, { value: [10, 8] }),
    broken(VALID[18]!, { value: [1, 3601] }),
    // A range or warm-ups name the measure they were written for, and a counted range stops at 100.
    broken(VALID[18]!, { measure: null }),
    broken(VALID[19]!, { measure: undefined }),
    broken(VALID[19]!, { measure: "reps" }),
    broken(VALID[26]!, { measure: undefined }),
    broken(VALID[26]!, { measure: "minutes" }),
    broken(VALID[21]!, { value: 11 }),
    broken(VALID[22]!, { value: [3, 2] }),
    broken(VALID[24]!, { value: 901 }),
    broken(VALID[26]!, { value: 4 }),
    broken(VALID[27]!, { value: "yes" }),
    broken(VALID[29]!, { value: "" }),
    broken(VALID[30]!, { value: "rain" }),
    broken(VALID[33]!, { value: 1000 }),
    broken(VALID[34]!, { value: null }),
    broken(VALID[34]!, { field: "color" }),
    broken(VALID[20]!, { field: "toString" }), // a name every object answers to
    broken(VALID[20]!, { field: "constructor" }),
  ];

  it("crosses the wire at its bounds, and a change one past them is refused", () => {
    expect(request(VALID).success).toBe(true);
    for (const change of PAST)
      expect(request([change]).success, JSON.stringify(change).slice(0, 160)).toBe(false);
  });

  it("is what the phone writes and checks before queuing, never wider than the server", () => {
    expect(VALID.filter((c) => !isValidChange(c))).toEqual([]);
    expect(PAST.filter(isValidChange)).toEqual([]);
    const upper = (c: Change) => broken(c, { id: PSLOT.toUpperCase() });
    expect(isValidChange(upper(VALID[34]!))).toBe(false);
    for (const change of [...VALID, ...PAST, upper(VALID[34]!)])
      if (isValidChange(change))
        expect(ChangeSchema.safeParse(change).success, JSON.stringify(change)).toBe(true);
  });

  it("a start records the session it came from, and one without it stays valid (SY10)", () => {
    const start = SESSION[0]!;
    const withId = broken(start, { sessionId: PSESSION });
    const without = broken(start, { sessionId: null });
    for (const c of [start, withId, without]) {
      expect(isValidChange(c), JSON.stringify(c).slice(0, 120)).toBe(true);
      expect(request([c]).success).toBe(true);
    }
    expect(ChangeSchema.parse(withId)).toMatchObject({ sessionId: PSESSION });
    for (const c of [broken(start, { sessionId: "A" }), broken(start, { sessionId: 3 })]) {
      expect(isValidChange(c)).toBe(false);
      expect(request([c]).success).toBe(false);
    }
    expect(isValidChange(broken(start, { sessionId: PSESSION.toUpperCase() }))).toBe(false);
  });

  it("drops a key it does not know rather than refusing the batch, as an older server does", () => {
    // An older server's start has no sessionId: it strips the field and stores the session.
    const parsed = request([{ ...SESSION[0]!, recordedBy: PSESSION }]);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.changes[0]).not.toHaveProperty("recordedBy");
  });

  const answer = {
    cursor: "0",
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
    target: null,
    profile: null,
    rejected: [],
    hasMore: false,
  };
  const rows = {
    activeProgram: { programId: PROGRAM, at: null },
    programs: [
      {
        id: PROGRAM,
        name: null,
        nameAt: null,
        schedule: DEFAULT_SCHEDULE,
        scheduleAt: null,
        removed: false,
        removedAt: null,
      },
    ],
    programSessions: [
      {
        id: PSESSION,
        name: "Tirage",
        nameAt: AT,
        programId: null,
        position: 0,
        placeAt: AT,
        removed: false,
        removedAt: null,
      },
    ],
    programSlots: [
      {
        id: PSLOT,
        sessionId: PSESSION,
        position: 0,
        positionAt: null,
        exerciseId: "ds:2135",
        measure: "seconds",
        exerciseAt: AT,
        repRange: [30, 60],
        repsAt: null,
        sets: 3,
        setsAt: null,
        rirTarget: [1, 2],
        rirAt: null,
        restSec: 90,
        restAt: null,
        warmupSets: 0,
        warmupsAt: null,
        isMain: false,
        mainAt: null,
        groupKey: null,
        groupAt: null,
        rule: null,
        ruleAt: null,
        removed: false,
        removedAt: null,
      },
    ],
  };

  it("reads an answer without program rows, as an older server sends it (SY9)", () => {
    expect(SyncResponseSchema.safeParse(answer).success).toBe(true);
    expect(SyncResponseSchema.safeParse({ ...answer, activeProgram: null }).success).toBe(true);
  });

  it("reads the program rows and a session's recorded id when they come", () => {
    const workout = {
      id: WORKOUT,
      sessionCode: "A",
      plan: PLAN,
      planAt: null,
      startedAt: AT,
      startedAtAt: null,
      endedAt: null,
      endedAtAt: null,
      note: null,
      noteAt: null,
      exerciseNotes: {},
      exerciseNotesAt: null,
      removed: false,
      removedAt: null,
    };
    const parsed = SyncResponseSchema.parse({
      ...answer,
      ...rows,
      workouts: [workout, { ...workout, sessionId: PSESSION }, { ...workout, sessionId: null }],
    });
    expect(parsed).toMatchObject(rows);
    expect(parsed.workouts.map((w) => w.sessionId)).toEqual([undefined, PSESSION, null]);
    expect(
      SyncResponseSchema.safeParse({ ...answer, programs: [{ ...rows.programs[0], id: "x" }] })
        .success,
    ).toBe(false);
  });
});

describe("a slot change over its stored row (SY2, ED4)", () => {
  const PSLOT = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d94";
  const T0 = "2026-10-07T06:00:00.000Z";
  const T1 = "2026-10-07T06:10:00.000Z";
  const T2 = "2026-10-07T06:20:00.000Z";
  const row: ProgramSlotRow = {
    id: PSLOT,
    sessionId: "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d93",
    position: 0,
    positionAt: null,
    exerciseId: "ds:0025",
    measure: null,
    exerciseAt: T1,
    repRange: [6, 8],
    repsAt: T1,
    sets: 3,
    setsAt: T1,
    rirTarget: [1, 2],
    rirAt: null,
    restSec: 90,
    restAt: null,
    warmupSets: 2,
    warmupsAt: T1,
    isMain: false,
    mainAt: null,
    groupKey: null,
    groupAt: null,
    rule: null,
    ruleAt: null,
    removed: false,
    removedAt: null,
  };
  const change = (patch: Record<string, unknown>) =>
    ({ kind: "programSlot", id: PSLOT, at: T2, ...patch }) as ProgramSlotChange;

  it("writes a field strictly newer with its time, and keeps the row on a tie or an older write", () => {
    expect(mergeSlotChange(row, change({ field: "sets", value: 5 }))).toEqual({
      ...row,
      sets: 5,
      setsAt: T2,
    });
    expect(mergeSlotChange(row, change({ field: "rest", value: 120, at: T0 }))).toEqual({
      ...row,
      restSec: 120,
      restAt: T0,
    }); // never written: any time wins
    for (const at of [T1, T0])
      expect(mergeSlotChange(row, change({ field: "sets", value: 5, at }))).toBe(row);
    expect(mergeSlotChange(row, change({ field: "position", value: 4 }))).toMatchObject({
      position: 4,
      positionAt: T2,
    });
    expect(mergeSlotChange(row, change({ field: "removed", value: true }))).toMatchObject({
      removed: true,
      removedAt: T2,
    });
  });

  it("a creation replayed changes nothing", () => {
    const create = change({ field: "create", exerciseId: "ds:0047", sets: 1 });
    expect(mergeSlotChange(row, create)).toBe(row);
  });

  it("writes a range or warm-ups made for the row's measure, and refuses one made for another", () => {
    expect(
      mergeSlotChange(row, change({ field: "reps", value: [8, 12], measure: null })),
    ).toMatchObject({ repRange: [8, 12], repsAt: T2 });
    expect(
      mergeSlotChange(row, change({ field: "reps", value: [8, 12], measure: "seconds" })),
    ).toBe(null);
    expect(mergeSlotChange(row, change({ field: "warmups", value: 1, measure: "seconds" }))).toBe(
      null,
    );
  });

  it("refuses a range or warm-ups made for another measure at an equal or older time too", () => {
    // Built on a view from before a swap: refused whatever its time, so the phone and the
    // server always say so instead of dropping it like a plain stale write.
    for (const at of [T1, T0]) {
      const reps = change({ field: "reps", value: [8, 12], measure: "seconds", at });
      const warmups = change({ field: "warmups", value: 0, measure: "seconds", at });
      expect(mergeSlotChange(row, reps), at).toBe(null);
      expect(mergeSlotChange(row, warmups), at).toBe(null);
    }
  });

  it("an exercise in another measure brings its range and warm-ups over newer ones", () => {
    const toTimed = change({
      field: "exercise",
      exerciseId: "ds:2135",
      measure: "seconds",
      repRange: [30, 60],
      warmupSets: 0,
      at: T2,
    });
    const edited = {
      ...row,
      repRange: [10, 15] as [number, number],
      repsAt: "2026-10-07T06:25:00.000Z",
    };
    expect(mergeSlotChange(edited, toTimed)).toEqual({
      ...row,
      exerciseId: "ds:2135",
      measure: "seconds",
      exerciseAt: T2,
      repRange: [30, 60],
      repsAt: T2,
      warmupSets: 0,
      warmupsAt: T2,
    });
  });

  it("an exercise in the same measure never overwrites a range or warm-ups edit", () => {
    const same = change({
      field: "exercise",
      exerciseId: "ds:0047",
      measure: null,
      repRange: [6, 8],
      warmupSets: 2,
      at: T2,
    });
    const edited = {
      ...row,
      repRange: [10, 15] as [number, number],
      repsAt: "2026-10-07T06:25:00.000Z",
    };
    expect(mergeSlotChange(edited, same)).toEqual({
      ...edited,
      exerciseId: "ds:0047",
      exerciseAt: T2,
    });
    // An offline edit older than the swap survives it, in both arrival orders.
    const older = change({ field: "reps", value: [3, 5], measure: null, at: T1 });
    const base = { ...row, repsAt: T0 };
    expect(mergeSlotChange(mergeSlotChange(base, same)!, older)?.repRange).toEqual([3, 5]);
    expect(mergeSlotChange(mergeSlotChange(base, older)!, same)?.repRange).toEqual([3, 5]);
    // An older exercise change loses whole.
    expect(mergeSlotChange(row, { ...same, at: T0 })).toBe(row);
  });

  it("refuses warm-ups on a timed slot", () => {
    const timed = {
      ...row,
      measure: "seconds" as const,
      repRange: [30, 60] as [number, number],
      warmupSets: 0,
    };
    expect(mergeSlotChange(timed, change({ field: "warmups", value: 2, measure: "seconds" }))).toBe(
      null,
    );
  });

  it("refuses a change that would leave the merged slot out of its bounds", () => {
    expect(mergeSlotChange(row, change({ field: "reps", value: [1, 101], measure: null }))).toBe(
      null,
    );
  });
});
