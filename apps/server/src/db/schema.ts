import type { Slot } from "@belay/shared/training/workout";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSequence,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });
// A girth in centimetres, to the tenth; the number comes back as a JS number.
const cm = (name: string) => numeric(name, { precision: 4, scale: 1, mode: "number" });

// One sequence for every synced row: a sync returns the rows whose server_seq is above the
// cursor the phone sends. bigint as a JS bigint: the cursor travels as text.
export const syncSeq = pgSequence("belay_sync_seq");
const serverSeq = () =>
  bigint("server_seq", { mode: "bigint" })
    .notNull()
    .default(sql`nextval('belay_sync_seq')`);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    oidcIssuer: text("oidc_issuer").notNull(),
    oidcSub: text("oidc_sub").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
    // The weekly loss range, % of the average weight; both bounds share one timestamp.
    targetMinPct: numeric("target_min_pct", { precision: 3, scale: 2, mode: "number" })
      .notNull()
      .default(0.5),
    targetMaxPct: numeric("target_max_pct", { precision: 3, scale: 2, mode: "number" })
      .notNull()
      .default(1),
    targetAt: ts("target_at"),
    // The profile (D8): each fact optional, with its own timestamp; the age is never stored.
    formula: text("formula"),
    formulaAt: ts("formula_at"),
    birthYear: smallint("birth_year"),
    birthYearAt: ts("birth_year_at"),
    heightCm: smallint("height_cm"),
    heightAt: ts("height_at"),
    serverSeq: serverSeq(),
  },
  (t) => [
    unique("users_oidc_identity").on(t.oidcIssuer, t.oidcSub),
    check(
      "users_target_range",
      sql`${t.targetMinPct} >= 0.25 AND ${t.targetMaxPct} <= 1.0 AND ${t.targetMinPct} <= ${t.targetMaxPct} - 0.1`,
    ),
    check("users_formula", sql`${t.formula} IS NULL OR ${t.formula} IN ('female', 'male')`),
    // The exact range moves with the calendar (ages 15 to 100): the API checks it.
    check("users_birth_year", sql`${t.birthYear} IS NULL OR ${t.birthYear} >= 1900`),
    check("users_height", sql`${t.heightCm} IS NULL OR ${t.heightCm} BETWEEN 120 AND 230`),
  ],
);

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
});

// One row per person and day: two devices weighing the same day write the same row. A null
// weight with a fresh weight_at is a deletion that the other devices learn from.
export const bodyMetrics = pgTable(
  "body_metrics",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    weightKg: numeric("weight_kg", { precision: 4, scale: 1, mode: "number" }),
    weightAt: ts("weight_at"),
    // Each measurement with its own timestamp, like the weight: the day's row holds them all.
    waistCm: cm("waist_cm"),
    waistAt: ts("waist_at"),
    neckCm: cm("neck_cm"),
    neckAt: ts("neck_at"),
    hipCm: cm("hip_cm"),
    hipAt: ts("hip_at"),
    serverSeq: serverSeq(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.date] }),
    index("body_metrics_user_seq").on(t.userId, t.serverSeq),
    check(
      "body_metrics_weight_range",
      sql`${t.weightKg} IS NULL OR ${t.weightKg} BETWEEN 20 AND 400`,
    ),
    check(
      "body_metrics_measures_range",
      sql`(${t.waistCm} IS NULL OR ${t.waistCm} BETWEEN 40 AND 200) AND (${t.neckCm} IS NULL OR ${t.neckCm} BETWEEN 20 AND 80) AND (${t.hipCm} IS NULL OR ${t.hipCm} BETWEEN 50 AND 200)`,
    ),
  ],
);

// A day's intake: one total per day, each value with its own timestamp (null: deleted).
export const intakeLogs = pgTable(
  "intake_logs",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    kcal: integer("kcal"),
    kcalAt: ts("kcal_at"),
    proteinG: integer("protein_g"),
    proteinAt: ts("protein_at"),
    serverSeq: serverSeq(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.date] }),
    index("intake_logs_user_seq").on(t.userId, t.serverSeq),
    check(
      "intake_logs_range",
      sql`(${t.kcal} IS NULL OR ${t.kcal} BETWEEN 0 AND 10000) AND (${t.proteinG} IS NULL OR ${t.proteinG} BETWEEN 0 AND 500)`,
    ),
  ],
);

