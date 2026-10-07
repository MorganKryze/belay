import { describe, expect, it } from "vitest";
import { MAX_CHANGES } from "./limits";
import { clampAt, isNewer, mergeTarget, mergeWeights } from "./merge";
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
    ["a time with an offset", weight("2026-10-07", 80, "2026-10-07T08:30:00+02:00")],
    ["a range under 0.25 %", target(0.2, 1)],
    ["a range over 1 %", target(0.5, 1.05)],
    ["bounds closer than 0.1", target(0.9, 0.95)],
    ["an unknown kind", { kind: "waist", date: "2026-10-07", at: AT }],
  ])("refuses %s", (_, change) => {
    expect(request([change]).success).toBe(false);
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
      hasMore: false,
    });
    expect(parsed.weights[0]!.weightKg).toBeNull();
    expect(parsed.target?.at).toBeNull();
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

describe("isRecordableWeight", () => {
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

  it("merges the target range under its single timestamp", () => {
    expect(mergeTarget(null, [target(0.25, 0.75)], now)).toEqual(target(0.25, 0.75));
    expect(mergeTarget("2026-10-07T06:45:00.000Z", [target(0.25, 0.75)], now)).toBeNull();
  });
});
