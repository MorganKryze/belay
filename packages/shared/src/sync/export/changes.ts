import { isCreatineName } from "../../body/supplements";
import type {
  ActiveProgramRow,
  ActivityRow,
  AnnotationRow,
  Change,
  IntakeRow,
  MeasureRow,
  ProfileRow,
  ProgramRow,
  ProgramSessionRow,
  ProgramSlotRow,
  SetRow,
  StepsRow,
  SupplementLogRow,
  SupplementRow,
  TargetRow,
  WeightRow,
  WorkoutRow,
} from "../schema";

// Every record a device holds, in the sync contract's row shapes, tombstones included.
export type ExportRows = {
  weights: WeightRow[];
  measures: MeasureRow[];
  intake: IntakeRow[];
  supplements: SupplementRow[];
  supplementLogs: SupplementLogRow[];
  annotations: AnnotationRow[];
  steps: StepsRow[];
  activities: ActivityRow[];
  workouts: WorkoutRow[];
  sets: SetRow[];
  programs: ProgramRow[];
  programSessions: ProgramSessionRow[];
  programSlots: ProgramSlotRow[];
  activeProgram: ActiveProgramRow | null;
  target: TargetRow | null;
  profile: ProfileRow | null;
};

// The changes that rebuild these rows through the one merge: each written field with its own
// time, each creation once, parents before children. A program's, a program session's or a
// slot's creation carries no time of its own in a row: it takes `exportedAt`, never compared,
// since the merge writes a creation only where the row is absent. A session's start takes its
// start.
export function changesFromRows(rows: ExportRows, exportedAt: string): Change[] {
  const out: Change[] = [];
  const field = <T>(at: string | null, make: (at: string) => T) => {
    if (at !== null) out.push(make(at) as Change);
  };

  for (const r of rows.weights)
    out.push({ kind: "weight", date: r.date, weightKg: r.weightKg, at: r.at });
  for (const r of rows.measures) {
    field(r.waistAt, (at) => ({
      kind: "measure",
      date: r.date,
      field: "waist",
      value: r.waistCm,
      at,
    }));
    field(r.neckAt, (at) => ({
      kind: "measure",
      date: r.date,
      field: "neck",
      value: r.neckCm,
      at,
    }));
    field(r.hipAt, (at) => ({ kind: "measure", date: r.date, field: "hip", value: r.hipCm, at }));
  }
  for (const r of rows.intake) {
    field(r.kcalAt, (at) => ({ kind: "intake", date: r.date, field: "kcal", value: r.kcal, at }));
    field(r.proteinAt, (at) => ({
      kind: "intake",
      date: r.date,
      field: "protein",
      value: r.proteinG,
      at,
    }));
  }
  if (rows.target)
    field(rows.target.at, (at) => ({
      kind: "target",
      minPct: rows.target!.minPct,
      maxPct: rows.target!.maxPct,
      at,
    }));
  if (rows.profile) {
    const p = rows.profile;
    field(p.formulaAt, (at) => ({ kind: "profile", field: "formula", value: p.formula, at }));
    field(p.birthYearAt, (at) => ({ kind: "profile", field: "birthYear", value: p.birthYear, at }));
    field(p.heightAt, (at) => ({ kind: "profile", field: "height", value: p.heightCm, at }));
  }
  for (const r of rows.supplements) {
    // The kind travels only where the name would decide otherwise.
    const creatine = r.kind === "creatine";
    out.push({
      kind: "supplement",
      id: r.id,
      field: "name",
      value: r.name,
      ...(creatine !== isCreatineName(r.name) && { creatine }),
      at: r.nameAt,
    });
    field(r.removedAt, (at) => ({
      kind: "supplement",
      id: r.id,
      field: "removed",
      value: r.removed,
      at,
    }));
  }
  for (const r of rows.supplementLogs)
    out.push({
      kind: "supplementLog",
      supplementId: r.supplementId,
      date: r.date,
      taken: r.taken,
      at: r.at,
    });
  for (const r of rows.annotations) {
    out.push({
      kind: "annotation",
      id: r.id,
      field: "fields",
      date: r.date,
      type: r.type,
      label: r.label,
      at: r.fieldsAt,
    });
    field(r.removedAt, (at) => ({
      kind: "annotation",
      id: r.id,
      field: "removed",
      value: r.removed,
      at,
    }));
  }
  for (const r of rows.steps)
    field(r.stepsAt, (at) => ({ kind: "steps", date: r.date, value: r.steps, at }));
  for (const r of rows.activities) {
    out.push({
      kind: "activity",
      id: r.id,
      field: "fields",
      date: r.date,
      type: r.type,
      durationMin: r.durationMin,
      cardioType: r.cardioType,
      climbStyle: r.climbStyle,
      climbRuns: r.climbRuns,
      climbGrade: r.climbGrade,
      climbColor: r.climbColor,
      at: r.fieldsAt,
    });
    field(r.removedAt, (at) => ({
      kind: "activity",
      id: r.id,
      field: "removed",
      value: r.removed,
      at,
    }));
  }

  // Programs before their sessions, sessions before their slots and the sessions done.
  for (const r of rows.programs) {
    out.push({
      kind: "program",
      id: r.id,
      field: "create",
      name: r.name,
      schedule: r.schedule,
      at: exportedAt,
    });
    field(r.nameAt, (at) => ({ kind: "program", id: r.id, field: "name", value: r.name, at }));
    field(r.scheduleAt, (at) => ({
      kind: "program",
      id: r.id,
      field: "schedule",
      value: r.schedule,
      at,
    }));
    field(r.removedAt, (at) => ({
      kind: "program",
      id: r.id,
      field: "removed",
      value: r.removed,
      at,
    }));
  }
  if (rows.activeProgram)
    field(rows.activeProgram.at, (at) => ({
      kind: "activeProgram",
      programId: rows.activeProgram!.programId,
      at,
    }));
  for (const r of rows.programSessions) {
    out.push({
      kind: "programSession",
      id: r.id,
      field: "create",
      name: r.name,
      programId: r.programId,
      position: r.position,
      at: exportedAt,
    });
    field(r.nameAt, (at) => ({
      kind: "programSession",
      id: r.id,
      field: "name",
      value: r.name,
      at,
    }));
    field(r.placeAt, (at) => ({
      kind: "programSession",
      id: r.id,
      field: "place",
      programId: r.programId,
      position: r.position,
      at,
    }));
    field(r.removedAt, (at) => ({
      kind: "programSession",
      id: r.id,
      field: "removed",
      value: r.removed,
      at,
    }));
  }
  for (const r of rows.programSlots) {
    const measure = r.measure;
    out.push({
      kind: "programSlot",
      id: r.id,
      field: "create",
      sessionId: r.sessionId,
      position: r.position,
      rule: r.rule,
      exerciseId: r.exerciseId,
      ...(measure === "seconds" && { measure }),
      sets: r.sets,
      repRange: r.repRange,
      rirTarget: r.rirTarget,
      restSec: r.restSec,
      warmupSets: r.warmupSets as never,
      isMain: r.isMain,
      groupKey: r.groupKey,
      at: exportedAt,
    } as Change);
    const slot = (name: string, at: string | null, rest: object) =>
      field(at, (a) => ({ kind: "programSlot", id: r.id, field: name, ...rest, at: a }));
    slot("position", r.positionAt, { value: r.position });
    slot("exercise", r.exerciseAt, {
      exerciseId: r.exerciseId,
      measure,
      repRange: r.repRange,
      warmupSets: r.warmupSets,
    });
    slot("reps", r.repsAt, { value: r.repRange, measure });
    slot("sets", r.setsAt, { value: r.sets });
    slot("rir", r.rirAt, { value: r.rirTarget });
    slot("rest", r.restAt, { value: r.restSec });
    slot("warmups", r.warmupsAt, { value: r.warmupSets, measure });
    slot("main", r.mainAt, { value: r.isMain });
    slot("group", r.groupAt, { value: r.groupKey });
    slot("rule", r.ruleAt, { value: r.rule });
    slot("removed", r.removedAt, { value: r.removed });
  }

  for (const r of rows.workouts) {
    out.push({
      kind: "workout",
      id: r.id,
      field: "start",
      sessionCode: r.sessionCode,
      ...(r.sessionId !== undefined && { sessionId: r.sessionId }),
      ...(r.sessionName !== undefined && { sessionName: r.sessionName }),
      plan: r.plan,
      startedAt: r.startedAt,
      at: r.startedAt,
    });
    field(r.planAt, (at) => ({ kind: "workout", id: r.id, field: "plan", value: r.plan, at }));
    field(r.startedAtAt, (at) => ({
      kind: "workout",
      id: r.id,
      field: "startedAt",
      value: r.startedAt,
      at,
    }));
    field(r.endedAtAt, (at) => ({
      kind: "workout",
      id: r.id,
      field: "ended",
      value: r.endedAt,
      at,
    }));
    field(r.noteAt, (at) => ({ kind: "workout", id: r.id, field: "note", value: r.note, at }));
    field(r.exerciseNotesAt, (at) => ({
      kind: "workout",
      id: r.id,
      field: "exerciseNotes",
      value: r.exerciseNotes,
      at,
    }));
    field(r.removedAt, (at) => ({
      kind: "workout",
      id: r.id,
      field: "removed",
      value: r.removed,
      at,
    }));
  }
  for (const r of rows.sets) {
    out.push({
      kind: "set",
      id: r.id,
      workoutId: r.workoutId,
      field: "create",
      slotIndex: r.slotIndex,
      position: r.position,
      exerciseId: r.exerciseId,
      warmup: r.warmup,
      weightKg: r.weightKg,
      reps: r.reps,
      seconds: r.seconds,
      rir: r.rir,
      doneAt: r.doneAt,
      at: r.fieldsAt,
    });
    field(r.removedAt, (at) => ({
      kind: "set",
      id: r.id,
      workoutId: r.workoutId,
      field: "removed",
      value: r.removed,
      at,
    }));
  }
  return out;
}