// The person's list of supplements, by an id the phone gives (UUID v7). Removing one keeps it,
// so its ticked days stay (creatine courses are drawn from them).
export const supplements = pgTable(
  "supplements",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameAt: ts("name_at").notNull(),
    // Set by the server from the name it first receives, never taken from the phone.
    kind: text("kind").notNull(),
    removed: boolean("removed").notNull().default(false),
    removedAt: ts("removed_at"),
    serverSeq: serverSeq(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // The target of supplement_logs' key: a tick names a supplement of the same person.
    unique("supplements_id_user").on(t.id, t.userId),
    index("supplements_user_seq").on(t.userId, t.serverSeq),
    check("supplements_kind", sql`${t.kind} IN ('creatine', 'other')`),
    check("supplements_name", sql`char_length(${t.name}) BETWEEN 1 AND 40`),
  ],
);

// One box per supplement and day: taken, or unticked (false), with its timestamp.
export const supplementLogs = pgTable(
  "supplement_logs",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    supplementId: uuid("supplement_id").notNull(),
    date: date("date").notNull(),
    taken: boolean("taken").notNull(),
    takenAt: ts("taken_at").notNull(),
    serverSeq: serverSeq(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.supplementId, t.date] }),
    // Never someone else's supplement: the key holds the person too.
    foreignKey({
      name: "supplement_logs_supplement_fk",
      columns: [t.supplementId, t.userId],
      foreignColumns: [supplements.id, supplements.userId],
    }).onDelete("cascade"),
    index("supplement_logs_user_seq").on(t.userId, t.serverSeq),
  ],
);

// A mark on the chart: its day, type and text are one block under fields_at; removing it is a
// separate field, so a late edit elsewhere never brings it back.
export const annotations = pgTable(
  "annotations",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    kind: text("kind").notNull(),
    label: text("label"),
    fieldsAt: ts("fields_at").notNull(),
    removed: boolean("removed").notNull().default(false),
    removedAt: ts("removed_at"),
    serverSeq: serverSeq(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("annotations_user_seq").on(t.userId, t.serverSeq),
    check("annotations_kind", sql`${t.kind} IN ('deload', 'diet_break', 'note')`),
    check("annotations_label", sql`${t.label} IS NULL OR char_length(${t.label}) <= 80`),
  ],
);

// The day's steps, typed by hand: one row per person and day, the value with its own timestamp
// (null: deleted).
export const dailySteps = pgTable(
  "daily_steps",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    steps: integer("steps"),
    stepsAt: ts("steps_at"),
    serverSeq: serverSeq(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.date] }),
    index("daily_steps_user_seq").on(t.userId, t.serverSeq),
    check("daily_steps_range", sql`${t.steps} IS NULL OR ${t.steps} BETWEEN 0 AND 100000`),
  ],
);

