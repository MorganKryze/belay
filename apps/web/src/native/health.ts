// The iPhone app's link with Apple Health: the shapes its native side decodes, the Health state
// this phone keeps for the open account, and the progress the page shows while objects go to
// Health. Loaded on the phone only, with the page or the shell's native module.
import type { AccountDb } from "@/sync/db";
import { BelayNative } from "./plugin";

// Times are epoch milliseconds, dates YYYY-MM-DD, weights kilograms; a weigh-in's owner tags the
// account in its sync identifier (8 hex digits).
export type HealthAccess = "allowed" | "denied" | "undetermined";
export type HealthStatus = { available: boolean; workouts: HealthAccess; weighings: HealthAccess };
export type HealthObject =
  | { kind: "workout"; id: string; startedAt: number; endedAt: number; version: number }
  | { kind: "workoutRemoved"; id: string }
  | { kind: "weighing"; owner: string; date: string; kg: number; at: number; version: number }
  | { kind: "weighingRemoved"; owner: string; date: string };
export type HealthOutcome = "written" | "removed" | "overlap" | "denied" | "unavailable" | "failed";
export type HealthSample = { startedAt: number; kg: number };
export type HealthRequest =
  | { op: "status" }
  | { op: "authorize"; scope: "write" | "import" }
  | { op: "apply"; objects: HealthObject[] }
  | { op: "readWeighings"; anchor: string | null; since: number };

// The native side refuses a larger batch.
export const HEALTH_BATCH = 100;

// Write access per type; iOS never tells whether a read is allowed.
export function health(
  request: { op: "status" } | { op: "authorize"; scope: "write" | "import" },
): Promise<HealthStatus>;
export function health(request: {
  op: "apply";
  objects: HealthObject[];
}): Promise<{ outcomes: HealthOutcome[] }>;
export function health(request: {
  op: "readWeighings";
  anchor: string | null;
  since: number;
}): Promise<{ samples: HealthSample[]; anchor: string }>;
export function health(request: HealthRequest): Promise<unknown> {
  return BelayNative.health(request);
}

// Both switches, when the first one was last turned on, and where « Envoyer l’historique » stands:
// "no" until asked, "asked" while it runs (across launches), "sent" once nothing was left.
export type HealthSettings = {
  on: boolean;
  turnedOnAt: number | null;
  history: "no" | "asked" | "sent";
  importOn: boolean;
  importSince: number | null;
};
// What this phone knows Health holds, by sync identifier: a workout or a weigh-in at the values it
// wrote, a session skipped because another app's workout covers it, or an object it removed. The
// version is the last one written, so the next write is always greater.
export type Written =
  | { state: "workout"; version: number; startedAt: number; endedAt: number }
  | { state: "weighing"; version: number; kg: number }
  | { state: "skipped"; version: number; startedAt: number; endedAt: number }
  | { state: "removed"; version: number };
// The import's place in Health's body-mass history, and the days it filled: the `at` it wrote
// (an edit in Belay changes it) and the reading's time (an earlier one may replace it).
export type HealthImport = {
  anchor: string | null;
  filled: Record<string, { at: string; startedAt: number }>;
};
export type HealthState = {
  settings: HealthSettings;
  written: Record<string, Written>;
  imported: HealthImport;
};

export const HEALTH_OFF: HealthSettings = {
  on: false,
  turnedOnAt: null,
  history: "no",
  importOn: false,
  importSince: null,
};
const NOTHING_IMPORTED: HealthImport = { anchor: null, filled: {} };

// Three keys of the account's own database, so the state follows the account and the instance,
// and each writer (the page, the run, the import) rewrites only its own key in its transaction.
export const SETTINGS_KEY = "health.settings";
export const WRITTEN_KEY = "health.written";
export const IMPORT_KEY = "health.import";

