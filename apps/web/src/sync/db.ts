import type { ISODate } from "@belay/shared/body/dates";
import { DEFAULT_TARGET, type TargetRange } from "@belay/shared/body/target";
import type { Weighing } from "@belay/shared/body/weighings";
import { isNewer } from "@belay/shared/sync/merge";
import type {
  Change,
  Rejected,
  SyncResponse,
  TargetRow,
  WeightRow,
} from "@belay/shared/sync/schema";
import { isValidChange } from "@belay/shared/sync/valid";
import { type DBSchema, type IDBPDatabase, type IDBPTransaction, openDB } from "idb";

export type OutboxEntry = { id: number; change: Change };
// A change the server refused: out of the queue, kept until the person has read about it.
export type RejectedEntry = { id: number; change: Change; reason: Rejected["reason"] };

interface BelaySchema extends DBSchema {
  weights: { key: ISODate; value: WeightRow }; // a null weight is a deleted day
  profile: { key: "target"; value: TargetRow };
  // In the order the person entered things; the id is given by the store.
  outbox: { key: number; value: { id?: number; change: Change } };
  meta: { key: "cursor"; value: string };
  rejected: { key: number; value: { id?: number; change: Change; reason: Rejected["reason"] } };
}
export type AccountDb = IDBPDatabase<BelaySchema>;
type Store = "weights" | "profile" | "outbox" | "meta" | "rejected";
type WriteTx = IDBPTransaction<BelaySchema, Store[], "readwrite">;
const ALL: Store[] = ["weights", "profile", "outbox", "meta", "rejected"];

// One database per account (D3): another account on this device never sees it, and nothing in
// it is ever sent under another identity. Signing out keeps it.
export const accountDbName = (userId: string) => `belay.${userId}`;

// `onLost` fires when this connection is gone for good (closed for another tab's schema upgrade,
// or terminated by the browser): every call on the handle would throw, so the caller reopens.
export async function openAccountDb(
  userId: string,
  { onLost }: { onLost?: () => void } = {},
): Promise<AccountDb> {
  return openDB<BelaySchema>(accountDbName(userId), 2, {
    // Each step adds stores and keeps every value and the queue of the earlier versions.
    upgrade(upgradeDb, oldVersion) {
      if (oldVersion < 1) {
        upgradeDb.createObjectStore("weights", { keyPath: "date" });
        upgradeDb.createObjectStore("profile");
        upgradeDb.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
        upgradeDb.createObjectStore("meta");
      }
      if (oldVersion < 2) {
        upgradeDb.createObjectStore("rejected", { keyPath: "id", autoIncrement: true });
      }
    },
    // A future schema bump in another tab must not hang on this connection.
    blocking(_current, _blocked, event) {
      (event.target as IDBDatabase).close();
      onLost?.();
    },
    // The browser may terminate the connection (storage cleared, disk pressure).
    terminated() {
      onLost?.();
    },
  });
}

function applyLocal(tx: WriteTx, change: Change) {
  return change.kind === "weight"
    ? tx.objectStore("weights").put({ date: change.date, weightKg: change.weightKg, at: change.at })
    : tx
        .objectStore("profile")
        .put({ minPct: change.minPct, maxPct: change.maxPct, at: change.at }, "target");
}

// The value and its change in one transaction: what the screen shows is always queued. A change
// outside the contract never enters the queue: the server would refuse its whole batch, forever.
// ponytail: no compaction, a weigh-in rewritten three times is three changes, all idempotent.
// Upgrade: fold the changes of one day before sending, if a queue grows past a few hundred.
export async function recordChange(db: AccountDb, change: Change): Promise<void> {
  if (!isValidChange(change)) throw new RangeError("invalid change");
  const tx: WriteTx = db.transaction(ALL, "readwrite");
  await Promise.all([applyLocal(tx, change), tx.objectStore("outbox").add({ change }), tx.done]);
}

