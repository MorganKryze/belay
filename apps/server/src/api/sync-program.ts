import { clampAt, mergeFields, mergeSlotChange, staleKeys } from "@belay/shared/sync/merge";
import type {
  ActiveProgramChange,
  ActiveProgramRow,
  ProgramChange,
  ProgramRow,
  ProgramSessionChange,
  ProgramSessionRow,
  ProgramSlotChange,
  ProgramSlotRow,
  Rejected,
} from "@belay/shared/sync/schema";
import {
  MAX_PROGRAMS,
  MAX_ROTATION,
  MAX_SESSIONS,
  type ProgramSlot,
  SEED,
  SEED_PROGRAM_ID,
} from "@belay/shared/training/stored-program";
import { MAX_SLOTS } from "@belay/shared/training/workout";
import { and, eq, inArray, sql } from "drizzle-orm";
import { activePrograms, programSessions, programSlots, programs } from "../db/schema";
import {
  type Ctx,
  createMissing,
  guarded,
  type Indexed,
  iso,
  nextSeq,
  planProblem,
  unknown,
} from "./sync";

// The programs of one account, written inside the sync's locked transaction: field by field, the
// last write winning (SY2); a creation written once; a change naming a program or a session the
// account lacks refused alone (SY5); creations and restorations past an abuse limit refused alone
// (PM11), counted on the live rows here, so two devices cannot pass one together.

const at = (value: string | null) => (value === null ? null : new Date(value));
const byIndex = (a: { index: number }, b: { index: number }) => a.index - b.index;
const refuse = (out: Ctx["out"], c: { index: number }, reason: Rejected["reason"]) =>
  out.rejected.push({ index: c.index, reason });

// The starting program for an account that has none (SD2), before any change of the sync applies.
// The pointer's insert is the test: it adds a row only for an account never given the program, and
// the program row goes in the same statement, its key checked once both exist. Every time stays
// null, so any edit, made before or after, wins over the seed's values.
export async function seedProgram({ tx, userId }: Ctx): Promise<void> {
  const inserted = await tx.execute(sql`
    with pointer as (
      insert into ${activePrograms} (user_id, program_id) values (${userId}, ${SEED_PROGRAM_ID})
      on conflict (user_id) do nothing
      returning user_id
    ), program as (
      insert into ${programs} (user_id, id, schedule)
      select user_id, ${SEED_PROGRAM_ID}, ${JSON.stringify(SEED.programs[0]!.schedule)}::jsonb
      from pointer
      on conflict do nothing
    )
    select user_id from pointer`);
  if (inserted.length === 0) return;
  await tx
    .insert(programSessions)
    .values(
      SEED.sessions.map((s) => ({
        userId,
        id: s.id,
        name: s.name,
        programId: s.programId,
        position: s.position,
      })),
    )
    .onConflictDoNothing();
  await tx
    .insert(programSlots)
    .values(SEED.slots.map((s) => ({ userId, id: s.id, ...slotColumns(newSlot(s, null)) })))
    .onConflictDoNothing();
}

