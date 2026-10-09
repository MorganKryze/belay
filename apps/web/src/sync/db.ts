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
  SetChange,
  SetRow,
  SupplementLogRow,
  SupplementRow,
  SyncResponse,
  TargetRow,
  WeightRow,
  WorkoutRow,
} from "@belay/shared/sync/schema";
import { isValidChange } from "@belay/shared/sync/valid";
import { autoClose, type History, openWorkout } from "@belay/shared/training/rules";
import { type DBSchema, type IDBPDatabase, type IDBPTransaction, openDB } from "idb";

export type OutboxEntry = { id: number; change: Change };
// A change the server refused: out of the queue, kept until the person has read about it.
export type RejectedEntry = { id: number; change: Change; reason: Rejected["reason"] };
// The session open on this device: which one, the slot it shows, and when its rest ends. Local
// only, never sent: the sets are what syncs.
export type ActiveSession = { workoutId: string; slotIndex: number; restEndsAt: string | null };

interface BelaySchema extends DBSchema {
  weights: { key: ISODate; value: WeightRow }; // a null weight is a deleted day
  // Each field with its own time, as on the server; null values are deleted ones.
  measures: { key: ISODate; value: MeasureRow };
  intake: { key: ISODate; value: IntakeRow };
  supplements: { key: string; value: SupplementRow }; // removed ones stay, with their ticks
  supplementLogs: { key: [string, ISODate]; value: SupplementLogRow };
  annotations: { key: string; value: AnnotationRow };
  workouts: { key: string; value: WorkoutRow }; // removed ones stay, as on the server
  sets: { key: string; value: SetRow; indexes: { workoutId: string } };
  activeSession: { key: "current"; value: ActiveSession };
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
  | "workouts"
  | "sets"
  | "activeSession"
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
  "workouts",
  "sets",
  "activeSession",
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
  return openDB<BelaySchema>(accountDbName(userId), 3, {
    // Each step adds stores and keeps every value and the queue of the earlier versions. A tab
    // still on an earlier version closes its connection when asked (`blocking` below, since M2a),
    // so the upgrade never waits on it.
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
      // ponytail: sets are read whole (a few thousand a year) and filtered by the shared rules;
      // add an [exerciseId, doneAt] index if the history ever grows slow to read.
      if (oldVersion < 3) {
        upgradeDb.createObjectStore("workouts", { keyPath: "id" });
        const sets = upgradeDb.createObjectStore("sets", { keyPath: "id" });
        sets.createIndex("workoutId", "workoutId");
        upgradeDb.createObjectStore("activeSession");
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
    case "workout": {
      const row = await tx.objectStore("workouts").get(change.id);
      switch (change.field) {
        case "start":
          return row ? change.at : null; // written once: a start never overwrites a session
        case "ended":
          return row?.endedAtAt ?? null;
        case "note":
          return row?.noteAt ?? null;
        case "exerciseNotes":
          return row?.exerciseNotesAt ?? null;
        case "removed":
          return row?.removedAt ?? null;
      }
      return null;
    }
    case "set": {
      const row = await tx.objectStore("sets").get(change.id);
      if (change.field === "create") return row ? change.at : null; // written once
      return (change.field === "values" ? row?.fieldsAt : row?.removedAt) ?? null;
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
    case "workout": {
      const store = tx.objectStore("workouts");
      const row = await store.get(change.id);
      if (change.field === "start") {
        if (!row)
          await store.put({
            id: change.id,
            sessionCode: change.sessionCode,
            plan: change.plan,
            startedAt: change.startedAt,
            endedAt: null,
            endedAtAt: null,
            note: null,
            noteAt: null,
            exerciseNotes: {},
            exerciseNotesAt: null,
            removed: false,
            removedAt: null,
          });
        return;
      }
      if (!row) return;
      await store.put(
        change.field === "ended"
          ? { ...row, endedAt: change.value, endedAtAt: change.at }
          : change.field === "note"
            ? { ...row, note: change.value, noteAt: change.at }
            : change.field === "exerciseNotes"
              ? { ...row, exerciseNotes: change.value, exerciseNotesAt: change.at }
              : { ...row, removed: change.value, removedAt: change.at },
      );
      return;
    }
    case "set":
      return applySet(tx, change);
  }
}

async function applySet(tx: WriteTx, change: SetChange): Promise<void> {
  const store = tx.objectStore("sets");
  const row = await store.get(change.id);
  if (change.field === "create") {
    if (!row)
      await store.put({
        id: change.id,
        workoutId: change.workoutId,
        slotIndex: change.slotIndex,
        position: change.position,
        exerciseId: change.exerciseId,
        warmup: change.warmup,
        weightKg: change.weightKg,
        reps: change.reps,
        rir: change.rir,
        doneAt: change.doneAt,
        fieldsAt: change.at,
        removed: false,
        removedAt: null,
      });
    return;
  }
  if (!row) return;
  await store.put(
    change.field === "values"
      ? {
          ...row,
          weightKg: change.weightKg,
          reps: change.reps,
          rir: change.rir,
          fieldsAt: change.at,
        }
      : { ...row, removed: change.value, removedAt: change.at },
  );
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
    case "workout": {
      // A refused start takes its session away; a refused field goes back to unwritten, and the
      // server sends what it holds, if anything.
      if (change.field === "start") return tx.objectStore("workouts").delete(change.id);
      const row = (await tx.objectStore("workouts").get(change.id))!;
      await tx
        .objectStore("workouts")
        .put(
          change.field === "ended"
            ? { ...row, endedAt: null, endedAtAt: null }
            : change.field === "note"
              ? { ...row, note: null, noteAt: null }
              : change.field === "exerciseNotes"
                ? { ...row, exerciseNotes: {}, exerciseNotesAt: null }
                : { ...row, removed: false, removedAt: null },
        );
      return;
    }
    case "set": {
      if (change.field === "create") return tx.objectStore("sets").delete(change.id);
      const row = (await tx.objectStore("sets").get(change.id))!;
      // A refused correction is replaced by the stored set, which the server sends back.
      if (change.field === "removed")
        await tx.objectStore("sets").put({ ...row, removed: false, removedAt: null });
      return;
    }
  }
}

// The values and their changes in one transaction: what the screen shows is always queued. A
// change outside the contract never enters the queue: the server would refuse it.
// ponytail: no compaction, a weigh-in rewritten three times is three changes, all idempotent.
// Upgrade: fold the changes of one key before sending, if a queue grows past a few hundred.
// `active` (a session open on this device, or null for none) is written in the same transaction.
export async function recordChanges(
  db: AccountDb,
  changes: readonly Change[],
  { active }: { active?: ActiveSession | null } = {},
): Promise<void> {
  if (!changes.every(isValidChange)) throw new RangeError("invalid change");
  await write(db, async (tx) => {
    for (const change of changes) {
      await applyLocal(tx, change);
      await tx.objectStore("outbox").add({ change });
    }
    if (active === null) await tx.objectStore("activeSession").delete("current");
    else if (active) await tx.objectStore("activeSession").put(active, "current");
  });
}

// One readwrite transaction over every store: all of it is written, or none of it.
async function write(db: AccountDb, body: (tx: WriteTx) => Promise<void>): Promise<void> {
  const tx: WriteTx = db.transaction(ALL, "readwrite");
  const done = tx.done;
  done.catch(() => {}); // the failure below is the one error that propagates
  try {
    await body(tx);
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

// A set as ✓ records it: the set, its change in the queue and the open session, in one
// transaction, so a closed app never loses a validated set. A set already at that place of the
// session (another tab validated it) is corrected instead of doubled.
export type SetInput = Omit<Extract<SetChange, { field: "create" }>, "kind" | "field" | "at">;
export async function recordSet(
  db: AccountDb,
  input: SetInput,
  at: string,
  active: ActiveSession,
): Promise<SetChange> {
  let recorded: SetChange | undefined;
  await write(db, async (tx) => {
    const there = (await tx.objectStore("sets").index("workoutId").getAll(input.workoutId)).find(
      (s) => !s.removed && s.slotIndex === input.slotIndex && s.position === input.position,
    );
    const change: SetChange = there
      ? {
          kind: "set",
          id: there.id,
          workoutId: input.workoutId,
          field: "values",
          weightKg: input.weightKg,
          reps: input.reps,
          rir: input.rir,
          at,
        }
      : { kind: "set", field: "create", ...input, at };
    if (!isValidChange(change)) throw new RangeError("invalid change");
    await applyLocal(tx, change);
    await tx.objectStore("outbox").add({ change });
    await tx.objectStore("activeSession").put(active, "current");
    recorded = change;
  });
  return recorded!;
}

// Starts a session, unless one is open already, here or on another device: then this device
// takes that one up and its id is returned (one open session per account, §9.2; a second tap,
// or React running an effect twice, never opens two).
export async function startWorkout(
  db: AccountDb,
  start: Extract<Change, { kind: "workout"; field: "start" }>,
): Promise<string> {
  let id = start.id;
  if (!isValidChange(start)) throw new RangeError("invalid change");
  await write(db, async (tx) => {
    const open = openWorkout(await tx.objectStore("workouts").getAll());
    if (open) {
      id = open.id;
      const active = await tx.objectStore("activeSession").get("current");
      if (active?.workoutId !== open.id)
        await tx
          .objectStore("activeSession")
          .put({ workoutId: open.id, slotIndex: 0, restEndsAt: null }, "current");
      return;
    }
    await applyLocal(tx, start);
    await tx.objectStore("outbox").add({ change: start });
    await tx
      .objectStore("activeSession")
      .put({ workoutId: start.id, slotIndex: 0, restEndsAt: null }, "current");
  });
  return id;
}

// D12, when the app opens: a session left open is ended at its last set, or removed when it has
// none; the device forgets it as its open session. Returns whether anything was written.
export async function closeForgotten(db: AccountDb, now: Date): Promise<boolean> {
  const open = (await db.getAll("workouts")).filter((w) => w.endedAt === null && !w.removed);
  const changes: Change[] = [];
  const at = now.toISOString();
  for (const w of open) {
    const sets = await db.getAllFromIndex("sets", "workoutId", w.id);
    const closing = autoClose(w, sets, now);
    if (closing.kind === "end")
      changes.push({ kind: "workout", id: w.id, field: "ended", value: closing.endedAt, at });
    if (closing.kind === "remove")
      changes.push({ kind: "workout", id: w.id, field: "removed", value: true, at });
  }
  if (changes.length === 0) return false;
  const active = await readActiveSession(db);
  const closed = active && changes.some((c) => "id" in c && c.id === active.workoutId);
  await recordChanges(db, changes, closed ? { active: null } : {});
  return true;
}

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

// Every session and set, removed ones included: the shared rules (liveSets) leave those out.
export async function readHistory(db: AccountDb): Promise<History> {
  const [workouts, sets] = await Promise.all([db.getAll("workouts"), db.getAll("sets")]);
  return { workouts, sets };
}

export async function readActiveSession(db: AccountDb): Promise<ActiveSession | null> {
  return (await db.get("activeSession", "current")) ?? null;
}

export async function readOutbox(db: AccountDb, limit?: number): Promise<OutboxEntry[]> {
  return (await db.getAll("outbox", null, limit)) as OutboxEntry[];
}

export async function readCursor(db: AccountDb): Promise<string> {
  return (await db.get("meta", "cursor")) ?? "0";
}

// The thing an entry is about, as a person counts entries: one weigh-in per day however many
// corrections, one box per supplement and day, one profile, one session.
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
    case "workout":
      return `workout|${change.id}`;
    case "set":
      return `workout|${change.workoutId}`; // a session is one entry, however many sets
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
    for (const row of response.workouts) queue(tx.objectStore("workouts").put(row));
    for (const row of response.sets) queue(tx.objectStore("sets").put(row));
    if (response.target) queue(tx.objectStore("profile").put(response.target, "target"));
    if (response.profile) queue(tx.objectStore("profile").put(response.profile, "body"));
    await Promise.all(ops);
    for (const { change } of await tx.objectStore("outbox").getAll())
      if (isNewer(change.at, await localAt(tx, change))) await applyLocal(tx, change);
    // The open session was finished or removed on another device: this one lets it go.
    const active = await tx.objectStore("activeSession").get("current");
    const session = active && (await tx.objectStore("workouts").get(active.workoutId));
    if (active && (!session || session.endedAt !== null || session.removed))
      await tx.objectStore("activeSession").delete("current");
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
