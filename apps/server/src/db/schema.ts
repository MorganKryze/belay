import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  numeric,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

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
    serverSeq: serverSeq(),
  },
  (t) => [
    unique("users_oidc_identity").on(t.oidcIssuer, t.oidcSub),
    check(
      "users_target_range",
      sql`${t.targetMinPct} >= 0.25 AND ${t.targetMaxPct} <= 1.0 AND ${t.targetMinPct} <= ${t.targetMaxPct} - 0.1`,
    ),
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
  ],
);
