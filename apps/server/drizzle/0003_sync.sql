CREATE SEQUENCE "public"."belay_sync_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "body_metrics" (
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"weight_kg" numeric(4, 1),
	"weight_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('belay_sync_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "body_metrics_user_id_date_pk" PRIMARY KEY("user_id","date"),
	CONSTRAINT "body_metrics_weight_range" CHECK ("body_metrics"."weight_kg" IS NULL OR "body_metrics"."weight_kg" BETWEEN 20 AND 400)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "target_min_pct" numeric(3, 2) DEFAULT 0.5 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "target_max_pct" numeric(3, 2) DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "target_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "server_seq" bigint DEFAULT nextval('belay_sync_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "body_metrics" ADD CONSTRAINT "body_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "body_metrics_user_seq" ON "body_metrics" USING btree ("user_id","server_seq");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_target_range" CHECK ("users"."target_min_pct" >= 0.25 AND "users"."target_max_pct" <= 1.0 AND "users"."target_min_pct" <= "users"."target_max_pct" - 0.1);--> statement-breakpoint
-- Hand-written below this line: drizzle-kit does not track grants and policies (see 0001_rls).
-- body_metrics: read and write one's own days, never delete (a deletion is a null weight).
GRANT SELECT, INSERT, UPDATE ON body_metrics TO belay_app;
--> statement-breakpoint
ALTER TABLE body_metrics ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY body_metrics_owner ON body_metrics TO belay_app
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
-- users: the app writes the target range and its sync columns, nothing else of the row.
-- The users_self policy (0001) already limits the update to one's own row.
GRANT UPDATE (target_min_pct, target_max_pct, target_at, server_seq, updated_at) ON users TO belay_app;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE belay_sync_seq TO belay_app;