export async function readWeights(db: AccountDb): Promise<Weighing[]> {
  const rows = await db.getAll("weights");
  return rows.flatMap((r) => (r.weightKg === null ? [] : [{ date: r.date, weightKg: r.weightKg }]));
}

export async function readTarget(db: AccountDb): Promise<TargetRange> {
  const row = await db.get("profile", "target");
  return row ? { minPct: row.minPct, maxPct: row.maxPct } : DEFAULT_TARGET;
}

export async function readOutbox(db: AccountDb, limit?: number): Promise<OutboxEntry[]> {
  return (await db.getAll("outbox", null, limit)) as OutboxEntry[];
}

export async function readCursor(db: AccountDb): Promise<string> {
  return (await db.get("meta", "cursor")) ?? "0";
}

// What is waiting, as a person counts it: one per day weighed, plus one for the range.
export async function pendingCounts(db: AccountDb): Promise<{ weighings: number; total: number }> {
  const changes = (await db.getAll("outbox")).map((e) => e.change);
  const days = new Set(changes.flatMap((c) => (c.kind === "weight" ? [c.date] : [])));
  const target = changes.some((c) => c.kind === "target");
  return { weighings: days.size, total: days.size + (target ? 1 : 0) };
}

export async function readRejected(db: AccountDb): Promise<RejectedEntry[]> {
  return (await db.getAll("rejected")) as RejectedEntry[];
}

// The person has read about them.
export async function clearRejected(db: AccountDb): Promise<void> {
  await db.clear("rejected");
}

// The value a refused change put on screen goes, unless something later replaced it; the
// server sends back what it holds for that key, if anything, in the same answer.
async function revert(tx: WriteTx, change: Change) {
  if (change.kind === "weight") {
    const row = await tx.objectStore("weights").get(change.date);
    if (row?.at === change.at) await tx.objectStore("weights").delete(change.date);
  } else {
    const row = await tx.objectStore("profile").get("target");
    if (row?.at === change.at) await tx.objectStore("profile").delete("target");
  }
}

// After a 200: drop exactly the changes that were sent, keep a trace of the refused ones and
// take back what they showed, take the server's rows, then put back on top the changes entered
// while the request was out (unless the server holds a later write), and keep the cursor. One
// transaction, so a closed app never keeps half of it.
export async function applyServer(
  db: AccountDb,
  sent: readonly OutboxEntry[],
  response: SyncResponse,
): Promise<void> {
  const tx: WriteTx = db.transaction(ALL, "readwrite");
  const done = tx.done;
  done.catch(() => {}); // the failure below is the one error that propagates
  try {
    const weights = tx.objectStore("weights");
    const profile = tx.objectStore("profile");
    // Each request is guarded as it is made: a row that throws synchronously must not leave the
    // earlier ones unhandled when the abort rejects them all.
    const ops: Promise<unknown>[] = [];
    const queue = (op: Promise<unknown>) => {
      op.catch(() => {});
      ops.push(op);
    };
    for (const { id } of sent) queue(tx.objectStore("outbox").delete(id));
    for (const { index, reason } of response.rejected) {
      const entry = sent[index];
      if (!entry) continue; // an index this request never had: nothing to drop
      queue(tx.objectStore("rejected").add({ change: entry.change, reason }));
      queue(revert(tx, entry.change));
    }
    await Promise.all(ops);
    for (const row of response.weights) queue(weights.put(row));
    if (response.target) queue(profile.put(response.target, "target"));
    await Promise.all(ops);
    for (const { change } of await tx.objectStore("outbox").getAll()) {
      const current =
        change.kind === "weight" ? await weights.get(change.date) : await profile.get("target");
      if (isNewer(change.at, current?.at ?? null)) await applyLocal(tx, change);
    }
    await tx.objectStore("meta").put(response.cursor, "cursor");
  } catch (error) {
    try {
      tx.abort(); // nothing of a half-applied answer stays
    } catch {
      // already finished or aborted
    }
    throw error;
  }
  await done;
}
