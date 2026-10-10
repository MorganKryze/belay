CREATE TABLE "workout_sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"workout_id" uuid NOT NULL,
	"slot_index" smallint NOT NULL,
	"position" smallint NOT NULL,
	"exercise_id" text NOT NULL,
	"warmup" boolean NOT NULL,
	"weight_kg" numeric(5, 2) NOT NULL,
	"reps" smallint NOT NULL,
	"rir" smallint,
	"done_at" timestamp with time zone NOT NULL,
	"fields_at" timestamp with time zone NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('belay_sync_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workout_sets_slot_index" CHECK ("workout_sets"."slot_index" BETWEEN 0 AND 29),
	CONSTRAINT "workout_sets_position" CHECK ("workout_sets"."position" BETWEEN 0 AND 49),
	CONSTRAINT "workout_sets_exercise" CHECK ("workout_sets"."exercise_id" ~ '^(ds|belay):[a-z0-9-]{1,40}$'),
	CONSTRAINT "workout_sets_weight" CHECK ("workout_sets"."weight_kg" BETWEEN 0 AND 500),
	CONSTRAINT "workout_sets_reps" CHECK ("workout_sets"."reps" BETWEEN 0 AND 100),
	CONSTRAINT "workout_sets_rir" CHECK ("workout_sets"."rir" IS NULL OR "workout_sets"."rir" BETWEEN 0 AND 4)
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_code" text NOT NULL,
	"plan" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_at_at" timestamp with time zone,
	"note" text,
	"note_at" timestamp with time zone,
	"exercise_notes" jsonb,
	"exercise_notes_at" timestamp with time zone,
	"removed" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('belay_sync_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workouts_id_user" UNIQUE("id","user_id"),
	CONSTRAINT "workouts_session_code" CHECK ("workouts"."session_code" ~ '^[A-Z]$'),
	CONSTRAINT "workouts_plan_size" CHECK (octet_length("workouts"."plan"::text) <= 16384),
	CONSTRAINT "workouts_note" CHECK ("workouts"."note" IS NULL OR char_length("workouts"."note") <= 500),
	CONSTRAINT "workouts_exercise_notes_size" CHECK ("workouts"."exercise_notes" IS NULL OR octet_length("workouts"."exercise_notes"::text) <= 32768)
);
--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_workout_fk" FOREIGN KEY ("workout_id","user_id") REFERENCES "public"."workouts"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workout_sets_user_seq" ON "workout_sets" USING btree ("user_id","server_seq");--> statement-breakpoint
CREATE INDEX "workout_sets_workout" ON "workout_sets" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX "workouts_user_seq" ON "workouts" USING btree ("user_id","server_seq");--> statement-breakpoint
-- Hand-written below this line: drizzle-kit does not track grants and policies (see 0001_rls).
-- Sessions and sets: read and write one's own rows, never delete (a removal is a tombstone).
GRANT SELECT, INSERT, UPDATE ON workouts, workout_sets TO belay_app;
--> statement-breakpoint
ALTER TABLE workouts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workout_sets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workouts_owner ON workouts TO belay_app
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
-- The key workout_sets_workout_fk also ties a set to a session of the same person.
CREATE POLICY workout_sets_owner ON workout_sets TO belay_app
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
