import { toISODate } from "@belay/shared/body/dates";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeInstance } from "@/lib/platform";
import { type AccountDb, openAccountDb, recordChange } from "@/sync/db";

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
  askImportHistory,
  type HealthObject,
  type HealthOutcome,
  type HealthProgress,
  type HealthRequest,
  type HealthStatus,
  healthProgress,
  HISTORY_SINCE,
  readHealth,
  setHealthOn,
  setHistory,
  setImportOn,
} from "./health";
import { importWeighings } from "./health-import";
import { ownerOf, weighingKey } from "./health-plan";
import { createHealthRunner, type HealthRunner } from "./health-run";

// The phone's local time: the setting went on on the 1st of January at 07:00.
const ON = new Date(2026, 0, 1, 7).getTime();
const NOW = new Date(2026, 9, 26, 12).getTime();
const ALLOWED: HealthStatus = { available: true, workouts: "allowed", weighings: "allowed" };
const dayAfter = (n: number) => toISODate(new Date(2026, 0, 1 + n));

let db: AccountDb;
let runners: HealthRunner[];
beforeEach(async () => {
  indexedDB = new IDBFactory(); // a fresh phone for every test
  db = await openAccountDb("user-a");
  native.health.mockReset();
  healthProgress.set({ sending: null, pending: 0 });
  for (const r of runners ?? []) r.stop();
  runners = [];
});

// Health as the native side answers: status, then every object written unless `answer` says
// otherwise for it.
function health(
  answer: (o: HealthObject, call: number) => HealthOutcome = () => "written",
  status: HealthStatus = ALLOWED,
) {
  let calls = 0;
  native.health.mockImplementation(async (r: HealthRequest) => {
    if (r.op === "status") return status;
    if (r.op !== "apply") throw new Error(`unexpected ${r.op}`);
    calls++;
    return { outcomes: r.objects.map((o) => answer(o, calls)) };
  });
}
const applied = (): HealthObject[][] =>
  native.health.mock.calls
    .map(([r]) => r as HealthRequest)
    .filter((r) => r.op === "apply")
    .map((r) => (r as { objects: HealthObject[] }).objects);
const statusCalls = () =>
  native.health.mock.calls.filter(([r]) => (r as HealthRequest).op === "status").length;

// Weigh-ins put straight into the phone's store, one a day from `first` days after the setting.
async function weighIns(count: number, first = 0) {
  const tx = db.transaction("weights", "readwrite");
  for (let n = first; n < first + count; n++)
    await tx.store.put({ date: dayAfter(n), weightKg: 80, at: "2026-10-01T06:00:00.000Z" });
  await tx.done;
}
function runner(changed = vi.fn(), on = db) {
  const r = createHealthRunner(on, "user-a", changed, () => NOW);
  runners.push(r);
  return { r, changed };
}
// A run is over once it told the page; a run that sends nothing tells it too.
const ran = async (changed: ReturnType<typeof vi.fn>, times = 1) =>
  vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(times));
const settle = () => new Promise((r) => setTimeout(r, 30));

