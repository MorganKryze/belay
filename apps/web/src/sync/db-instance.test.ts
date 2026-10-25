import type { Change } from "@belay/shared/sync/schema";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeInstance } from "@/lib/platform";
import { answer } from "@/test/answer";
import {
  type AccountDb,
  accountDbName,
  applyServer,
  openAccountDb,
  readCursor,
  readOutbox,
  recordChange,
} from "./db";

// A cloned or restored server keeps its account ids: the same person has the same id on both.
const USER = "0192c3d4-0000-7000-8000-000000000001";
const A = "https://belay.example.org";
const B = "https://copy.example.net";
const weighing: Change = {
  kind: "weight",
  date: "2026-10-07",
  weightKg: 79.8,
  at: "2026-10-07T06:30:00.000Z",
};
const asApp = () => vi.stubGlobal("Capacitor", { isNativePlatform: () => true });

async function withDb<T>(use: (db: AccountDb) => Promise<T>) {
  const db = await openAccountDb(USER);
  try {
    return await use(db);
  } finally {
    db.close();
  }
}
// Opens the account's database on this instance and runs `use` on it, as one app launch.
async function onInstance<T>(origin: string, use: (db: AccountDb) => Promise<T>) {
  writeInstance(origin);
  return withDb(use);
}

beforeEach(() => {
  indexedDB = new IDBFactory(); // a fresh device for every test
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("in a browser", () => {
  it("keeps the account's database name, whatever instance address is stored", async () => {
    writeInstance(A);
    expect(accountDbName(USER)).toBe(`belay.${USER}`);
    await withDb(async () => {});
    expect((await indexedDB.databases()).map((d) => d.name)).toEqual([`belay.${USER}`]);
  });
});

describe("in the iPhone app", () => {
  beforeEach(asApp);

  it("gives two instances with the same account id two databases", async () => {
    writeInstance(A);
    const onA = accountDbName(USER);
    writeInstance(B);
    expect(accountDbName(USER)).not.toBe(onA);
    await onInstance(A, async () => {});
    await onInstance(B, async () => {});
    expect(await indexedDB.databases()).toHaveLength(2);
  });

  it("never drains one instance's queue into the other", async () => {
    await onInstance(A, (db) => recordChange(db, weighing));
    expect(await onInstance(B, readOutbox)).toEqual([]);
    expect((await onInstance(A, readOutbox)).map((e) => e.change)).toEqual([weighing]);
  });

  it("keeps one pull cursor per instance", async () => {
    await onInstance(A, (db) => applyServer(db, [], answer({ cursor: "42" })));
    expect(await onInstance(B, readCursor)).toBe("0");
    expect(await onInstance(A, readCursor)).toBe("42");
  });
});
