import type { ISODate } from "@belay/shared/body/dates";
import { DEFAULT_TARGET, type TargetRange } from "@belay/shared/body/target";
import type { Weighing } from "@belay/shared/body/weighings";
import { isNewer } from "@belay/shared/sync/merge";
import type { Change, SyncResponse, TargetRow, WeightRow } from "@belay/shared/sync/schema";
import { isValidChange } from "@belay/shared/sync/valid";
import { type DBSchema, type IDBPDatabase, type IDBPTransaction, openDB } from "idb";

export type OutboxEntry = { id: number; change: Change };

interface BelaySchema extends DBSchema {
  weights: { key: ISODate; value: WeightRow }; // a null weight is a deleted day
  profile: { key: "target"; value: TargetRow };
  // In the order the person entered things; the id is given by the store.
  outbox: { key: number; value: { id?: number; change: Change } };
  meta: { key: "cursor"; value: string };
}
export type AccountDb = IDBPDatabase<BelaySchema>;
type WriteTx = IDBPTransaction<
  BelaySchema,
  ("weights" | "profile" | "outbox" | "meta")[],
  "readwrite"
>;

// One database per account (D3): another account on this device never sees it, and nothing in
// it is ever sent under another identity. Signing out keeps it.
export const accountDbName = (userId: string) => `belay.${userId}`;

export async function openAccountDb(userId: string): Promise<AccountDb> {
  return openDB<BelaySchema>(accountDbName(userId), 1, {
    upgrade(db) {
      db.createObjectStore("weights", { keyPath: "date" });
      db.createObjectStore("profile");
      db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
      db.createObjectStore("meta");
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
  const tx: WriteTx = db.transaction(["weights", "profile", "outbox", "meta"], "readwrite");
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

// After a 200: drop exactly the changes that were sent, take the server's rows, then put back
// on top the changes entered while the request was out (unless the server holds a later
// write), and keep the cursor. One transaction, so a closed app never keeps half of it.
export async function applyServer(
  db: AccountDb,
  sentIds: readonly number[],
  response: SyncResponse,
): Promise<void> {
  const tx: WriteTx = db.transaction(["weights", "profile", "outbox", "meta"], "readwrite");
  const weights = tx.objectStore("weights");
  const profile = tx.objectStore("profile");
  await Promise.all([
    ...sentIds.map((id) => tx.objectStore("outbox").delete(id)),
    ...response.weights.map((row) => weights.put(row)),
    ...(response.target ? [profile.put(response.target, "target")] : []),
  ]);
  for (const { change } of await tx.objectStore("outbox").getAll()) {
    const current =
      change.kind === "weight" ? await weights.get(change.date) : await profile.get("target");
    if (isNewer(change.at, current?.at ?? null)) await applyLocal(tx, change);
  }
  await tx.objectStore("meta").put(response.cursor, "cursor");
  await tx.done;
}