// The key of a row in its kind: its id, or its day, or the supplement and its day.
const keyOf = (kind: string, row: Record<string, unknown>): string =>
  kind === "supplementLogs"
    ? `${row.supplementId as string}/${row.date as string}`
    : ((row.id ?? row.date ?? "") as string);
// A field's write time is no value of its own (a session's start and end, a set's time are).
const isTime = (field: string) =>
  field === "at" || (field.endsWith("At") && !["startedAt", "endedAt", "doneAt"].includes(field));

export type Overlap = { kind: keyof ExportRows; key: string; field: string };

// The values both sides hold with other contents: an import keeps the later of each.
export function overlapCount(
  here: ExportRows,
  incoming: ExportRows,
): { count: number; values: Overlap[] } {
  const values: Overlap[] = [];
  for (const kind of Object.keys(here) as (keyof ExportRows)[]) {
    const list = (rows: ExportRows) => {
      const v: unknown = rows[kind];
      return (Array.isArray(v) ? v : v ? [v] : []) as Record<string, unknown>[];
    };
    const ours = new Map(list(here).map((r) => [keyOf(kind, r), r]));
    for (const theirs of list(incoming)) {
      const key = keyOf(kind, theirs);
      const mine = ours.get(key);
      if (!mine) continue;
      for (const field of Object.keys(theirs))
        if (!isTime(field) && JSON.stringify(mine[field]) !== JSON.stringify(theirs[field]))
          values.push({ kind, key, field });
    }
  }
  return { count: values.length, values };
}

export type Counts = Record<
  | "sessions"
  | "sets"
  | "activities"
  | "weighIns"
  | "measures"
  | "intake"
  | "steps"
  | "supplements"
  | "programs",
  number
>;

// What a file holds, as a person counts it: tombstones left out.
export function countsOf(rows: ExportRows): Counts {
  const kept = (list: { removed: boolean }[]) => list.filter((r) => !r.removed).length;
  return {
    sessions: kept(rows.workouts),
    sets: kept(rows.sets),
    activities: kept(rows.activities),
    weighIns: rows.weights.filter((r) => r.weightKg !== null).length,
    measures: rows.measures.filter((r) => [r.waistCm, r.neckCm, r.hipCm].some((v) => v !== null))
      .length,
    intake: rows.intake.filter((r) => r.kcal !== null || r.proteinG !== null).length,
    steps: rows.steps.filter((r) => r.steps !== null).length,
    supplements: kept(rows.supplements),
    programs: kept(rows.programs),
  };
}
