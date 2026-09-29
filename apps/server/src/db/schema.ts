import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

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
  },
  (t) => [unique("users_oidc_identity").on(t.oidcIssuer, t.oidcSub)],
);

export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
});
