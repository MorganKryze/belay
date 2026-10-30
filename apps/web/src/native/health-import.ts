// Weigh-ins read from Apple Health (a connected scale, the Health app itself) fill the days Belay
// has no weigh-in for, then sync like typed ones. Run after a landed sync only: the phone then
// holds what the other devices wrote, so a weigh-in typed elsewhere is never overwritten.
import { toISODate } from "@belay/shared/body/dates";
import { isWeighingKg } from "@belay/shared/body/weighings";
import type { Change } from "@belay/shared/sync/schema";
import { isRecordable } from "@belay/shared/sync/valid";
import type { AccountDb } from "@/sync/db";
import type { SyncEngine } from "@/sync/engine";
import {
  health,
  type HealthImport,
  type HealthSample,
  type HealthSettings,
  HISTORY_SINCE,
  IMPORT_KEY,
  localDayStart,
  readHealth,
  SETTINGS_KEY,
} from "./health";

const DAY = 86_400_000;
const NOTHING_TAKEN = { written: 0, historyDone: false };

// Per local day from `fromDay` on, the earliest reading in Belay's range once rounded to 0.1 kg:
// a reading outside 20 to 400 kg is no weigh-in of the person's.
export function earliestPerDay(
  samples: readonly HealthSample[],
  fromDay: string,
): Map<string, HealthSample> {
  const days = new Map<string, HealthSample>();
  for (const s of samples) {
    const kg = Math.round(s.kg * 10) / 10;
    const date = toISODate(new Date(s.startedAt));
    if (!isWeighingKg(kg) || date < fromDay) continue;
    const kept = days.get(date);
    if (!kept || s.startedAt < kept.startedAt) days.set(date, { startedAt: s.startedAt, kg });
  }
  return days;
}

// Writes the readings' days and the new anchor in one transaction, with their changes queued as
// ordinary weigh-ins: a day with no record gets its reading; a day this import filled, untouched
// since, takes an earlier reading; anything the person did (a weigh-in typed here or elsewhere,
// an edit, a deletion) stays. `from` is where Health was read from: the anchor and the import's
// day stored when the read began. Returns how many weigh-ins were written and whether this read
// marked the history done: any read from the floor does, whatever it found.
// One read and one transaction hold the whole history, ~3 650 days for ten years of daily readings:
// a deliberate ceiling; the way past it is a paged read through the bridge.
export async function importWeighings(
  db: AccountDb,
  samples: readonly HealthSample[],
  anchor: string,
  now: Date,
  from: { anchor: string | null; since: number },
): Promise<{ written: number; historyDone: boolean }> {
  const today = toISODate(now);
  let written = 0;
  const tx = db.transaction(["weights", "outbox", "meta"], "readwrite");
  const settings = (await tx.objectStore("meta").get(SETTINGS_KEY)) as HealthSettings | undefined;
  // Turned off while Health was read: nothing is taken.
  if (!settings?.on || !settings.importOn || settings.importSince === null) {
    await tx.done;
    return NOTHING_TAKEN;
  }
  const imported = ((await tx.objectStore("meta").get(IMPORT_KEY)) as HealthImport | undefined) ?? {
    anchor: null,
    filled: {},
  };
  // Turned off and on again, or the history asked, while Health was read: the new place in Health
  // stands, and the next landed sync reads from it.
  if (imported.anchor !== from.anchor || settings.importSince !== from.since) {
    await tx.done;
    return NOTHING_TAKEN;
  }
  const filled = { ...imported.filled };
  let waits = false;
  for (const [date, reading] of earliestPerDay(
    samples,
    toISODate(new Date(settings.importSince)),
  )) {
    // Dropped like a value out of range: waiting for a day years ahead would have Health read
    // again whole at every sync until then.
    if (reading.startedAt > now.getTime() + DAY) continue;
    // A reading dated after today (a clock set ahead) waits for its day: Health is read again
    // from the old anchor until then.
    if (date > today) {
      waits = true;
      continue;
    }
    const row = await tx.objectStore("weights").get(date);
    const mine = filled[date];
    const replaces =
      row !== undefined &&
      row.weightKg !== null &&
      mine !== undefined &&
      mine.at === row.at &&
      reading.startedAt < mine.startedAt;
    if (row !== undefined && !replaces) continue;
    // Stamped at the start of its day, or just after the import's own stamp it replaces: a
    // weigh-in typed for that day, here or on a device still offline, is later and wins the merge.
    const at = new Date(
      replaces ? Date.parse(mine!.at) + 1 : localDayStart(reading.startedAt),
    ).toISOString();
    const change: Change = { kind: "weight", date, weightKg: reading.kg, at };
    if (!isRecordable(change, today)) continue;
    // The row a weigh-in change writes, as the phone's own write path does.
    await tx.objectStore("weights").put({ date, weightKg: reading.kg, at });
    await tx.objectStore("outbox").add({ change });
    filled[date] = { at, startedAt: reading.startedAt };
    written++;
  }
  // The place is kept even when nothing was new, so the next read does not go through the same
  // samples again; a read that moved nothing leaves the key alone.
  const historyDone = imported.historyDone || from.since === HISTORY_SINCE;
  const justDone = historyDone && !imported.historyDone;
  const next: HealthImport = { anchor: waits ? imported.anchor : anchor, filled, historyDone };
  if (written > 0 || justDone || next.anchor !== imported.anchor) {
    await tx.objectStore("meta").put(next, IMPORT_KEY);
  }
  await tx.done;
  return { written, historyDone: justDone };
}

// One import at a time; the account's sync sends what it wrote, with its usual debounce.
let running: Promise<void> = Promise.resolve();
export function importAfterSync(
  account: { db: AccountDb; engine: Pick<SyncEngine, "schedule"> },
  refresh: () => Promise<void>,
  now: () => Date = () => new Date(),
): Promise<void> {
  running = running
    .then(async () => {
      const { settings, imported } = await readHealth(account.db);
      if (!settings.on || !settings.importOn || settings.importSince === null) return;
      const { samples, anchor } = await health({
        op: "readWeighings",
        anchor: imported.anchor,
        since: settings.importSince,
      });
      const from = { anchor: imported.anchor, since: settings.importSince };
      const { written, historyDone } = await importWeighings(
        account.db,
        samples,
        anchor,
        now(),
        from,
      );
      // Queued first: what was written still goes if the screen fails to show it.
      if (written > 0) account.engine.schedule();
      // A history that found nothing new still moves the page's row to done.
      if (written > 0 || historyDone) await refresh();
    })
    .catch(() => {
      // Health unavailable (a locked phone) or the database closing: the next landed sync tries again.
    });
  return running;
}
