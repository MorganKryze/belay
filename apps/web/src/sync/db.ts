import type { ISODate } from "@belay/shared/body/dates";
import type { IntakeLog } from "@belay/shared/body/intake";
import type { Measure } from "@belay/shared/body/measures";
import { EMPTY_PROFILE, type Profile } from "@belay/shared/body/profile";
import { isCreatineName } from "@belay/shared/body/supplements";
import { DEFAULT_TARGET, type TargetRange } from "@belay/shared/body/target";
import type { Weighing } from "@belay/shared/body/weighings";
import { isNewer } from "@belay/shared/sync/merge";
import type {
  AnnotationRow,
  Change,
  IntakeRow,
  MeasureRow,
  ProfileRow,
  Rejected,
  SupplementLogRow,
  SupplementRow,
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
  // Each field with its own time, as on the server; null values are deleted ones.
  measures: { key: ISODate; value: MeasureRow };
  intake: { key: ISODate; value: IntakeRow };
  supplements: { key: string; value: SupplementRow }; // removed ones stay, with their ticks
  supplementLogs: { key: [string, ISODate]; value: SupplementLogRow };
  annotations: { key: string; value: AnnotationRow };
  // "target": the loss range (version 1); "body": the profile.
  profile: { key: "target" | "body"; value: TargetRow | ProfileRow };
  // In the order the person entered things; the id is given by the store.
  outbox: { key: number; value: { id?: number; change: Change } };
  meta: { key: "cursor"; value: string };
  rejected: { key: number; value: { id?: number; change: Change; reason: Rejected["reason"] } };
}
export type AccountDb = IDBPDatabase<BelaySchema>;
type Store =
  | "weights"
  | "measures"
  | "intake"
  | "supplements"
  | "supplementLogs"
  | "annotations"
  | "profile"
  | "outbox"
  | "meta"
  | "rejected";