describe("the run", () => {
  it("off: not one call to Health", async () => {
    await weighIns(3);
    healthProgress.set({ sending: null, pending: 4 });
    const { r } = runner();
    r.request();
    r.foreground();
    await settle();
    expect(native.health).not.toHaveBeenCalled();
    expect(healthProgress.get()).toEqual({ sending: null, pending: 0 });
  });

  it("unavailable: nothing is sent", async () => {
    await setHealthOn(db, true, ON);
    await weighIns(3);
    health(undefined, { available: false, workouts: "undetermined", weighings: "undetermined" });
    const { r } = runner();
    r.request();
    await settle();
    expect(statusCalls()).toBe(1);
    expect(applied()).toEqual([]);
  });

  it("unavailable: the last account's « n sur N » and pending count go", async () => {
    await setHealthOn(db, true, ON);
    healthProgress.set({ sending: { done: 100, total: 150 }, pending: 4 });
    health(undefined, { available: false, workouts: "undetermined", weighings: "undetermined" });
    const { r } = runner();
    r.request();
    await vi.waitFor(() => expect(statusCalls()).toBe(1));
    await settle();
    expect(healthProgress.get()).toEqual({ sending: null, pending: 0 });
  });

  it("stopped between two batches, its « n sur N » goes", async () => {
    await weighIns(150, -200);
    await setHealthOn(db, true, ON);
    await setHistory(db, "asked");
    let stop = () => {};
    native.health.mockImplementation(async (req: HealthRequest) => {
      if (req.op === "status") return ALLOWED;
      if (req.op !== "apply") throw new Error(req.op);
      stop();
      return { outcomes: req.objects.map(() => "written") };
    });
    const { r } = runner();
    stop = () => r.stop();
    r.request();
    await vi.waitFor(() => expect(applied()).toHaveLength(1));
    await settle();
    expect(applied()).toHaveLength(1);
    expect(healthProgress.get()).toEqual({ sending: null, pending: 0 });
  });

  it("writes in batches of 100 and records only what Health confirmed", async () => {
    await setHealthOn(db, true, ON);
    await weighIns(250);
    const refused = dayAfter(7);
    health((o) => (o.kind === "weighing" && o.date === refused ? "unavailable" : "written"));
    const { r, changed } = runner();
    r.request();
    await ran(changed);
    expect(applied().map((b) => b.length)).toEqual([100, 100, 50]);
    const { written } = await readHealth(db);
    expect(Object.keys(written)).toHaveLength(249);
    expect(written[weighingKey(refused)]).toBeUndefined();
    expect(written[weighingKey(dayAfter(8))]).toMatchObject({ state: "weighing", kg: 80 });
    expect(healthProgress.get()).toEqual({ sending: null, pending: 1 });
  });

  it("sends each weigh-in under this account's own sync identifier", async () => {
    await setHealthOn(db, true, ON);
    await weighIns(1);
    health();
    const { r, changed } = runner();
    r.request();
    await ran(changed);
    expect(applied()[0]).toEqual([
      expect.objectContaining({ kind: "weighing", owner: ownerOf("user-a"), date: dayAfter(0) }),
    ]);
  });

  it("one account reached at two addresses of its server sends its weigh-ins as one owner", async () => {
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true });
    const owners: string[] = [];
    try {
      for (const instance of ["https://belay.example", "https://gym.example"]) {
        writeInstance(instance);
        const at = await openAccountDb("user-a");
        await setHealthOn(at, true, ON);
        const tx = at.transaction("weights", "readwrite");
        await tx.store.put({ date: dayAfter(0), weightKg: 80, at: "2026-10-01T06:00:00.000Z" });
        await tx.done;
        native.health.mockReset();
        health();
        const { r, changed } = runner(vi.fn(), at);
        r.request();
        await ran(changed);
        owners.push((applied()[0]![0] as { owner: string }).owner);
        at.close();
      }
    } finally {
      vi.unstubAllGlobals();
      localStorage.clear();
    }
    expect(owners).toEqual([ownerOf("user-a"), ownerOf("user-a")]);
  });

  it("a request during a run gives exactly one more run", async () => {
    await setHealthOn(db, true, ON);
    let open = () => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    native.health.mockImplementation(async (req: HealthRequest) => {
      if (req.op === "status") await gate;
      return ALLOWED;
    });
    const { r, changed } = runner();
    r.request();
    await vi.waitFor(() => expect(statusCalls()).toBe(1));
    r.request();
    r.request();
    r.foreground();
    open();
    await ran(changed, 2);
    await settle();
    expect(statusCalls()).toBe(2);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("turned off between two batches, nothing more goes", async () => {
    await setHealthOn(db, true, ON);
    await weighIns(150);
    native.health.mockImplementation(async (req: HealthRequest) => {
      if (req.op === "status") return ALLOWED;
      if (req.op !== "apply") throw new Error(req.op);
      await setHealthOn(db, false, NOW);
      return { outcomes: req.objects.map(() => "written") };
    });
    const { r, changed } = runner();
    r.request();
    await ran(changed);
    expect(applied()).toHaveLength(1);
    // The batch already handed to Health is recorded, and the page told.
    expect(Object.keys((await readHealth(db)).written)).toHaveLength(100);
    expect(healthProgress.get()).toEqual({ sending: null, pending: 0 });
  });

  it("turned off and on again during a history run, the history is offered anew", async () => {
    await weighIns(3, -10);
    await setHealthOn(db, true, ON);
    await setHistory(db, "asked");
    native.health.mockImplementation(async (req: HealthRequest) => {
      if (req.op === "status") return ALLOWED;
      if (req.op !== "apply") throw new Error(req.op);
      await setHealthOn(db, false, NOW);
      await setHealthOn(db, true, NOW);
      return { outcomes: req.objects.map(() => "written") };
    });
    const { r, changed } = runner();
    r.request();
    await ran(changed);
    expect((await readHealth(db)).settings).toMatchObject({ on: true, history: "no" });
  });

  it("turned off and on again between two batches, the old history stops going", async () => {
    await weighIns(150, -200);
    await setHealthOn(db, true, ON);
    await setHistory(db, "asked");
    native.health.mockImplementation(async (req: HealthRequest) => {
      if (req.op === "status") return ALLOWED;
      if (req.op !== "apply") throw new Error(req.op);
      await setHealthOn(db, false, NOW);
      await setHealthOn(db, true, NOW);
      return { outcomes: req.objects.map(() => "written") };
    });
    const { r, changed } = runner();
    r.request();
    await ran(changed);
    expect(applied()).toHaveLength(1);
    expect(healthProgress.get()).toEqual({ sending: null, pending: 0 });
  });

  it("a run cut short by the database closing leaves no « n sur N » on screen", async () => {
    await weighIns(3, -10);
    await setHealthOn(db, true, ON);
    await setHistory(db, "asked");
    native.health.mockImplementation(async (req: HealthRequest) => {
      if (req.op === "status") return ALLOWED;
      db.close();
      return { outcomes: (req as { objects: unknown[] }).objects.map(() => "written") };
    });
    const { r } = runner();
    r.request();
    await vi.waitFor(() => expect(applied()).toHaveLength(1));
    await settle();
    expect(healthProgress.get().sending).toBeNull();
  });

  it("a denied outcome blocks that type until the next foreground", async () => {
    await setHealthOn(db, true, ON);
    await weighIns(2);
    health((_, call) => (call === 1 ? "denied" : "written"));
    const { r, changed } = runner();
    r.request();
    await ran(changed);
    expect(healthProgress.get().pending).toBe(0);
    r.request();
    await ran(changed, 2);
    expect(applied()).toHaveLength(1);
    expect(statusCalls()).toBe(2);
    r.foreground();
    await ran(changed, 3);
    expect(applied()).toHaveLength(2);
    expect(applied()[1]).toHaveLength(2);
  });

  it("a rejected apply leaves its objects pending", async () => {
    await setHealthOn(db, true, ON);
    await weighIns(3);
    native.health.mockImplementation(async (req: HealthRequest) => {
      if (req.op === "status") return ALLOWED;
      throw new Error("Health is locked");
    });
    const { r, changed } = runner();
    r.request();
    await ran(changed);
    expect(healthProgress.get()).toEqual({ sending: null, pending: 3 });
    expect((await readHealth(db)).written).toEqual({});
    health();
    r.request();
    await ran(changed, 2);
    expect(applied()[1]).toHaveLength(3);
    expect(healthProgress.get().pending).toBe(0);
  });

  it("the history shows n of N and is sent only when nothing is pending", async () => {
    // Weigh-ins from before the setting went on wait for the history action.
    await weighIns(150, -200);
    await setHealthOn(db, true, ON);
    await setHistory(db, "asked");
    const seen: HealthProgress["sending"][] = [];
    const off = healthProgress.subscribe(() => seen.push(healthProgress.get().sending));
    health((o) => (o.kind === "weighing" && o.date === dayAfter(-200) ? "unavailable" : "written"));
    const { r, changed } = runner();
    r.request();
    await ran(changed);
    expect(seen).toEqual([
      { done: 0, total: 150 },
      { done: 100, total: 150 },
      { done: 150, total: 150 },
      null,
    ]);
    expect((await readHealth(db)).settings.history).toBe("asked");
    health();
    r.request();
    await ran(changed, 2);
    expect(applied()[2]).toHaveLength(1);
    expect((await readHealth(db)).settings.history).toBe("sent");
    off();
  });

  it("new data after the setting shows no « n sur N »", async () => {
    await setHealthOn(db, true, ON);
    await recordChange(db, {
      kind: "weight",
      date: dayAfter(3),
      weightKg: 80.4,
      at: new Date(NOW).toISOString(),
    });
    const seen: HealthProgress["sending"][] = [];
    const off = healthProgress.subscribe(() => seen.push(healthProgress.get().sending));
    health();
    const { r, changed } = runner();
    r.request();
    await ran(changed);
    expect(applied()).toHaveLength(1);
    expect(seen.every((s) => s === null)).toBe(true);
    off();
  });

  it("a history landing during the status call goes back to Health as no weigh-in", async () => {
    await setHealthOn(db, true, ON);
    await setImportOn(db, true, ON);
    await setHistory(db, "asked");
    await askImportHistory(db);
    const samples = [1, 2, 3].map((date) => ({
      startedAt: new Date(2025, 2, date, 7).getTime(),
      kg: 80,
    }));
    const from = { anchor: null, since: HISTORY_SINCE };
    native.health.mockImplementation(async (req: HealthRequest) => {
      if (req.op !== "status") throw new Error(req.op);
      await importWeighings(db, samples, "H1", new Date(NOW), from);
      return ALLOWED;
    });
    const { r, changed } = runner();
    r.request();
    await ran(changed);
    expect(await db.count("weights")).toBe(3);
    expect(applied()).toEqual([]);
  });

  it("an interrupted run writes the unconfirmed objects again under the same sync identifiers", async () => {
    await setHealthOn(db, true, ON);
    await weighIns(3);
    // The app is closed while Health holds the batch: no answer, nothing recorded.
    native.health.mockImplementation(async (req: HealthRequest) =>
      req.op === "status" ? ALLOWED : new Promise(() => {}),
    );
    const first = runner();
    first.r.request();
    await vi.waitFor(() => expect(applied()).toHaveLength(1));
    first.r.stop();
    health();
    const next = runner();
    next.r.request();
    await ran(next.changed);
    expect(applied()[1]).toEqual(applied()[0]);
    expect(Object.keys((await readHealth(db)).written)).toHaveLength(3);
  });
});
