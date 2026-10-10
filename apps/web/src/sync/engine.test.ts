import { addDays } from "@belay/shared/body/dates";
import type { Change, SyncRequest, SyncResponse } from "@belay/shared/sync/schema";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answer } from "@/test/answer";
import { fakeApi } from "@/test/fake-api";
import {
  type AccountDb,
  openAccountDb,
  readOutbox,
  readRejected,
  readWeights,
  recordChange,
} from "./db";
import { createSyncEngine, type Send, type SendResult } from "./engine";
import { postSync } from "./transport";

const AT = "2026-10-07T06:30:00.000Z";
const weight = (date: string, weightKg: number | null, at = AT): Change => ({
  kind: "weight",
  date,
  weightKg,
  at,
});
const empty = (cursor: string): SyncResponse => answer({ cursor });
const ok = (response: SyncResponse): SendResult => ({ kind: "ok", response });

// One Web Locks queue per name, like the browser's, shared by the engines of one test.
function fakeLocks(): Pick<LockManager, "request"> {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request: ((name: string, fn: () => Promise<unknown>) => {
      const run = (tails.get(name) ?? Promise.resolve()).then(fn);
      tails.set(
        name,
        run.catch(() => {}),
      );
      return run;
    }) as LockManager["request"],
  };
}

let db: AccountDb;
beforeEach(async () => {
  indexedDB = new IDBFactory();
  db = await openAccountDb("user-a");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const engineWith = (send: Send, extra: Partial<Parameters<typeof createSyncEngine>[0]> = {}) =>
  createSyncEngine({ userId: "user-a", db, send, onApplied: () => {}, ...extra });

describe("a sync", () => {
  it("sends the queue with the cursor, then drops exactly what was sent", async () => {
    await recordChange(db, weight("2026-10-06", 80.2));
    await recordChange(db, weight("2026-10-07", 79.8));
    const send = vi.fn<Send>(async () => ok(empty("5")));
    const onApplied = vi.fn();
    const engine = engineWith(send, { onApplied });
    await engine.sync();
    expect(send).toHaveBeenCalledWith({
      account: "user-a",
      cursor: "0",
      changes: [weight("2026-10-06", 80.2), weight("2026-10-07", 79.8)],
    });
    expect(await readOutbox(db)).toEqual([]);
    expect(onApplied).toHaveBeenCalled();
    expect(engine.status()).toBe("idle");
    await engine.sync();
    expect(send).toHaveBeenLastCalledWith({ account: "user-a", cursor: "5", changes: [] });
  });

  it("keeps a change entered while the request was out, and sends it next", async () => {
    await recordChange(db, weight("2026-10-07", 80));
    const later = weight("2026-10-07", 79.8, "2026-10-07T06:31:00.000Z");
    let calls = 0;
    const send = vi.fn<Send>(async () => {
      calls++;
      if (calls === 1) await recordChange(db, later); // the person corrects it meanwhile
      return ok(empty(String(calls)));
    });
    await engineWith(send).sync();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0].changes).toEqual([later]);
    expect(await readWeights(db)).toEqual([{ date: "2026-10-07", weightKg: 79.8 }]);
    expect(await readOutbox(db)).toEqual([]);
  });

  // A 401, no network, and a refusal or a server error.
  it.each(["expired", "offline", "failed"] as const)(
    "keeps the whole queue and reports %s",
    async (kind) => {
      await recordChange(db, weight("2026-10-07", 79.8));
      const engine = engineWith(async () => ({ kind }));
      await engine.sync();
      expect(engine.status()).toBe(kind);
      expect(await readOutbox(db)).toHaveLength(1);
    },
  );
});

describe("a long queue or a long history", () => {
  it("goes 500 changes at a time, oldest first, and keeps the rest when the session expires", async () => {
    for (let i = 0; i < 1200; i++) await recordChange(db, weight(addDays("2023-01-01", i), 80));
    const sizes: number[] = [];
    const send = vi.fn<Send>(async (r) => {
      sizes.push(r.changes.length);
      return sizes.length === 2 ? { kind: "expired" } : ok(empty(String(sizes.length)));
    });
    const engine = engineWith(send);
    await engine.sync();
    expect(sizes).toEqual([500, 500]);
    expect(send.mock.calls[0]![0].changes[0]).toEqual(weight("2023-01-01", 80));
    expect(engine.status()).toBe("expired");
    const left = await readOutbox(db);
    expect(left).toHaveLength(700);
    expect(left[0]!.change).toEqual(weight(addDays("2023-01-01", 500), 80));
  });

  it("pages through a first sync until the server has nothing more", async () => {
    const pages = [
      { cursor: "1000", hasMore: true, weights: [{ date: "2026-10-01", weightKg: 81, at: AT }] },
      { cursor: "1500", hasMore: false, weights: [{ date: "2026-10-02", weightKg: 80.8, at: AT }] },
    ];
    const send = vi.fn<Send>(async () => ok(answer(pages.shift())));
    await engineWith(send).sync();
    expect(send.mock.calls.map(([r]) => r.cursor)).toEqual(["0", "1000"]);
    expect((await readWeights(db)).map((w) => w.date)).toEqual(["2026-10-01", "2026-10-02"]);
  });

  it("tells onSynced when it pulled everything, never after the round cap", async () => {
    const onSynced = vi.fn(async () => {});
    const more = vi.fn<Send>(async () => ok(answer({ cursor: "9", hasMore: true })));
    await engineWith(more, { onSynced }).sync();
    expect(more.mock.calls.length).toBeGreaterThan(1); // it paged until the cap
    expect(onSynced).not.toHaveBeenCalled();
    const done = vi.fn<Send>(async () => ok(empty("9")));
    await engineWith(done, { onSynced }).sync();
    expect(onSynced).toHaveBeenCalledTimes(1);
  });
});

