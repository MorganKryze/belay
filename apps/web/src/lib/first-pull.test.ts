import { describe, expect, it } from "vitest";
import type { SyncStatus } from "@/sync/engine";
import { FIRST_PULL_CAP_MS, firstPullPending } from "./first-pull";

const at = (
  cursor: string | undefined,
  status: SyncStatus,
  { sawSyncing = false, elapsed = 500 } = {},
) => firstPullPending({ cursor, status, sawSyncing, elapsed });

describe("firstPullPending", () => {
  it("a cursor not read yet is pending", () => {
    expect(at(undefined, "idle")).toBe(true);
    expect(at(undefined, "offline", { elapsed: 10_000 })).toBe(true);
  });

  it("a device that has pulled before is never pending", () => {
    expect(at("5", "syncing", { sawSyncing: true })).toBe(false);
    expect(at("5", "idle")).toBe(false);
  });

  it("a never-pulled device is pending while its first sync runs, and before the run is seen to start", () => {
    expect(at("0", "syncing", { sawSyncing: true })).toBe(true);
    expect(at("0", "idle", { sawSyncing: false })).toBe(true);
  });

  it("it settles once that run ends, even with the cursor still at 0 (an empty account)", () => {
    expect(at("0", "idle", { sawSyncing: true })).toBe(false);
  });

  it("offline, expired or failed settles at once", () => {
    for (const status of ["offline", "expired", "failed"] as const) {
      expect(at("0", status), status).toBe(false);
      expect(at("0", status, { sawSyncing: true }), status).toBe(false);
    }
  });

  it("the cap ends it at 4 s", () => {
    expect(FIRST_PULL_CAP_MS).toBe(4000);
    expect(at("0", "syncing", { sawSyncing: true, elapsed: 3999 })).toBe(true);
    expect(at("0", "syncing", { sawSyncing: true, elapsed: 4000 })).toBe(false);
    expect(at("0", "idle", { elapsed: 4000 })).toBe(false);
  });
});