// A cardio session or a climb: its day, kind and fields are one block under fields_at, its
// removal a separate field, as an annotation.
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    kind: text("kind").notNull(),
    durationMin: smallint("duration_min").notNull(),
    cardioType: text("cardio_type"),
    climbStyle: text("climb_style"),
    climbRuns: smallint("climb_runs"),
    climbGrade: text("climb_grade"),
    climbColor: text("climb_color"),
    fieldsAt: ts("fields_at").notNull(),
    removed: boolean("removed").notNull().default(false),
    removedAt: ts("removed_at"),
    serverSeq: serverSeq(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("activities_user_seq").on(t.userId, t.serverSeq),
    check("activities_kind", sql`${t.kind} IN ('cardio', 'climbing')`),
    check(
      "activities_duration",
      sql`${t.durationMin} BETWEEN 5 AND 480 AND ${t.durationMin} % 5 = 0`,
    ),
    check(
      "activities_cardio_type",
      sql`${t.cardioType} IS NULL OR ${t.cardioType} IN ('run', 'bike', 'row', 'walk', 'swim', 'other')`,
    ),
    check(
      "activities_climb_style",
      sql`${t.climbStyle} IS NULL OR ${t.climbStyle} IN ('boulder', 'route')`,
    ),
    check("activities_climb_runs", sql`${t.climbRuns} IS NULL OR ${t.climbRuns} BETWEEN 0 AND 200`),
    // 5a to 8c+; the API checks the exact list (the same pattern also takes nothing else).
    check(
      "activities_climb_grade",
      sql`${t.climbGrade} IS NULL OR ${t.climbGrade} ~ '^[5-8][abc]\\+?$'`,
    ),
    check(
      "activities_climb_color",
      sql`${t.climbColor} IS NULL OR ${t.climbColor} IN ('yellow', 'green', 'blue', 'red', 'black', 'purple', 'white')`,
    ),
    check("activities_cardio_only", sql`${t.kind} = 'cardio' OR ${t.cardioType} IS NULL`),
    check(
      "activities_climbing_only",
      sql`${t.kind} = 'climbing' OR (${t.climbStyle} IS NULL AND ${t.climbRuns} IS NULL AND ${t.climbGrade} IS NULL AND ${t.climbColor} IS NULL)`,
    ),
    check("activities_grade_or_color", sql`${t.climbGrade} IS NULL OR ${t.climbColor} IS NULL`),
  ],
);

// A session as it was done: its code, first plan and start are written with its start; its own
// copy of the plan and its start time change afterwards (plan_at, started_at_at: null until
// then), and its end, note, exercise notes and removal each carry their own timestamp. Removed,
// never deleted: its sets stay, and no screen shows or counts them.
export const workouts = pgTable(
  "workouts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionCode: text("session_code").notNull(),
    // The program session it was started from, written once with the start; null for a start
    // without it (before programs were stored, or from an older phone). No key: a start is never
    // refused for it, and it is only read within the same account.
    sessionId: uuid("session_id"),
    // That session's name on the day, written once with the start so history never follows a
    // rename. A start that kept it sets session_name_kept, its name null when the session had
    // none; a start that did not (before names were kept, or from an older phone) leaves both
    // unset and shows the session's current name.
    sessionName: text("session_name"),
    sessionNameKept: boolean("session_name_kept").notNull().default(false),
    plan: jsonb("plan").$type<Slot[]>().notNull(),
    planAt: ts("plan_at"),
    startedAt: ts("started_at").notNull(),
    startedAtAt: ts("started_at_at"),
    endedAt: ts("ended_at"),
    endedAtAt: ts("ended_at_at"),
    note: text("note"),
    noteAt: ts("note_at"),
    exerciseNotes: jsonb("exercise_notes").$type<Record<string, string>>(),
    exerciseNotesAt: ts("exercise_notes_at"),
    removed: boolean("removed").notNull().default(false),
    removedAt: ts("removed_at"),
    serverSeq: serverSeq(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // The target of workout_sets' key: a set belongs to a session of the same person.
    unique("workouts_id_user").on(t.id, t.userId),
    index("workouts_user_seq").on(t.userId, t.serverSeq),
    check("workouts_session_code", sql`${t.sessionCode} ~ '^[A-Z]$'`),
    check(
      "workouts_session_name",
      sql`${t.sessionName} IS NULL OR (${t.sessionNameKept} AND char_length(${t.sessionName}) BETWEEN 1 AND 40)`,
    ),
    check("workouts_plan_size", sql`octet_length(${t.plan}::text) <= 16384`),
    check("workouts_note", sql`${t.note} IS NULL OR char_length(${t.note}) <= 500`),
    check(
      "workouts_exercise_notes_size",
      sql`${t.exerciseNotes} IS NULL OR octet_length(${t.exerciseNotes}::text) <= 32768`,
    ),
  ],
);

