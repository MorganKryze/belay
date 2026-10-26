import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AccountDb, applyServer, openAccountDb, readCursor } from "@/sync/db";
import { answer } from "@/test/answer";

// Capacitor's proxy answers every property, `then` included: a promise resolved with it would
// never settle. The mock does the same, so a test fails if the plugin is ever handed to one.
const native = vi.hoisted(() => ({
  health: vi.fn(),
  get then(): never {
    throw new Error('"BelayNative.then()" is not implemented on ios');
  },
}));
vi.mock("./plugin", () => ({ BelayNative: native }));

import {
  HEALTH_OFF,
  health,
  healthProgress,
  IMPORT_KEY,
  localDayStart,
  readHealth,
  recordWritten,
  requestHealthRun,
  setHealthOn,
  setHealthRunner,
  setHistory,
  setImportOn,
} from "./health";

const NOW = new Date(2026, 9, 26, 9, 30).getTime();
let db: AccountDb;
beforeEach(async () => {
  indexedDB = new IDBFactory(); // a fresh phone for every test
  db = await openAccountDb("user-a");
  native.health.mockReset();
});

describe("the Health state", () => {
  it("starts with both switches off and nothing written", async () => {
    expect(await readHealth(db)).toEqual({
      settings: HEALTH_OFF,
      written: {},
      imported: { anchor: null, filled: {} },
    });
  });

  it("belongs to this account: another account on the same phone starts off", async () => {
    await setHealthOn(db, true, NOW);
    const other = await openAccountDb("user-b");
    expect((await readHealth(other)).settings.on).toBe(false);
    other.close();
  });

  it("turning on keeps when, and offers the history again; turning on twice keeps the first time", async () => {
    await setHistory(db, "sent");
    expect((await setHealthOn(db, true, NOW)).history).toBe("no");
    await setHistory(db, "sent");
    expect(await setHealthOn(db, true, NOW + 60_000)).toEqual({
      ...HEALTH_OFF,
      on: true,
      turnedOnAt: NOW,
      history: "sent",
    });
  });

  it("turning off turns the import off and keeps the record of what was written", async () => {
    await setHealthOn(db, true, NOW);
    await setImportOn(db, true, NOW);
    await recordWritten(db, {
      "belay-weighing-2026-10-26": { state: "weighing", version: 1, kg: 80 },
    });
    expect(await setHealthOn(db, false, NOW)).toMatchObject({ on: false, importOn: false });
    expect((await readHealth(db)).written).toEqual({
      "belay-weighing-2026-10-26": { state: "weighing", version: 1, kg: 80 },
    });
  });

  it("the import needs the setting, starts at its local midnight and reads Health again from there", async () => {
    expect((await setImportOn(db, true, NOW)).importOn).toBe(false);
    await setHealthOn(db, true, NOW);
    await db.put(
      "meta",
      { anchor: "old", filled: { "2026-10-25": { at: "a", startedAt: 1 } } },
      IMPORT_KEY,
    );
    expect(await setImportOn(db, true, NOW)).toMatchObject({
      importOn: true,
      importSince: new Date(2026, 9, 26).getTime(),
    });
    expect((await readHealth(db)).imported).toEqual({
      anchor: null,
      filled: { "2026-10-25": { at: "a", startedAt: 1 } },
    });
    expect(localDayStart(NOW)).toBe(new Date(2026, 9, 26).getTime());
  });

  it("turning the import on while it runs keeps its day and its place in Health", async () => {
    await setHealthOn(db, true, NOW);
    await setImportOn(db, true, NOW);
    await db.put("meta", { anchor: "A1", filled: {} }, IMPORT_KEY);
    expect(await setImportOn(db, true, NOW + 86_400_000)).toMatchObject({
      importOn: true,
      importSince: new Date(2026, 9, 26).getTime(),
    });
    expect((await readHealth(db)).imported.anchor).toBe("A1");
  });

  it("the record merges, so two runs never undo each other", async () => {
    await recordWritten(db, { a: { state: "removed", version: 1 } });
    await recordWritten(db, { b: { state: "removed", version: 2 } });
    expect(Object.keys((await readHealth(db)).written).sort()).toEqual(["a", "b"]);
  });

  it("the sync cursor beside it is left alone", async () => {
    await setHealthOn(db, true, NOW);
    await applyServer(db, [], answer({ cursor: "42" }));
    expect(await readCursor(db)).toBe("42");
    expect((await readHealth(db)).settings.on).toBe(true);
  });
});

describe("the bridge", () => {
  it("passes the request to the plugin's one method and gives back its answer", async () => {
    native.health.mockResolvedValue({ available: true, workouts: "allowed", weighings: "denied" });
    await expect(health({ op: "status" })).resolves.toEqual({
      available: true,
      workouts: "allowed",
      weighings: "denied",
    });
    expect(native.health).toHaveBeenCalledWith({ op: "status" });
  });
});

describe("the run's progress and runner", () => {
  it("tells its listeners, and a run asked with no runner does nothing", () => {
    const heard = vi.fn();
    const off = healthProgress.subscribe(heard);
    healthProgress.set({ sending: { done: 1, total: 3 }, pending: 0 });
    expect(heard).toHaveBeenCalledOnce();
    expect(healthProgress.get().sending).toEqual({ done: 1, total: 3 });
    off();
    const run = vi.fn();
    requestHealthRun();
    setHealthRunner(run);
    requestHealthRun();
    setHealthRunner(null);
    requestHealthRun();
    expect(run).toHaveBeenCalledOnce();
  });
});
