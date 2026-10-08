import { MAX_ROWS } from "@belay/shared/sync/limits";
import { mergeTarget, mergeWeights, staleKeys } from "@belay/shared/sync/merge";
import {
  type Change,
  type Rejected,
  type SyncRequest,
  type SyncResponse,
  type TargetChange,
  type WeightChange,
} from "@belay/shared/sync/schema";
import { and, asc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { asUser, type Db, type Tx } from "../db/client";
import { bodyMetrics, users } from "../db/schema";

// A change and its place in the request, which a refusal names.
type Indexed<C extends Change = Change> = C & { index: number };

const isWeight = (c: Indexed): c is Indexed<WeightChange> => c.kind === "weight";
const isTarget = (c: Indexed): c is Indexed<TargetChange> => c.kind === "target";
const nextSeq = sql`nextval('belay_sync_seq')`;

// What one sync owes the phone beyond the rows past its cursor: the changes it refused, and the
// stored rows it sends back because a change lost against them or was refused.
interface Outcome {
  rejected: Rejected[];
  weightDates: Set<string>;
  target: boolean;
}

// One sync, in one transaction as the person: write the changes that win, then read back what
// changed since the cursor. The explicit user filters come first, row-level security second.
export function runSync(
  db: Db,
  userId: string,
  request: SyncRequest,
  now = new Date(),
): Promise<SyncResponse> {
  return asUser(db, userId, async (tx) => {
    // Syncs of one person run one after the other: two transactions taking server_seq values
    // and committing in the other order would let a cursor skip a row.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
    const changes: Indexed[] = request.changes.map((c, index) => ({ ...c, index }));
    const out: Outcome = { rejected: [], weightDates: new Set(), target: false };
    await writeWeights(tx, userId, changes.filter(isWeight), now, out);
    await writeTarget(tx, userId, changes.filter(isTarget), now, out);
    return readSince(tx, userId, BigInt(request.cursor), out);
  });
}

// SQLSTATE classes the database answers when it refuses the data itself: 22 (a value it cannot
// take), 23 (a check or a key) and 42501 (a row-level policy). Anything else is a server error.
function isRefusal(error: unknown): boolean {
  const code = (error as { cause?: { code?: unknown } }).cause?.code;
  return typeof code === "string" && (/^2[23]/.test(code) || code === "42501");
}

// Writes the rows in one statement inside a savepoint. When the database refuses it, each row is
// written again alone, so only the refused ones are dropped: one bad change never blocks a queue.
// ponytail: a refused statement is retried row by row, one savepoint each (500 at most per
// request). Upgrade: bisect the rows if refusals ever come in long queues.
async function guarded<R extends { index: number }>(
  tx: Tx,
  rows: R[],
  write: (tx: Tx, rows: R[]) => Promise<unknown>,
  out: Outcome,
  onRefused: (row: R) => void = () => {},
): Promise<void> {
  if (rows.length === 0) return;
  try {
    await tx.transaction((sp) => write(sp, rows));
    return;
  } catch (error) {
    if (!isRefusal(error)) throw error;
  }
  for (const row of rows) {
    try {
      await tx.transaction((sp) => write(sp, [row]));
    } catch (error) {
      if (!isRefusal(error)) throw error;
      out.rejected.push({ index: row.index, reason: "refused" });
      onRefused(row);
    }
  }
}

async function writeWeights(
  tx: Tx,
  userId: string,
  changes: Indexed<WeightChange>[],
  now: Date,
  out: Outcome,
) {
  if (changes.length === 0) return;
  const dates = [...new Set(changes.map((c) => c.date))];
  const rows = await tx
    .select({ date: bodyMetrics.date, at: bodyMetrics.weightAt })
    .from(bodyMetrics)
    .where(and(eq(bodyMetrics.userId, userId), inArray(bodyMetrics.date, dates)));
  const stored = new Map(rows.map((r) => [r.date, r.at?.toISOString() ?? null]));
  for (const date of staleKeys(stored, changes, (c) => c.date, now)) out.weightDates.add(date);
  const winners = mergeWeights(stored, changes, now);
  await guarded(
    tx,
    winners,
    (sp, batch) =>
      sp
        .insert(bodyMetrics)
        .values(
          batch.map((c) => ({
            userId,
            date: c.date,
            weightKg: c.weightKg,
            weightAt: new Date(c.at),
          })),
        )
        .onConflictDoUpdate({
          target: [bodyMetrics.userId, bodyMetrics.date],
          set: {
            weightKg: sql`excluded.weight_kg`,
            weightAt: sql`excluded.weight_at`,
            serverSeq: nextSeq,
            updatedAt: sql`now()`,
          },
          // Same rule as mergeWeights, kept in SQL as a second barrier.
          setWhere: sql`${bodyMetrics.weightAt} is null or excluded.weight_at > ${bodyMetrics.weightAt}`,
        }),
    out,
    (c) => out.weightDates.add(c.date), // the phone gets the stored day back, if there is one
  );
}

async function writeTarget(
  tx: Tx,
  userId: string,
  changes: Indexed<TargetChange>[],
  now: Date,
  out: Outcome,
) {
  if (changes.length === 0) return;
  const [me] = await tx.select({ at: users.targetAt }).from(users).where(eq(users.id, userId));
  const stored = me?.at?.toISOString() ?? null;
  if (staleKeys(new Map([["target", stored]]), changes, () => "target", now).size > 0)
    out.target = true;
  const winner = mergeTarget(stored, changes, now);
  await guarded(
    tx,
    winner ? [winner] : [],
    (sp, [w]) =>
      sp
        .update(users)
        .set({
          targetMinPct: w!.minPct,
          targetMaxPct: w!.maxPct,
          targetAt: new Date(w!.at),
          serverSeq: nextSeq,
          updatedAt: sql`now()`,
        })
        .where(eq(users.id, userId)),
    out,
    () => (out.target = true),
  );
}

async function readSince(
  tx: Tx,
  userId: string,
  cursor: bigint,
  out: Outcome,
): Promise<SyncResponse> {
  const echo = [...out.weightDates];
  // One row more than a page tells whether another call is needed. A day that holds no weight
  // (never weighed, only other values) is not a weigh-in: it is never sent as one.
  const rows = await tx
    .select({
      date: bodyMetrics.date,
      weightKg: bodyMetrics.weightKg,
      at: bodyMetrics.weightAt,
      seq: bodyMetrics.serverSeq,
    })
    .from(bodyMetrics)
    .where(and(eq(bodyMetrics.userId, userId), gt(bodyMetrics.serverSeq, cursor)))
    .orderBy(asc(bodyMetrics.serverSeq))
    .limit(MAX_ROWS + 1);
  const hasMore = rows.length > MAX_ROWS;
  const page = rows.slice(0, MAX_ROWS);
  const sentBack =
    echo.length === 0
      ? []
      : await tx
          .select({
            date: bodyMetrics.date,
            weightKg: bodyMetrics.weightKg,
            at: bodyMetrics.weightAt,
          })
          .from(bodyMetrics)
          .where(
            and(
              eq(bodyMetrics.userId, userId),
              inArray(bodyMetrics.date, echo),
              isNotNull(bodyMetrics.weightAt),
            ),
          );
  const [me] = await tx
    .select({
      minPct: users.targetMinPct,
      maxPct: users.targetMaxPct,
      at: users.targetAt,
      seq: users.serverSeq,
    })
    .from(users)
    .where(eq(users.id, userId));
  const target =
    me && (me.seq > cursor || out.target)
      ? { minPct: me.minPct, maxPct: me.maxPct, at: me.at?.toISOString() ?? null }
      : null;
  let next = page.at(-1)?.seq ?? cursor;
  // While pages remain, the cursor stops at the last row sent: the range comes again later.
  if (!hasMore && me && me.seq > next) next = me.seq;
  const weights = new Map<string, { date: string; weightKg: number | null; at: string }>();
  for (const r of [...page, ...sentBack])
    if (r.at) weights.set(r.date, { date: r.date, weightKg: r.weightKg, at: r.at.toISOString() });
  return {
    cursor: next.toString(),
    weights: [...weights.values()],
    // The other tables arrive with their migration (0004) and their merge.
    measures: [],
    intake: [],
    supplements: [],
    supplementLogs: [],
    annotations: [],
    target,
    profile: null,
    rejected: out.rejected,
    hasMore,
  };
}