// Programs: created once, then name, schedule and removal merge apart. The active program is never
// removed (ED2): removals wait until the batch's choice of active program is written, so a switch
// then a removal in one batch is taken, and a removal racing another device's choice is refused.
export async function writePrograms(
  ctx: Ctx,
  changes: Indexed<ProgramChange>[],
  choices: Indexed<ActiveProgramChange>[],
): Promise<void> {
  const { tx, userId, now, out } = ctx;
  const ids = [...new Set(changes.map((c) => c.id))];
  const read = () =>
    ids.length === 0
      ? Promise.resolve([])
      : tx
          .select({
            id: programs.id,
            name: programs.nameAt,
            schedule: programs.scheduleAt,
            removed: programs.removedAt,
            gone: programs.removed,
          })
          .from(programs)
          .where(and(eq(programs.userId, userId), inArray(programs.id, ids)));
  const live = async () =>
    (
      await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(programs)
        .where(and(eq(programs.userId, userId), eq(programs.removed, false)))
    )[0]!.n;
  const known = new Set((await read()).map((r) => r.id));
  const isCreation = (c: ProgramChange) => c.field === "create";
  let count = await live();
  const refused = vetCreations(ctx, changes, known, isCreation, () => {
    if (count >= MAX_PROGRAMS) return "refused";
    count++;
    return null;
  });
  const kept = await createMissing(
    ctx,
    changes.filter((c) => !refused.has(c.id)),
    known,
    isCreation,
    (sp, c) =>
      c.field !== "create"
        ? Promise.resolve([])
        : sp
            .insert(programs)
            .values({
              userId,
              id: c.id,
              name: c.name,
              nameAt: at(clampAt(c.at, now)),
              schedule: { mode: c.schedule.mode, days: [...c.schedule.days] },
              scheduleAt: at(clampAt(c.at, now)),
            })
            .onConflictDoNothing()
            .returning({ id: programs.id }),
  );
  for (const c of kept) if (c.field === "create" && known.has(c.id)) out.programs.add(c.id);
  const rows = await read();
  const stored = new Map(
    rows.flatMap((r) => [
      [`${r.id}|name`, iso(r.name)],
      [`${r.id}|schedule`, iso(r.schedule)],
      [`${r.id}|removed`, iso(r.removed)],
    ]),
  );
  const fields = kept.filter(
    (c): c is Indexed<Exclude<ProgramChange, { field: "create" }>> => c.field !== "create",
  );
  const key = (c: (typeof fields)[number]) => `${c.id}|${c.field}`;
  for (const k of staleKeys(stored, fields, key, now)) out.programs.add(k.split("|")[0]!);
  // A program put back counts as a new live one.
  const gone = new Set(rows.filter((r) => r.gone).map((r) => r.id));
  count = await live();
  const early: typeof fields = [];
  const removals: typeof fields = [];
  for (const c of mergeFields(stored, fields, key, now).sort(byIndex)) {
    if (c.field === "removed" && c.value) {
      removals.push(c);
      continue;
    }
    if (c.field === "removed" && gone.has(c.id)) {
      if (count >= MAX_PROGRAMS) {
        refuse(out, c, "refused");
        out.programs.add(c.id);
        continue;
      }
      count++;
    }
    early.push(c);
  }
  await updatePrograms(ctx, early);
  await writeActiveProgram(ctx, choices);
  const [pointer] = await tx
    .select({ programId: activePrograms.programId })
    .from(activePrograms)
    .where(eq(activePrograms.userId, userId));
  for (const c of removals)
    if (c.id === pointer?.programId) {
      refuse(out, c, "refused");
      out.programs.add(c.id);
    }
  await updatePrograms(
    ctx,
    removals.filter((c) => c.id !== pointer?.programId),
  );
}

async function updatePrograms(
  ctx: Ctx,
  changes: Indexed<Exclude<ProgramChange, { field: "create" }>>[],
) {
  const { userId, out } = ctx;
  await guarded(
    ctx,
    changes,
    async (sp, batch) => {
      for (const c of batch)
        await sp
          .update(programs)
          .set({
            ...(c.field === "name"
              ? { name: c.value, nameAt: at(c.at) }
              : c.field === "schedule"
                ? {
                    schedule: { mode: c.value.mode, days: [...c.value.days] },
                    scheduleAt: at(c.at),
                  }
                : { removed: c.value, removedAt: at(c.at) }),
            serverSeq: nextSeq,
            updatedAt: sql`now()`,
          })
          .where(and(eq(programs.userId, userId), eq(programs.id, c.id)));
    },
    (c) => out.programs.add(c.id),
  );
}

// The active program: one value, the last choice winning. A choice of a program the account lacks
// is unknown, of a removed one refused; either way the stored pointer goes back.
async function writeActiveProgram(
  ctx: Ctx,
  choices: Indexed<ActiveProgramChange>[],
): Promise<void> {
  const { tx, userId, now, out } = ctx;
  if (choices.length === 0) return;
  const targets = [...new Set(choices.map((c) => c.programId))];
  const removed = new Map(
    (
      await tx
        .select({ id: programs.id, removed: programs.removed })
        .from(programs)
        .where(and(eq(programs.userId, userId), inArray(programs.id, targets)))
    ).map((r) => [r.id, r.removed]),
  );
  const valid: typeof choices = [];
  for (const c of choices) {
    const gone = removed.get(c.programId);
    if (gone === undefined) unknown(out, [c]);
    else if (gone) refuse(out, c, "refused");
    else valid.push(c);
    if (gone !== false) out.active = true;
  }
  const [pointer] = await tx
    .select({ at: activePrograms.at })
    .from(activePrograms)
    .where(eq(activePrograms.userId, userId));
  const stored = new Map([["active", iso(pointer?.at ?? null)]]);
  if (staleKeys(stored, valid, () => "active", now).size > 0) out.active = true;
  await guarded(
    ctx,
    mergeFields(stored, valid, () => "active", now),
    (sp, [w]) =>
      sp
        .update(activePrograms)
        .set({
          programId: w!.programId,
          at: at(w!.at),
          serverSeq: nextSeq,
          updatedAt: sql`now()`,
        })
        .where(eq(activePrograms.userId, userId)),
    () => (out.active = true),
  );
}

