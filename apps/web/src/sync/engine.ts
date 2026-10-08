import { MAX_CHANGES } from "@belay/shared/sync/limits";
import type { SyncRequest, SyncResponse } from "@belay/shared/sync/schema";
import { type AccountDb, applyServer, readCursor, readOutbox } from "./db";

// What the banners show: nothing for idle and syncing.
export type SyncStatus = "idle" | "syncing" | "offline" | "expired" | "failed";
export type SendResult =
  { kind: "ok"; response: SyncResponse } | { kind: "offline" | "expired" | "failed" };
export type Send = (request: SyncRequest) => Promise<SendResult>;

export interface SyncEngine {
  sync(): Promise<void>; // now; concurrent calls share one run
  schedule(): void; // after an entry, debounced
  start(): () => void; // syncs at once and on every trigger; returns the stop function
  status(): SyncStatus;
  subscribe(listener: () => void): () => void;
}

// A server bug answering hasMore forever must not spin the phone: the next trigger goes on.
const MAX_ROUNDS = 50;

export function createSyncEngine({
  userId,
  db,
  send,
  onApplied,
  debounceMs = 1000,
  locks = "locks" in navigator ? navigator.locks : undefined,
}: {
  userId: string;
  db: AccountDb;
  send: Send;
  onApplied: () => void;
  debounceMs?: number;
  locks?: Pick<LockManager, "request">;
}): SyncEngine {
  let status: SyncStatus = "idle";
  const listeners = new Set<() => void>();
  const set = (next: SyncStatus) => {
    if (next === status) return;
    status = next;
    for (const listener of listeners) listener();
  };

  // Oldest 500 first, with the cursor; on 200 the sent changes leave the queue. Again while
  // the queue holds changes (entered meanwhile, or beyond 500) or the server has more rows.
  async function rounds(): Promise<void> {
    set("syncing");
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const batch = await readOutbox(db, MAX_CHANGES);
        const result = await send({
          account: userId,
          cursor: await readCursor(db),
          changes: batch.map((e) => e.change),
        });
        if (result.kind !== "ok") return set(result.kind);
        await applyServer(
          db,
          batch.map((e) => e.id),
          result.response,
        );
        onApplied();
        if (!result.response.hasMore && (await readOutbox(db, 1)).length === 0) break;
      }
      set("idle");
    } catch (error) {
      console.error(
        "sync: local database failed:",
        error instanceof Error ? error.name : "unknown",
      );
      set("failed"); // the local database failed; the queue is untouched
    }
  }

  // One sender at a time across every tab of this account.
  // ponytail: without the Web Locks API (Safari before 15.4) two tabs may send the same batch;
  // the server's merge turns the second into a no-op. Upgrade: elect a leader tab.
  const locked = () => (locks ? locks.request(`belay.sync.${userId}`, rounds) : rounds());

  let running: Promise<void> | null = null;
  let again = false;
  function sync(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await locked();
      } while (again);
    })().finally(() => {
      running = null;
    });
    return running;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => void sync(), debounceMs);
  }

  function start() {
    const onOnline = () => void sync();
    const onOffline = () => set("offline");
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    void sync();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(timer);
    };
  }

  return {
    sync,
    schedule,
    start,
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