describe("a change the server refuses", () => {
  it("leaves the queue with a trace, and the changes after it still go", async () => {
    await recordChange(db, weight("2026-10-06", 80.2));
    await recordChange(db, weight("2026-10-07", 79.8));
    const send = vi.fn<Send>(async () =>
      ok({ ...empty("4"), rejected: [{ index: 0, reason: "refused" }] }),
    );
    const engine = engineWith(send);
    await engine.sync();
    expect(await readOutbox(db)).toEqual([]);
    expect((await readRejected(db)).map((r) => [r.change, r.reason])).toEqual([
      [weight("2026-10-06", 80.2), "refused"],
    ]);
    expect(engine.status()).toBe("idle");
    await engine.sync();
    expect(send).toHaveBeenLastCalledWith({ account: "user-a", cursor: "4", changes: [] });
  });
});

describe("a sync cut off after the server committed", () => {
  it("sends the same batch again, which the server's merge turns into nothing new", async () => {
    const api = fakeApi({ me: { id: "user-a", displayName: "A" } });
    await recordChange(db, weight("2026-10-07", 79.8));
    let lose = true;
    const send: Send = async (request) => {
      if (!lose) return postSync(request);
      lose = false;
      api.server(request); // the server commits, then the answer never arrives
      return { kind: "offline" };
    };
    const engine = engineWith(send);
    await engine.sync();
    expect(engine.status()).toBe("offline");
    expect(await readOutbox(db)).toHaveLength(1);
    const before = [...api.rows.values()];
    await engine.sync();
    expect(api.requests[0]!.changes).toEqual([weight("2026-10-07", 79.8)]);
    expect([...api.rows.values()]).toEqual(before); // same row, same sequence: nothing doubled
    expect(await readOutbox(db)).toEqual([]);
    expect(engine.status()).toBe("idle");
  });
});

describe("two tabs of one account", () => {
  it("send a change once: the lock serialises them, and the second finds the queue empty", async () => {
    const locks = fakeLocks();
    const sent: SyncRequest[] = [];
    const send: Send = async (r) => {
      sent.push(r);
      return ok(empty(String(sent.length)));
    };
    const tabA = engineWith(send, { locks });
    const tabB = createSyncEngine({
      userId: "user-a",
      db: await openAccountDb("user-a"),
      send,
      onApplied: () => {},
      locks,
    });
    await recordChange(db, weight("2026-10-07", 79.8));
    await Promise.all([tabA.sync(), tabB.sync()]);
    expect(sent.map((r) => r.changes.length)).toEqual([1, 0]);
  });
});

describe("triggers", () => {
  it("syncs at start, when the network comes back and when the app returns to the front", async () => {
    const send = vi.fn<Send>(async () => ok(empty("1")));
    const engine = engineWith(send);
    const stop = engine.start();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    window.dispatchEvent(new Event("offline"));
    expect(engine.status()).toBe("offline");
    stop();
    window.dispatchEvent(new Event("online"));
    await new Promise((r) => setTimeout(r, 10));
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("refreshes with the sync already running, and only syncs again when none is", async () => {
    let release = () => {};
    const send = vi.fn<Send>(async () => ok(empty("1")));
    send.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(ok(empty("1"))))),
    );
    const engine = engineWith(send);
    const running = engine.sync();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const refreshed = engine.refresh();
    release();
    await Promise.all([running, refreshed]);
    expect(send).toHaveBeenCalledTimes(1);
    await engine.refresh();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("waits one second after the last entry", async () => {
    // Only the debounce timer: fake-indexeddb runs on setImmediate.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const send = vi.fn<Send>(async () => ok(empty("1")));
    const engine = engineWith(send);
    engine.schedule();
    await vi.advanceTimersByTimeAsync(600);
    engine.schedule();
    await vi.advanceTimersByTimeAsync(600);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  });
});

describe("postSync", () => {
  it("reads 200, 401, other errors, a broken answer and no network", async () => {
    const request = { account: "user-a", cursor: "0", changes: [] };
    const reply = (res: Response | Error) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => (res instanceof Error ? Promise.reject(res) : res)),
      );
    reply(Response.json(empty("3")));
    expect(await postSync(request)).toEqual(ok(empty("3")));
    reply(new Response(null, { status: 401 }));
    expect(await postSync(request)).toEqual({ kind: "expired" });
    reply(new Response(null, { status: 409 }));
    expect(await postSync(request)).toEqual({ kind: "expired" });
    reply(new Response(null, { status: 400 }));
    expect(await postSync(request)).toEqual({ kind: "failed" });
    reply(new Response(null, { status: 502 }));
    expect(await postSync(request)).toEqual({ kind: "failed" });
    reply(Response.json({ cursor: "x" }));
    expect(await postSync(request)).toEqual({ kind: "failed" });
    reply(new TypeError("Failed to fetch"));
    expect(await postSync(request)).toEqual({ kind: "offline" });
  });
});
