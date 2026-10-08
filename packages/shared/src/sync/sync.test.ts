import { describe, expect, it } from "vitest";
import { MIN_WEIGH_IN_DATE } from "../body/weighings";
import { MAX_CHANGES } from "./limits";
import { clampAt, isNewer, mergeTarget, mergeWeights, staleKeys } from "./merge";
import {
  type Change,
  ChangeSchema,
  SyncRequestSchema,
  SyncResponseSchema,
  type TargetChange,
  type WeightChange,
} from "./schema";
import { isRecordableWeight, isValidChange } from "./valid";

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
      target: { minPct: 0.5, maxPct: 1, at: null },
      rejected: [{ index: 3, reason: "refused" }],
      hasMore: false,
    });
    expect(parsed.weights[0]!.weightKg).toBeNull();
    expect(parsed.target?.at).toBeNull();
    expect(parsed.rejected).toEqual([{ index: 3, reason: "refused" }]);
  });

  it("refuses a refusal that does not point at a change", () => {
    const answer = (rejected: unknown) =>
      SyncResponseSchema.safeParse({
        cursor: "1",
        weights: [],
        target: null,
        rejected,
        hasMore: false,
      }).success;
    expect(answer([{ index: 0, reason: "unknown" }])).toBe(true);
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

  it("accepts nothing the server would refuse", () => {
    for (const change of samples)
      if (isValidChange(change))
        expect(ChangeSchema.safeParse(change).success, change.at).toBe(true);
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

  it("merges the target range under its single timestamp", () => {
    expect(mergeTarget(null, [target(0.25, 0.75)], now)).toEqual(target(0.25, 0.75));
    expect(mergeTarget("2026-10-07T06:45:00.000Z", [target(0.25, 0.75)], now)).toBeNull();
  });
});
