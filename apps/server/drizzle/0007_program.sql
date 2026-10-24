CREATE TABLE "active_programs" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"program_id" uuid NOT NULL,
	"at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('belay_sync_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_sessions" (
	"user_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"name" text,
	"name_at" timestamp with time zone,
	"program_id" uuid,
	"position" smallint NOT NULL,
	"place_at" timestamp with time zone,
	"removed" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('belay_sync_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_sessions_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "program_sessions_name" CHECK ("program_sessions"."name" IS NULL OR char_length("program_sessions"."name") BETWEEN 1 AND 40),
	CONSTRAINT "program_sessions_position" CHECK ("program_sessions"."position" BETWEEN 0 AND 999)
);
--> statement-breakpoint
CREATE TABLE "program_slots" (
	"user_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"position_at" timestamp with time zone,
	"exercise_id" text NOT NULL,
	"measure" text,
	"exercise_at" timestamp with time zone,
	"rep_min" smallint NOT NULL,
	"rep_max" smallint NOT NULL,
	"reps_at" timestamp with time zone,
	"sets" smallint NOT NULL,
	"sets_at" timestamp with time zone,
	"rir_min" smallint NOT NULL,
	"rir_max" smallint NOT NULL,
	"rir_at" timestamp with time zone,
	"rest_sec" smallint NOT NULL,
	"rest_at" timestamp with time zone,
	"warmup_sets" smallint NOT NULL,
	"warmups_at" timestamp with time zone,
	"is_main" boolean NOT NULL,
	"main_at" timestamp with time zone,
	"group_key" text,
	"group_at" timestamp with time zone,
	"rule" text,
	"rule_at" timestamp with time zone,
	"removed" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('belay_sync_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "program_slots_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "program_slots_exercise" CHECK ("program_slots"."exercise_id" ~ '^(ds|belay):[a-z0-9-]{1,40}$'),
	CONSTRAINT "program_slots_measure" CHECK ("program_slots"."measure" IS NULL OR "program_slots"."measure" = 'seconds'),
	CONSTRAINT "program_slots_reps" CHECK ("program_slots"."rep_min" >= 1 AND "program_slots"."rep_min" <= "program_slots"."rep_max" AND "program_slots"."rep_max" <= CASE WHEN "program_slots"."measure" = 'seconds' THEN 3600 ELSE 100 END),
	CONSTRAINT "program_slots_sets" CHECK ("program_slots"."sets" BETWEEN 1 AND 10),
	CONSTRAINT "program_slots_rir" CHECK ("program_slots"."rir_min" >= 0 AND "program_slots"."rir_min" <= "program_slots"."rir_max" AND "program_slots"."rir_max" <= 4),
	CONSTRAINT "program_slots_rest" CHECK ("program_slots"."rest_sec" BETWEEN 0 AND 900),
	CONSTRAINT "program_slots_warmups" CHECK ("program_slots"."warmup_sets" BETWEEN 0 AND 3),
	CONSTRAINT "program_slots_group_key" CHECK ("program_slots"."group_key" IS NULL OR "program_slots"."group_key" ~ '^[A-Za-z0-9]{1,16}$'),
	CONSTRAINT "program_slots_rule" CHECK ("program_slots"."rule" IS NULL OR "program_slots"."rule" = 'no_climbing'),
	CONSTRAINT "program_slots_position" CHECK ("program_slots"."position" BETWEEN 0 AND 999)
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"user_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"name" text,
	"name_at" timestamp with time zone,
	"schedule" jsonb NOT NULL,
	"schedule_at" timestamp with time zone,
	"removed" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('belay_sync_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "programs_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "programs_name" CHECK ("programs"."name" IS NULL OR char_length("programs"."name") BETWEEN 1 AND 60),
	CONSTRAINT "programs_schedule_size" CHECK (octet_length("programs"."schedule"::text) <= 512)
);
--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "active_programs" ADD CONSTRAINT "active_programs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "active_programs" ADD CONSTRAINT "active_programs_program_fk" FOREIGN KEY ("user_id","program_id") REFERENCES "public"."programs"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_sessions" ADD CONSTRAINT "program_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_sessions" ADD CONSTRAINT "program_sessions_program_fk" FOREIGN KEY ("user_id","program_id") REFERENCES "public"."programs"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_slots" ADD CONSTRAINT "program_slots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_slots" ADD CONSTRAINT "program_slots_session_fk" FOREIGN KEY ("user_id","session_id") REFERENCES "public"."program_sessions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "program_sessions_user_seq" ON "program_sessions" USING btree ("user_id","server_seq");--> statement-breakpoint
CREATE INDEX "program_sessions_program" ON "program_sessions" USING btree ("user_id","program_id");--> statement-breakpoint
CREATE INDEX "program_slots_user_seq" ON "program_slots" USING btree ("user_id","server_seq");--> statement-breakpoint
CREATE INDEX "program_slots_session" ON "program_slots" USING btree ("user_id","session_id");--> statement-breakpoint
CREATE INDEX "programs_user_seq" ON "programs" USING btree ("user_id","server_seq");--> statement-breakpoint
-- Hand-written below this line: drizzle-kit does not track grants and policies (see 0001_rls).
-- Programs, the active pointer, sessions and slots: read and write one's own rows, never delete (a
-- removal is a flag). The starting program's ids are the same for every account; the policies keep
-- each account to its own copy.
GRANT SELECT, INSERT, UPDATE ON programs, active_programs, program_sessions, program_slots TO belay_app;
--> statement-breakpoint
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE active_programs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE program_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE program_slots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY programs_owner ON programs TO belay_app
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY active_programs_owner ON active_programs TO belay_app
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY program_sessions_owner ON program_sessions TO belay_app
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY program_slots_owner ON program_slots TO belay_app
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