// The first creation of each new id, in request order, vetted: why it is not taken, by id. Every
// change of such an id is refused for that reason, since the row it names will not exist.
function vetCreations<C extends { id: string; index: number }>(
  { out }: Ctx,
  changes: C[],
  known: Set<string>,
  isCreation: (c: C) => boolean,
  vet: (c: C) => Rejected["reason"] | null,
): Map<string, Rejected["reason"]> {
  const problems = new Map<string, Rejected["reason"] | null>();
  for (const c of changes)
    if (isCreation(c) && !known.has(c.id) && !problems.has(c.id)) problems.set(c.id, vet(c));
  const refused = new Map<string, Rejected["reason"]>();
  for (const [id, reason] of problems) if (reason) refused.set(id, reason);
  for (const c of changes) {
    const reason = refused.get(c.id);
    if (reason) refuse(out, c, reason);
  }
  return refused;
}

// Sessions: created once, then name, place and removal merge apart. The place (a program and a
// position, or the collection) is one field, so a move never lands half done (D2). A program
// named must be one of the account's; 200 live sessions per account, 26 per rotation (PM11).
export async function writeProgramSessions(
  ctx: Ctx,
  changes: Indexed<ProgramSessionChange>[],
): Promise<void> {
  const { tx, userId, now, out } = ctx;
  if (changes.length === 0) return;
  const ids = [...new Set(changes.map((c) => c.id))];
  const read = () =>
    tx
      .select({
        id: programSessions.id,
        programId: programSessions.programId,
        gone: programSessions.removed,
        name: programSessions.nameAt,
        place: programSessions.placeAt,
        removed: programSessions.removedAt,
      })
      .from(programSessions)
      .where(and(eq(programSessions.userId, userId), inArray(programSessions.id, ids)));
  const named = [
    ...new Set(
      changes.flatMap((c) =>
        (c.field === "create" || c.field === "place") && c.programId !== null ? [c.programId] : [],
      ),
    ),
  ];
  const owned = new Set(
    named.length === 0
      ? []
      : (
          await tx
            .select({ id: programs.id })
            .from(programs)
            .where(and(eq(programs.userId, userId), inArray(programs.id, named)))
        ).map((r) => r.id),
  );
  const isOwned = (programId: string | null) => programId === null || owned.has(programId);
  // The live sessions: in the account, and in each rotation.
  const perProgram = new Map<string | null, number>(
    (
      await tx
        .select({ programId: programSessions.programId, n: sql<number>`count(*)::int` })
        .from(programSessions)
        .where(and(eq(programSessions.userId, userId), eq(programSessions.removed, false)))
        .groupBy(programSessions.programId)
    ).map((r) => [r.programId, r.n]),
  );
  let total = [...perProgram.values()].reduce((a, b) => a + b, 0);
  const inRotation = (programId: string | null) =>
    programId === null ? 0 : (perProgram.get(programId) ?? 0);
  const fitsRotation = (programId: string | null) =>
    programId === null || inRotation(programId) < MAX_ROTATION;
  const shift = (programId: string | null, by: number) =>
    perProgram.set(programId, (perProgram.get(programId) ?? 0) + by);

  const known = new Set((await read()).map((r) => r.id));
  const isCreation = (c: ProgramSessionChange) => c.field === "create" && isOwned(c.programId);
  const refused = vetCreations(ctx, changes, known, isCreation, (c) => {
    if (c.field !== "create" || total >= MAX_SESSIONS || !fitsRotation(c.programId))
      return "refused";
    total++;
    shift(c.programId, 1);
    return null;
  });
  const kept = await createMissing(
    ctx,
    changes.filter((c) => !refused.has(c.id)),
    known,
    isCreation,
    (sp, c) =>
      c.field !== "create"
        ? Promise.resolve([])
        : sp
            .insert(programSessions)
            .values({
              userId,
              id: c.id,
              name: c.name,
              nameAt: at(clampAt(c.at, now)),
              programId: c.programId,
              position: c.position,
              placeAt: at(clampAt(c.at, now)),
            })
            .onConflictDoNothing()
            .returning({ id: programSessions.id }),
  );
  for (const c of kept) if (c.field === "create" && known.has(c.id)) out.sessions.add(c.id);
  // A place in a program the account lacks: that change alone.
  const strays = kept.filter((c) => c.field === "place" && !isOwned(c.programId));
  unknown(out, strays);
  // The phone blanked its place for the stored one: send it back.
  for (const c of strays) out.sessions.add(c.id);
  const rows = await read();
  const state = new Map(rows.map((r) => [r.id, { programId: r.programId, removed: r.gone }]));
  const stored = new Map(
    rows.flatMap((r) => [
      [`${r.id}|name`, iso(r.name)],
      [`${r.id}|place`, iso(r.place)],
      [`${r.id}|removed`, iso(r.removed)],
    ]),
  );
  const fields = kept.filter(
    (c): c is Indexed<Exclude<ProgramSessionChange, { field: "create" }>> =>
      c.field !== "create" && !strays.includes(c),
  );
  const key = (c: (typeof fields)[number]) => `${c.id}|${c.field}`;
  for (const k of staleKeys(stored, fields, key, now)) out.sessions.add(k.split("|")[0]!);
  // Moves into a rotation and sessions put back count against the limits, in request order.
  const taken: typeof fields = [];
  for (const c of mergeFields(stored, fields, key, now).sort(byIndex)) {
    const s = state.get(c.id)!;
    if (c.field === "place" && !s.removed && c.programId !== s.programId) {
      if (!fitsRotation(c.programId)) {
        refuse(out, c, "refused");
        out.sessions.add(c.id);
        continue;
      }
      shift(s.programId, -1);
      shift(c.programId, 1);
    }
    if (c.field === "removed" && c.value !== s.removed) {
      if (!c.value && (total >= MAX_SESSIONS || !fitsRotation(s.programId))) {
        refuse(out, c, "refused");
        out.sessions.add(c.id);
        continue;
      }
      total += c.value ? -1 : 1;
      shift(s.programId, c.value ? -1 : 1);
      s.removed = c.value;
    }
    if (c.field === "place") s.programId = c.programId;
    taken.push(c);
  }
  await guarded(
    ctx,
    taken,
    async (sp, batch) => {
      for (const c of batch)
        await sp
          .update(programSessions)
          .set({
            ...(c.field === "name"
              ? { name: c.value, nameAt: at(c.at) }
              : c.field === "place"
                ? { programId: c.programId, position: c.position, placeAt: at(c.at) }
                : { removed: c.value, removedAt: at(c.at) }),
            serverSeq: nextSeq,
            updatedAt: sql`now()`,
          })
          .where(and(eq(programSessions.userId, userId), eq(programSessions.id, c.id)));
    },
    (c) => out.sessions.add(c.id),
  );
}

