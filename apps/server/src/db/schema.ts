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

// A session as it was done: its code, plan (the day's targets, frozen) and start are written once;
// its end, note, exercise notes and removal each carry their own timestamp. Removed, never deleted:
// its sets stay, and no screen shows or counts them.
export const workouts = pgTable(
  "workouts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionCode: text("session_code").notNull(),
    plan: jsonb("plan").$type<Slot[]>().notNull(),
    startedAt: ts("started_at").notNull(),
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
    check("workouts_plan_size", sql`octet_length(${t.plan}::text) <= 16384`),
    check("workouts_note", sql`${t.note} IS NULL OR char_length(${t.note}) <= 500`),
    check(
      "workouts_exercise_notes_size",
      sql`${t.exerciseNotes} IS NULL OR octet_length(${t.exerciseNotes}::text) <= 32768`,
    ),
  ],
);

// One set: created once; its load, reps and RIR change together under fields_at.
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
    reps: smallint("reps").notNull(),
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
    check("workout_sets_rir", sql`${t.rir} IS NULL OR ${t.rir} BETWEEN 0 AND 4`),
  ],
);