// One set: created once; its load, count (reps or seconds, never both) and RIR change together
// under fields_at.
export const workoutSets = pgTable(
  "workout_sets",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workoutId: uuid("workout_id").notNull(),
    slotIndex: smallint("slot_index").notNull(),
    position: smallint("position").notNull(),
    exerciseId: text("exercise_id").notNull(),
    warmup: boolean("warmup").notNull(),
    weightKg: numeric("weight_kg", { precision: 5, scale: 2, mode: "number" }).notNull(),
    reps: smallint("reps"),
    seconds: smallint("seconds"),
    rir: smallint("rir"),
    doneAt: ts("done_at").notNull(),
    fieldsAt: ts("fields_at").notNull(),
    removed: boolean("removed").notNull().default(false),
    removedAt: ts("removed_at"),
    serverSeq: serverSeq(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Never a session of someone else: the key holds the person too.
    foreignKey({
      name: "workout_sets_workout_fk",
      columns: [t.workoutId, t.userId],
      foreignColumns: [workouts.id, workouts.userId],
    }).onDelete("cascade"),
    index("workout_sets_user_seq").on(t.userId, t.serverSeq),
    index("workout_sets_workout").on(t.workoutId),
    check("workout_sets_slot_index", sql`${t.slotIndex} BETWEEN 0 AND 29`),
    check("workout_sets_position", sql`${t.position} BETWEEN 0 AND 49`),
    check("workout_sets_exercise", sql`${t.exerciseId} ~ '^(ds|belay):[a-z0-9-]{1,40}$'`),
    check("workout_sets_weight", sql`${t.weightKg} BETWEEN 0 AND 500`),
    check("workout_sets_reps", sql`${t.reps} BETWEEN 0 AND 100`),
    check("workout_sets_seconds", sql`${t.seconds} BETWEEN 0 AND 3600`),
    check("workout_sets_one_measure", sql`(${t.reps} IS NULL) <> (${t.seconds} IS NULL)`),
    check("workout_sets_rir", sql`${t.rir} IS NULL OR ${t.rir} BETWEEN 0 AND 4`),
  ],
);

// A program of the account: its optional name and its schedule, Monday first, a session id or null
// per day. Keyed by (account, id): the starting program's id is the same for every account.
// Removed, never deleted; every field has its own time (null: the starting program's value, never
// written since).
export const programs = pgTable(
  "programs",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    id: uuid("id").notNull(),
    name: text("name"),
    nameAt: ts("name_at"),
    schedule: jsonb("schedule")
      .$type<{ mode: "rotation" | "fixed"; days: (string | null)[] }>()
      .notNull(),
    scheduleAt: ts("schedule_at"),
    removed: boolean("removed").notNull().default(false),
    removedAt: ts("removed_at"),
    serverSeq: serverSeq(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    index("programs_user_seq").on(t.userId, t.serverSeq),
    check("programs_name", sql`${t.name} IS NULL OR char_length(${t.name}) BETWEEN 1 AND 60`),
    // Seven session ids (about 320 bytes) fit with room to spare; the API checks the shape.
    check("programs_schedule_size", sql`octet_length(${t.schedule}::text) <= 512`),
  ],
);

// Which program the account follows, one row per account; its presence marks an account as given
// the starting program. The time is when it became active (null: since the start), so the next
// session counts only the sessions done since.
export const activePrograms = pgTable(
  "active_programs",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    programId: uuid("program_id").notNull(),
    at: ts("at"),
    serverSeq: serverSeq(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Never a program of another account: the key holds the account too.
    foreignKey({
      name: "active_programs_program_fk",
      columns: [t.userId, t.programId],
      foreignColumns: [programs.userId, programs.id],
    }).onDelete("cascade"),
  ],
);

