ALTER TABLE "users" ADD COLUMN "consent_version" smallint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_consent" CHECK (("users"."consent_version" IS NULL) = ("users"."consent_at" IS NULL) AND ("users"."consent_version" IS NULL OR "users"."consent_version" >= 1));--> statement-breakpoint
-- Hand-written below this line: drizzle-kit does not track grants and policies (see 0001_rls).
-- users: the app records the person's own consent; the users_self policy (0001) limits it to
-- their row. No account is taken to have agreed: every one is asked at its next connection.
GRANT UPDATE (consent_version, consent_at) ON users TO belay_app;