// A slot as stored, every value written at `writtenAt` (null: the seed's, never written).
function newSlot(
  s: Omit<ProgramSlot, "removed" | "measure"> & { measure?: "seconds" },
  writtenAt: string | null,
): ProgramSlotRow {
  return {
    id: s.id,
    sessionId: s.sessionId,
    position: s.position,
    positionAt: writtenAt,
    exerciseId: s.exerciseId,
    measure: s.measure ?? null,
    exerciseAt: writtenAt,
    repRange: [s.repRange[0], s.repRange[1]],
    repsAt: writtenAt,
    sets: s.sets,
    setsAt: writtenAt,
    rirTarget: [s.rirTarget[0], s.rirTarget[1]],
    rirAt: writtenAt,
    restSec: s.restSec,
    restAt: writtenAt,
    warmupSets: s.warmupSets,
    warmupsAt: writtenAt,
    isMain: s.isMain,
    mainAt: writtenAt,
    groupKey: s.groupKey,
    groupAt: writtenAt,
    rule: s.rule,
    ruleAt: writtenAt,
    removed: false,
    removedAt: null,
  };
}

// A slot's columns but its keys, which never change.
function slotColumns(r: ProgramSlotRow) {
  return {
    sessionId: r.sessionId,
    position: r.position,
    positionAt: at(r.positionAt),
    exerciseId: r.exerciseId,
    measure: r.measure,
    exerciseAt: at(r.exerciseAt),
    repMin: r.repRange[0],
    repMax: r.repRange[1],
    repsAt: at(r.repsAt),
    sets: r.sets,
    setsAt: at(r.setsAt),
    rirMin: r.rirTarget[0],
    rirMax: r.rirTarget[1],
    rirAt: at(r.rirAt),
    restSec: r.restSec,
    restAt: at(r.restAt),
    warmupSets: r.warmupSets,
    warmupsAt: at(r.warmupsAt),
    isMain: r.isMain,
    mainAt: at(r.mainAt),
    groupKey: r.groupKey,
    groupAt: at(r.groupAt),
    rule: r.rule,
    ruleAt: at(r.ruleAt),
    removed: r.removed,
    removedAt: at(r.removedAt),
  };
}