// A session: placed in a program's rotation, or set aside in the account's collection (no
// program). Keyed by (account, id): the starting program's ids are the same for every account. No
// stored letter: its letter is its place in the active rotation. Removed, never deleted, so its
// slots stay.
export const programSessions = pgTable(
  "program_sessions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    id: uuid("id").notNull(),
    name: text("name"),
    nameAt: ts("name_at"),
    // Its place: the program and the position in it change together, under one time.
    programId: uuid("program_id"),
    position: smallint("position").notNull(),
    placeAt: ts("place_at"),
    removed: boolean("removed").notNull().default(false),
    removedAt: ts("removed_at"),
    serverSeq: serverSeq(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    // Never a program of another account. MATCH SIMPLE, the default: a session set aside has no
    // program, and the key is not checked for it.
    foreignKey({
      name: "program_sessions_program_fk",
      columns: [t.userId, t.programId],
      foreignColumns: [programs.userId, programs.id],
    }).onDelete("cascade"),
    index("program_sessions_user_seq").on(t.userId, t.serverSeq),
    index("program_sessions_program").on(t.userId, t.programId),
    check(
      "program_sessions_name",
      sql`${t.name} IS NULL OR char_length(${t.name}) BETWEEN 1 AND 40`,
    ),
    check("program_sessions_position", sql`${t.position} BETWEEN 0 AND 999`),
  ],
);

// An exercise slot of a session, with the bounds of a plan's slot (isSlot); a timed slot's range
// is in seconds. Its session is fixed at creation and is always one of the same account's.
export const programSlots = pgTable(
  "program_slots",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    id: uuid("id").notNull(),
    sessionId: uuid("session_id").notNull(),
    position: smallint("position").notNull(),
    positionAt: ts("position_at"),
    // The exercise and its measure change together (a timed exercise counts seconds).
    exerciseId: text("exercise_id").notNull(),
    measure: text("measure"),
    exerciseAt: ts("exercise_at"),
    repMin: smallint("rep_min").notNull(),
    repMax: smallint("rep_max").notNull(),
    repsAt: ts("reps_at"),
    sets: smallint("sets").notNull(),
    setsAt: ts("sets_at"),
    rirMin: smallint("rir_min").notNull(),
    rirMax: smallint("rir_max").notNull(),
    rirAt: ts("rir_at"),
    restSec: smallint("rest_sec").notNull(),
    restAt: ts("rest_at"),
    warmupSets: smallint("warmup_sets").notNull(),
    warmupsAt: ts("warmups_at"),
    isMain: boolean("is_main").notNull(),
    mainAt: ts("main_at"),
    groupKey: text("group_key"),
    groupAt: ts("group_at"),
    // The section: null for the normal slots, no_climbing for the week with no climbing.
    rule: text("rule"),
    ruleAt: ts("rule_at"),
    removed: boolean("removed").notNull().default(false),
    removedAt: ts("removed_at"),
    serverSeq: serverSeq(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    // Never a session of another account: the key holds the account too.
    foreignKey({
      name: "program_slots_session_fk",
      columns: [t.userId, t.sessionId],
      foreignColumns: [programSessions.userId, programSessions.id],
    }).onDelete("cascade"),
    index("program_slots_user_seq").on(t.userId, t.serverSeq),
    index("program_slots_session").on(t.userId, t.sessionId),
    check("program_slots_exercise", sql`${t.exerciseId} ~ '^(ds|belay):[a-z0-9-]{1,40}$'`),
    check("program_slots_measure", sql`${t.measure} IS NULL OR ${t.measure} = 'seconds'`),
    check(
      "program_slots_reps",
      sql`${t.repMin} >= 1 AND ${t.repMin} <= ${t.repMax} AND ${t.repMax} <= CASE WHEN ${t.measure} = 'seconds' THEN 3600 ELSE 100 END`,
    ),
    check("program_slots_sets", sql`${t.sets} BETWEEN 1 AND 10`),
    check(
      "program_slots_rir",
      sql`${t.rirMin} >= 0 AND ${t.rirMin} <= ${t.rirMax} AND ${t.rirMax} <= 4`,
    ),
    check("program_slots_rest", sql`${t.restSec} BETWEEN 0 AND 900`),
    check("program_slots_warmups", sql`${t.warmupSets} BETWEEN 0 AND 3`),
    check(
      "program_slots_group_key",
      sql`${t.groupKey} IS NULL OR ${t.groupKey} ~ '^[A-Za-z0-9]{1,16}$'`,
    ),
    check("program_slots_rule", sql`${t.rule} IS NULL OR ${t.rule} = 'no_climbing'`),
    check("program_slots_position", sql`${t.position} BETWEEN 0 AND 999`),
  ],
);
