import { MAX_ROWS } from "@belay/shared/sync/limits";
import { mergeTarget, mergeWeights } from "@belay/shared/sync/merge";
import {
  type Change,
  type SyncRequest,
  type SyncResponse,
  type TargetChange,
  type WeightChange,
} from "@belay/shared/sync/schema";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { asUser, type Db, type Tx } from "../db/client";
import { bodyMetrics, users } from "../db/schema";

const isWeight = (c: Change): c is WeightChange => c.kind === "weight";
const isTarget = (c: Change): c is TargetChange => c.kind === "target";
const nextSeq = sql`nextval('belay_sync_seq')`;

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
    await writeWeights(tx, userId, request.changes.filter(isWeight), now);
    await writeTarget(tx, userId, request.changes.filter(isTarget), now);
    return readSince(tx, userId, BigInt(request.cursor));
  });
}

async function writeWeights(tx: Tx, userId: string, changes: WeightChange[], now: Date) {
  if (changes.length === 0) return;
  const dates = [...new Set(changes.map((c) => c.date))];
  const stored = await tx
    .select({ date: bodyMetrics.date, at: bodyMetrics.weightAt })
    .from(bodyMetrics)
    .where(and(eq(bodyMetrics.userId, userId), inArray(bodyMetrics.date, dates)));
  const winners = mergeWeights(
    new Map(stored.map((r) => [r.date, r.at?.toISOString() ?? null])),
    changes,
    now,
  );
  if (winners.length === 0) return;
  await tx
    .insert(bodyMetrics)
    .values(
      winners.map((c) => ({
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
    });
}

async function writeTarget(tx: Tx, userId: string, changes: TargetChange[], now: Date) {
  if (changes.length === 0) return;
  const [me] = await tx.select({ at: users.targetAt }).from(users).where(eq(users.id, userId));
  const winner = mergeTarget(me?.at?.toISOString() ?? null, changes, now);
  if (!winner) return;
  await tx
    .update(users)
    .set({
      targetMinPct: winner.minPct,
      targetMaxPct: winner.maxPct,
      targetAt: new Date(winner.at),
      serverSeq: nextSeq,
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, userId));
}

async function readSince(tx: Tx, userId: string, cursor: bigint): Promise<SyncResponse> {
  // One row more than a page tells whether another call is needed.
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
    me && me.seq > cursor
      ? { minPct: me.minPct, maxPct: me.maxPct, at: me.at?.toISOString() ?? null }
      : null;
  let next = page.at(-1)?.seq ?? cursor;
  // While pages remain, the cursor stops at the last row sent: the range comes again later.
  if (!hasMore && me && me.seq > next) next = me.seq;
  return {
    cursor: next.toString(),
    // Every row is written by a sync, with its time.
    weights: page.map((r) => ({ date: r.date, weightKg: r.weightKg, at: r.at!.toISOString() })),
    target,
    hasMore,
  };
}