const TIMES = [
  "positionAt",
  "exerciseAt",
  "repsAt",
  "setsAt",
  "rirAt",
  "restAt",
  "warmupsAt",
  "mainAt",
  "groupAt",
  "ruleAt",
  "removedAt",
] as const;
type SlotEdit = Indexed<Exclude<ProgramSlotChange, { field: "create" }>>;
const timeOf = (c: SlotEdit) => `${c.field}At` as const;

// Slots: created once in a session of the account, of an exercise of the library in its measure, a
// timed one with no warm-up, 30 live ones per session (PM11). Each slot's changes then merge over
// its stored row with mergeSlotChange, as the phone merges them, and the row is written once.
export async function writeProgramSlots(
  ctx: Ctx,
  changes: Indexed<ProgramSlotChange>[],
): Promise<void> {
  const { tx, userId, now, out } = ctx;
  if (changes.length === 0) return;
  const ids = [...new Set(changes.map((c) => c.id))];
  const read = () =>
    tx
      .select()
      .from(programSlots)
      .where(and(eq(programSlots.userId, userId), inArray(programSlots.id, ids)));
  const known = new Set((await read()).map((r) => r.id));
  const named = [...new Set(changes.flatMap((c) => (c.field === "create" ? [c.sessionId] : [])))];
  const sessions = new Set(
    named.length === 0
      ? []
      : (
          await tx
            .select({ id: programSessions.id })
            .from(programSessions)
            .where(and(eq(programSessions.userId, userId), inArray(programSessions.id, named)))
        ).map((r) => r.id),
  );
  const perSession = new Map(
    (
      await tx
        .select({ sessionId: programSlots.sessionId, n: sql<number>`count(*)::int` })
        .from(programSlots)
        .where(and(eq(programSlots.userId, userId), eq(programSlots.removed, false)))
        .groupBy(programSlots.sessionId)
    ).map((r) => [r.sessionId, r.n]),
  );
  const inSession = (id: string) => perSession.get(id) ?? 0;
  const isCreation = (c: ProgramSlotChange) => c.field === "create" && sessions.has(c.sessionId);
  const problems = vetCreations(ctx, changes, known, isCreation, (c) => {
    if (c.field !== "create") return "refused";
    const problem =
      planProblem([c]) ??
      ((c.measure === "seconds" && c.warmupSets > 0) || inSession(c.sessionId) >= MAX_SLOTS
        ? "refused"
        : null);
    if (!problem) perSession.set(c.sessionId, inSession(c.sessionId) + 1);
    return problem;
  });
  const kept = await createMissing(
    ctx,
    changes.filter((c) => !problems.has(c.id)),
    known,
    isCreation,
    (sp, c) =>
      c.field !== "create"
        ? Promise.resolve([])
        : sp
            .insert(programSlots)
            .values({ userId, id: c.id, ...slotColumns(newSlot(c, clampAt(c.at, now))) })
            .onConflictDoNothing()
            .returning({ id: programSlots.id }),
  );
  for (const c of kept) if (c.field === "create" && known.has(c.id)) out.slots.add(c.id);
  const rows = new Map((await read()).map((r) => [r.id, slotRow(r)]));

  // Another exercise must be one of the library, in its measure (decision 16).
  const edits: SlotEdit[] = [];
  for (const c of kept) {
    if (c.field === "create") continue;
    const problem = c.field === "exercise" ? planProblem([c]) : null;
    if (problem) {
      refuse(out, c, problem);
      out.slots.add(c.id);
    } else edits.push(c);
  }
  const key = (c: SlotEdit) => `${c.id}|${c.field}`;
  const stored = new Map(edits.map((c) => [key(c), rows.get(c.id)![timeOf(c)]]));
  for (const k of staleKeys(stored, edits, key, now)) out.slots.add(k.split("|")[0]!);

  // A slot put back counts as a new live one; one taken out frees its place, in request order.
  const blocked = new Set<string>();
  for (const c of mergeFields(
    stored,
    edits.filter((c) => c.field === "removed"),
    key,
    now,
  ).sort(byIndex)) {
    const row = rows.get(c.id)!;
    if (c.field !== "removed" || c.value === row.removed) continue;
    if (!c.value && inSession(row.sessionId) >= MAX_SLOTS) {
      refuse(out, c, "refused");
      out.slots.add(c.id);
      blocked.add(c.id);
      continue;
    }
    perSession.set(row.sessionId, inSession(row.sessionId) + (c.value ? -1 : 1));
  }

  const updates: { index: number; id: string; row: ProgramSlotRow; won: SlotEdit[] }[] = [];
  for (const [id, initial] of rows) {
    let row = initial;
    const won: SlotEdit[] = [];
    // Inside one batch a later change wins a tie with an earlier one of the batch, as fold does:
    // two edits clamped to the same instant still arrive in the order they were made.
    const written = new Set<string>();
    for (const c of edits) {
      if (c.id !== id || (c.field === "removed" && blocked.has(id))) continue;
      const change = { ...c, at: clampAt(c.at, now) };
      const time = timeOf(c);
      const base: ProgramSlotRow =
        written.has(time) && row[time] === change.at ? { ...row, [time]: null } : row;
      const next = mergeSlotChange(base, change);
      if (next === null) {
        const measured = c.field === "reps" || c.field === "warmups";
        refuse(out, c, measured && c.measure !== row.measure ? "wrong_measure" : "refused");
        out.slots.add(id);
        continue;
      }
      if (next === base) continue;
      for (const t of TIMES) if (next[t] !== row[t]) written.add(t);
      row = next;
      won.push(c);
    }
    if (won.length > 0) updates.push({ index: won[0]!.index, id, row, won });
  }
  await guarded(
    ctx,
    updates,
    async (sp, batch) => {
      for (const u of batch)
        await sp
          .update(programSlots)
          .set({ ...slotColumns(u.row), serverSeq: nextSeq, updatedAt: sql`now()` })
          .where(and(eq(programSlots.userId, userId), eq(programSlots.id, u.id)));
    },
    (u) => {
      for (const c of u.won.slice(1)) refuse(out, c, "refused");
      out.slots.add(u.id);
    },
  );
}