export async function readHealth(db: AccountDb): Promise<HealthState> {
  const tx = db.transaction("meta");
  const [settings, written, imported] = await Promise.all([
    tx.store.get(SETTINGS_KEY),
    tx.store.get(WRITTEN_KEY),
    tx.store.get(IMPORT_KEY),
  ]);
  return {
    settings: (settings as HealthSettings | undefined) ?? HEALTH_OFF,
    written: (written as Record<string, Written> | undefined) ?? {},
    imported: (imported as HealthImport | undefined) ?? NOTHING_IMPORTED,
  };
}

// The settings as they become, read and written in one transaction so two writers never cross.
async function changeSettings(
  db: AccountDb,
  change: (s: HealthSettings) => HealthSettings,
): Promise<HealthSettings> {
  const tx = db.transaction("meta", "readwrite");
  const current = ((await tx.store.get(SETTINGS_KEY)) as HealthSettings | undefined) ?? HEALTH_OFF;
  const next = change(current);
  await tx.store.put(next, SETTINGS_KEY);
  // A new start for the import reads Health again from its own day, not from the last anchor; the
  // days it filled stay its own. An import already running keeps its place.
  if (next.importOn && !current.importOn) {
    const imported =
      ((await tx.store.get(IMPORT_KEY)) as HealthImport | undefined) ?? NOTHING_IMPORTED;
    await tx.store.put({ ...imported, anchor: null }, IMPORT_KEY);
  }
  await tx.done;
  return next;
}

// The local midnight of `now`'s day.
export function localDayStart(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

// On: new data from now on, the history offered again. Off: the import goes too, and the record
// of what was written stays, so a later turn-on still updates and removes those objects.
export const setHealthOn = (db: AccountDb, on: boolean, now: number) =>
  changeSettings(db, (s) => {
    if (!on) return { ...s, on: false, importOn: false };
    return s.on ? s : { ...s, on: true, turnedOnAt: now, history: "no" };
  });

// Only while the setting is on; each start reads from its own local day.
export const setImportOn = (db: AccountDb, on: boolean, now: number) =>
  changeSettings(db, (s) => {
    if (!on) return { ...s, importOn: false };
    if (!s.on || s.importOn) return s;
    return { ...s, importOn: true, importSince: localDayStart(now) };
  });

export const setHistory = (db: AccountDb, history: HealthSettings["history"]) =>
  changeSettings(db, (s) => (s.on ? { ...s, history } : s));

// The run's end: checked and written in one transaction, so a turn-off and on again in between
// never marks the new turn-on's history sent.
export const markHistorySent = (db: AccountDb, turnedOnAt: number | null) =>
  changeSettings(db, (s) =>
    s.on && s.history === "asked" && s.turnedOnAt === turnedOnAt ? { ...s, history: "sent" } : s,
  );

// Merges what Health confirmed into the record, in one transaction.
export async function recordWritten(
  db: AccountDb,
  entries: Readonly<Record<string, Written>>,
): Promise<void> {
  if (Object.keys(entries).length === 0) return;
  const tx = db.transaction("meta", "readwrite");
  const written = ((await tx.store.get(WRITTEN_KEY)) as Record<string, Written> | undefined) ?? {};
  await tx.store.put({ ...written, ...entries }, WRITTEN_KEY);
  await tx.done;
}

// The run's progress, for the page: the history's « n sur N » while it goes, and how many objects
// Health could not take on the last run. One account is open at a time, so one value.
export type HealthProgress = { sending: { done: number; total: number } | null; pending: number };
let progress: HealthProgress = { sending: null, pending: 0 };
const listeners = new Set<() => void>();
export const healthProgress = {
  get: (): HealthProgress => progress,
  set(next: HealthProgress): void {
    progress = next;
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

// The shell's runner for the open account, so the page asks for a run without starting a second
// one beside it. Nothing happens while no account is open.
let runner: (() => void) | null = null;
export const setHealthRunner = (run: (() => void) | null): void => {
  runner = run;
};
export const requestHealthRun = (): void => runner?.();
