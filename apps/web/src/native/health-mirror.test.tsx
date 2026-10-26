import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toISODate } from "@belay/shared/body/dates";
import { act, cleanup, render } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAccount } from "@/sync/account";
import { type AccountDb, openAccountDb, recordChange } from "@/sync/db";
import type { SyncEngine } from "@/sync/engine";

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
  type HealthObject,
  type HealthOutcome,
  type HealthRequest,
  requestHealthRun,
  setHealthOn,
  setImportOn,
} from "./health";
import { HealthMirror } from "./health-mirror";

const ALLOWED = { available: true, workouts: "allowed", weighings: "allowed" };
const ON = new Date(2026, 9, 1, 7).getTime();
const TODAY = toISODate(new Date());

let db: AccountDb;
let queryClient: QueryClient;
let off: ReturnType<typeof vi.fn>;
let engine: { onLanded: ReturnType<typeof vi.fn>; schedule: ReturnType<typeof vi.fn> };
let answer: (o: HealthObject) => HealthOutcome;
beforeEach(async () => {
  indexedDB = new IDBFactory();
  db = await openAccountDb("user-a");
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  off = vi.fn();
  engine = { onLanded: vi.fn(() => off), schedule: vi.fn() };
  answer = () => "written";
  native.health.mockReset();
  native.health.mockImplementation(async (r: HealthRequest) => {
    if (r.op === "status") return ALLOWED;
    if (r.op === "apply") return { outcomes: r.objects.map((o) => answer(o)) };
    if (r.op === "readWeighings")
      return { samples: [{ startedAt: Date.now(), kg: 79.6 }], anchor: "A1" };
    throw new Error(r.op);
  });
  await setHealthOn(db, true, ON);
});
afterEach(() => cleanup());

const account = () =>
  ({
    kind: "open",
    user: { id: "user-a", displayName: "A" },
    db,
    engine: engine as unknown as SyncEngine,
  }) as OpenAccount;
const mount = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <HealthMirror account={account()} />
    </QueryClientProvider>,
  );
const calls = (op: HealthRequest["op"]) =>
  native.health.mock.calls.map(([r]) => r as HealthRequest).filter((r) => r.op === op);
const weighIn = async (date: string, weightKg: number) => {
  await recordChange(db, { kind: "weight", date, weightKg, at: new Date().toISOString() });
  // What the app does after its own write.
  await act(() => queryClient.invalidateQueries({ queryKey: ["local", "user-a"] }));
};
const foreground = () =>
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });

describe("HealthMirror", () => {
  it("runs when the account opens and when a weigh-in is recorded", async () => {
    mount();
    await vi.waitFor(() => expect(calls("status").length).toBeGreaterThan(0));
    expect(calls("apply")).toEqual([]);
    await weighIn(TODAY, 80.4);
    await vi.waitFor(() =>
      expect(calls("apply").flatMap((r) => (r as { objects: HealthObject[] }).objects)).toEqual([
        expect.objectContaining({ kind: "weighing", date: TODAY, kg: 80.4 }),
      ]),
    );
  });

  it("tells the page's Health reads after a run, and nothing else, so it never starts itself", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await recordChange(db, {
      kind: "weight",
      date: TODAY,
      weightKg: 80.4,
      at: new Date().toISOString(),
    });
    mount();
    await vi.waitFor(() => expect(calls("apply")).toHaveLength(1));
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
      invalidate.mock.calls.map(() => ["local", "user-a", "health"]),
    );
    expect(calls("apply")).toHaveLength(1);
  });

  it("the foreground clears a blocked type", async () => {
    answer = () => "denied";
    await recordChange(db, {
      kind: "weight",
      date: TODAY,
      weightKg: 80.4,
      at: new Date().toISOString(),
    });
    mount();
    await vi.waitFor(() => expect(calls("apply")).toHaveLength(1));
    answer = () => "written";
    await weighIn(TODAY, 80.6);
    await vi.waitFor(() => expect(calls("status").length).toBeGreaterThan(1));
    expect(calls("apply")).toHaveLength(1);
    await foreground();
    await vi.waitFor(() => expect(calls("apply")).toHaveLength(2));
  });

  it("a landed sync starts the import", async () => {
    await setImportOn(db, true, Date.now());
    mount();
    expect(engine.onLanded).toHaveBeenCalledTimes(1);
    const landed = engine.onLanded.mock.calls[0]![0] as () => void;
    landed();
    await vi.waitFor(() => expect(engine.schedule).toHaveBeenCalledTimes(1));
    expect(calls("readWeighings")).toHaveLength(1);
    expect(await db.get("weights", TODAY)).toMatchObject({ weightKg: 79.6 });
  });

  it("is the page's runner while mounted, and leaves on unmount", async () => {
    const { unmount } = mount();
    await vi.waitFor(() => expect(calls("status").length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 30));
    const before = calls("status").length;
    requestHealthRun();
    await vi.waitFor(() => expect(calls("status").length).toBe(before + 1));
    unmount();
    expect(off).toHaveBeenCalledTimes(1);
    requestHealthRun();
    await foreground();
    await new Promise((r) => setTimeout(r, 30));
    expect(calls("status")).toHaveLength(before + 1);
  });
});