type WriteTx = IDBPTransaction<BelaySchema, Store[], "readwrite">;
const ALL: Store[] = [
  "weights",
  "measures",
  "intake",
  "supplements",
  "supplementLogs",
  "annotations",
  "profile",
  "outbox",
  "meta",
  "rejected",
];

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
    // Each step adds stores and keeps every value and the queue of the earlier versions. A tab
    // still on version 1 closes its connection when asked (`blocking` below, since M2a), so the
    // upgrade never waits on it.
    upgrade(upgradeDb, oldVersion) {
      if (oldVersion < 1) {
        upgradeDb.createObjectStore("weights", { keyPath: "date" });
        upgradeDb.createObjectStore("profile");
        upgradeDb.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
        upgradeDb.createObjectStore("meta");
      }
      if (oldVersion < 2) {
        upgradeDb.createObjectStore("rejected", { keyPath: "id", autoIncrement: true });
        upgradeDb.createObjectStore("measures", { keyPath: "date" });
        upgradeDb.createObjectStore("intake", { keyPath: "date" });
        upgradeDb.createObjectStore("supplements", { keyPath: "id" });
        upgradeDb.createObjectStore("supplementLogs", { keyPath: ["supplementId", "date"] });
        upgradeDb.createObjectStore("annotations", { keyPath: "id" });
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

// Where each field of a change lives in its row.
const MEASURE = {
  waist: ["waistCm", "waistAt"],
  neck: ["neckCm", "neckAt"],
  hip: ["hipCm", "hipAt"],
} as const;
const INTAKE = { kcal: ["kcal", "kcalAt"], protein: ["proteinG", "proteinAt"] } as const;
const PROFILE = {
  formula: ["formula", "formulaAt"],
  birthYear: ["birthYear", "birthYearAt"],
  height: ["heightCm", "heightAt"],
} as const;
const emptyMeasure = (date: ISODate): MeasureRow => ({
  date,
  waistCm: null,
  waistAt: null,
  neckCm: null,
  neckAt: null,
  hipCm: null,
  hipAt: null,
});
const emptyIntake = (date: ISODate): IntakeRow => ({
  date,
  kcal: null,
  kcalAt: null,
  proteinG: null,
  proteinAt: null,
});
const EMPTY_PROFILE_ROW: ProfileRow = {
  formula: null,
  formulaAt: null,
  birthYear: null,
  birthYearAt: null,
  heightCm: null,
  heightAt: null,
};
type Fields = Record<string, unknown>;
const set = <R>(row: R, [value, at]: readonly [string, string], v: unknown, a: string | null) =>
  ({ ...row, [value]: v, [at]: a }) as R;

// The time of the field a change writes, as this device holds it; null: never written here.
async function localAt(tx: WriteTx, change: Change): Promise<string | null> {
  switch (change.kind) {
    case "weight":
      return (await tx.objectStore("weights").get(change.date))?.at ?? null;
    case "target":
      return ((await tx.objectStore("profile").get("target")) as TargetRow | undefined)?.at ?? null;
    case "measure": {
      const row = (await tx.objectStore("measures").get(change.date)) as Fields | undefined;
      return (row?.[MEASURE[change.field][1]] as string | null) ?? null;
    }
    case "intake": {
      const row = (await tx.objectStore("intake").get(change.date)) as Fields | undefined;
      return (row?.[INTAKE[change.field][1]] as string | null) ?? null;
    }
    case "profile": {
      const row = (await tx.objectStore("profile").get("body")) as Fields | undefined;
      return (row?.[PROFILE[change.field][1]] as string | null) ?? null;
    }
    case "supplement": {
      const row = await tx.objectStore("supplements").get(change.id);
      return (change.field === "name" ? row?.nameAt : row?.removedAt) ?? null;
    }
    case "supplementLog":
      return (
        (await tx.objectStore("supplementLogs").get([change.supplementId, change.date]))?.at ?? null
      );
    case "annotation": {
      const row = await tx.objectStore("annotations").get(change.id);
      return (change.field === "fields" ? row?.fieldsAt : row?.removedAt) ?? null;
    }
  }
}

// Writes what a change says into the device's copy, the way the server merges it.
async function applyLocal(tx: WriteTx, change: Change): Promise<void> {
  switch (change.kind) {
    case "weight":
      await tx
        .objectStore("weights")
        .put({ date: change.date, weightKg: change.weightKg, at: change.at });
      return;
    case "target":
      await tx
        .objectStore("profile")
        .put({ minPct: change.minPct, maxPct: change.maxPct, at: change.at }, "target");
      return;
    case "measure": {
      const store = tx.objectStore("measures");
      const row = (await store.get(change.date)) ?? emptyMeasure(change.date);
      await store.put(set(row, MEASURE[change.field], change.value, change.at));
      return;
    }
    case "intake": {
      const store = tx.objectStore("intake");
      const row = (await store.get(change.date)) ?? emptyIntake(change.date);
      await store.put(set(row, INTAKE[change.field], change.value, change.at));
      return;
    }
    case "profile": {
      const store = tx.objectStore("profile");
      const row = ((await store.get("body")) as ProfileRow | undefined) ?? EMPTY_PROFILE_ROW;
      await store.put(set(row, PROFILE[change.field], change.value, change.at), "body");
      return;
    }
    case "supplement": {
      const store = tx.objectStore("supplements");
      const row = await store.get(change.id);
      if (change.field === "name")
        await store.put({
          ...(row ?? {
            id: change.id,
            // From the first name, as the server decides it (§6).
            kind: isCreatineName(change.value) ? "creatine" : "other",
            removed: false,
            removedAt: null,
          }),
          name: change.value,
          nameAt: change.at,
        });
      else if (row) await store.put({ ...row, removed: change.value, removedAt: change.at });
      return;
    }
    case "supplementLog":
      await tx.objectStore("supplementLogs").put({
        supplementId: change.supplementId,
        date: change.date,
        taken: change.taken,
        at: change.at,
      });
      return;
    case "annotation": {
      const store = tx.objectStore("annotations");
      const row = await store.get(change.id);
      if (change.field === "fields")
        await store.put({
          ...(row ?? { removed: false, removedAt: null }),
          id: change.id,
          date: change.date,
          type: change.type,
          label: change.label,
          fieldsAt: change.at,
        });
      else if (row) await store.put({ ...row, removed: change.value, removedAt: change.at });
      return;
    }
  }
}

// The value a refused change put on screen goes, unless something later replaced it; the
// server sends back what it holds for that key, if anything, in the same answer.
async function revert(tx: WriteTx, change: Change): Promise<void> {
  if ((await localAt(tx, change)) !== change.at) return;
  switch (change.kind) {
    case "weight":
      return tx.objectStore("weights").delete(change.date);
    case "target":
      return tx.objectStore("profile").delete("target");
    case "measure": {
      const row = await tx.objectStore("measures").get(change.date);
      if (row) await tx.objectStore("measures").put(set(row, MEASURE[change.field], null, null));
      return;
    }
    case "intake": {
      const row = await tx.objectStore("intake").get(change.date);
      if (row) await tx.objectStore("intake").put(set(row, INTAKE[change.field], null, null));
      return;
    }
    case "profile": {
      const row = (await tx.objectStore("profile").get("body")) as ProfileRow;
      await tx.objectStore("profile").put(set(row, PROFILE[change.field], null, null), "body");
      return;
    }
    case "supplement": {
      const row = (await tx.objectStore("supplements").get(change.id))!;
      if (change.field === "name") return tx.objectStore("supplements").delete(change.id);
      await tx.objectStore("supplements").put({ ...row, removed: false, removedAt: null });
      return;
    }
    case "supplementLog":
      return tx.objectStore("supplementLogs").delete([change.supplementId, change.date]);
    case "annotation": {
      const row = (await tx.objectStore("annotations").get(change.id))!;
      if (change.field === "fields") return tx.objectStore("annotations").delete(change.id);
      await tx.objectStore("annotations").put({ ...row, removed: false, removedAt: null });
      return;
    }
  }
}

// The values and their changes in one transaction: what the screen shows is always queued. A
// change outside the contract never enters the queue: the server would refuse it.
// ponytail: no compaction, a weigh-in rewritten three times is three changes, all idempotent.
// Upgrade: fold the changes of one key before sending, if a queue grows past a few hundred.
export async function recordChanges(db: AccountDb, changes: readonly Change[]): Promise<void> {
  if (!changes.every(isValidChange)) throw new RangeError("invalid change");
  const tx: WriteTx = db.transaction(ALL, "readwrite");
  const done = tx.done;
  done.catch(() => {}); // the failure below is the one error that propagates
  try {
    for (const change of changes) {
      await applyLocal(tx, change);
      await tx.objectStore("outbox").add({ change });
    }
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // already finished or aborted
    }
    throw error;
  }
  await done;
}

export const recordChange = (db: AccountDb, change: Change) => recordChanges(db, [change]);

export async function readWeights(db: AccountDb): Promise<Weighing[]> {
  const rows = await db.getAll("weights");
  return rows.flatMap((r) => (r.weightKg === null ? [] : [{ date: r.date, weightKg: r.weightKg }]));
}

export async function readTarget(db: AccountDb): Promise<TargetRange> {
  const row = (await db.get("profile", "target")) as TargetRow | undefined;
  return row ? { minPct: row.minPct, maxPct: row.maxPct } : DEFAULT_TARGET;
}

// The days with at least one measurement.
export async function readMeasures(db: AccountDb): Promise<Measure[]> {
  return (await db.getAll("measures")).flatMap(({ date, waistCm, neckCm, hipCm }) =>
    waistCm === null && neckCm === null && hipCm === null ? [] : [{ date, waistCm, neckCm, hipCm }],
  );
}

// The days with a calorie or protein value.
export async function readIntake(db: AccountDb): Promise<IntakeLog[]> {
  return (await db.getAll("intake")).flatMap(({ date, kcal, proteinG }) =>
    kcal === null && proteinG === null ? [] : [{ date, kcal, proteinG }],
  );
}

export async function readProfile(db: AccountDb): Promise<Profile> {
  const row = (await db.get("profile", "body")) as ProfileRow | undefined;
  return row
    ? { formula: row.formula, birthYear: row.birthYear, heightCm: row.heightCm }
    : EMPTY_PROFILE;
}

// Every supplement, the removed ones too (their ticks still mark creatine courses), oldest first.
export async function readSupplements(db: AccountDb): Promise<SupplementRow[]> {
  return (await db.getAll("supplements")).sort((a, b) => (a.id < b.id ? -1 : 1));
}

// The ticked boxes only.
export async function readSupplementLogs(db: AccountDb): Promise<SupplementLogRow[]> {
  return (await db.getAll("supplementLogs")).filter((l) => l.taken);
}

// The annotations still in place, by day.
export async function readAnnotations(db: AccountDb): Promise<AnnotationRow[]> {
  return (await db.getAll("annotations"))
    .filter((a) => !a.removed)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export async function readOutbox(db: AccountDb, limit?: number): Promise<OutboxEntry[]> {
  return (await db.getAll("outbox", null, limit)) as OutboxEntry[];
}

export async function readCursor(db: AccountDb): Promise<string> {
  return (await db.get("meta", "cursor")) ?? "0";
}

// The thing an entry is about, as a person counts entries: one weigh-in per day however many
// corrections, one box per supplement and day, one profile.
function entryOf(change: Change): string {
  switch (change.kind) {
    case "weight":
    case "measure":
    case "intake":
      return `${change.kind}|${change.date}`;
    case "target":
    case "profile":
      return change.kind;
    case "supplement":
    case "annotation":
      return `${change.kind}|${change.id}`;
    case "supplementLog":
      return `${change.kind}|${change.supplementId}|${change.date}`;
  }
}

// What is waiting: the days weighed, and every entry (weigh-ins included).
export async function pendingCounts(db: AccountDb): Promise<{ weighings: number; total: number }> {
  const changes = (await db.getAll("outbox")).map((e) => e.change);
  const entries = new Set(changes.map(entryOf));
  const weighings = [...entries].filter((e) => e.startsWith("weight|")).length;
  return { weighings, total: entries.size };
}

export async function readRejected(db: AccountDb): Promise<RejectedEntry[]> {
  return (await db.getAll("rejected")) as RejectedEntry[];
}

// The person has read about them.
export async function clearRejected(db: AccountDb): Promise<void> {
  await db.clear("rejected");
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
      // One after the other: two changes of one row read it, then write it, and must not cross.
      await revert(tx, entry.change);
    }
    await Promise.all(ops);
    for (const row of response.weights) queue(tx.objectStore("weights").put(row));
    for (const row of response.measures) queue(tx.objectStore("measures").put(row));
    for (const row of response.intake) queue(tx.objectStore("intake").put(row));
    for (const row of response.supplements) queue(tx.objectStore("supplements").put(row));
    for (const row of response.supplementLogs) queue(tx.objectStore("supplementLogs").put(row));
    for (const row of response.annotations) queue(tx.objectStore("annotations").put(row));
    if (response.target) queue(tx.objectStore("profile").put(response.target, "target"));
    if (response.profile) queue(tx.objectStore("profile").put(response.profile, "body"));
    await Promise.all(ops);
    for (const { change } of await tx.objectStore("outbox").getAll())
      if (isNewer(change.at, await localAt(tx, change))) await applyLocal(tx, change);
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
