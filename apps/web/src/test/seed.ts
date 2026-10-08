import type { Change } from "@belay/shared/sync/schema";
import { openAccountDb, recordChange } from "@/sync/db";

export const ADA = { id: "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d8e", displayName: "Ada" };

// Entries already on the device, as if typed earlier in the account's own database.
export async function seed(userId: string, changes: Change[]) {
  const db = await openAccountDb(userId);
  for (const change of changes) await recordChange(db, change);
  db.close();
}

export const weight = (
  date: string,
  weightKg: number | null,
  at = `${date}T06:30:00.000Z`,
): Change => ({ kind: "weight", date, weightKg, at });