// The rows as the phone receives them.
export const programRow = (r: typeof programs.$inferSelect): ProgramRow => ({
  id: r.id,
  name: r.name,
  nameAt: iso(r.nameAt),
  schedule: r.schedule,
  scheduleAt: iso(r.scheduleAt),
  removed: r.removed,
  removedAt: iso(r.removedAt),
});
export const pointerRow = (r: typeof activePrograms.$inferSelect): ActiveProgramRow => ({
  programId: r.programId,
  at: iso(r.at),
});
export const sessionRow = (r: typeof programSessions.$inferSelect): ProgramSessionRow => ({
  id: r.id,
  name: r.name,
  nameAt: iso(r.nameAt),
  programId: r.programId,
  position: r.position,
  placeAt: iso(r.placeAt),
  removed: r.removed,
  removedAt: iso(r.removedAt),
});
export const slotRow = (r: typeof programSlots.$inferSelect): ProgramSlotRow => ({
  id: r.id,
  sessionId: r.sessionId,
  position: r.position,
  positionAt: iso(r.positionAt),
  exerciseId: r.exerciseId,
  measure: r.measure === "seconds" ? "seconds" : null,
  exerciseAt: iso(r.exerciseAt),
  repRange: [r.repMin, r.repMax],
  repsAt: iso(r.repsAt),
  sets: r.sets,
  setsAt: iso(r.setsAt),
  rirTarget: [r.rirMin, r.rirMax],
  rirAt: iso(r.rirAt),
  restSec: r.restSec,
  restAt: iso(r.restAt),
  warmupSets: r.warmupSets,
  warmupsAt: iso(r.warmupsAt),
  isMain: r.isMain,
  mainAt: iso(r.mainAt),
  groupKey: r.groupKey,
  groupAt: iso(r.groupAt),
  rule: r.rule === "no_climbing" ? "no_climbing" : null,
  ruleAt: iso(r.ruleAt),
  removed: r.removed,
  removedAt: iso(r.removedAt),
});
