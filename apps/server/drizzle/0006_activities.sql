CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"duration_min" smallint NOT NULL,
	"cardio_type" text,
	"climb_style" text,
	"climb_runs" smallint,
	"climb_grade" text,
	"climb_color" text,
	"fields_at" timestamp with time zone NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('belay_sync_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_kind" CHECK ("activities"."kind" IN ('cardio', 'climbing')),
	CONSTRAINT "activities_duration" CHECK ("activities"."duration_min" BETWEEN 5 AND 480 AND "activities"."duration_min" % 5 = 0),
	CONSTRAINT "activities_cardio_type" CHECK ("activities"."cardio_type" IS NULL OR "activities"."cardio_type" IN ('run', 'bike', 'row', 'walk', 'swim', 'other')),
	CONSTRAINT "activities_climb_style" CHECK ("activities"."climb_style" IS NULL OR "activities"."climb_style" IN ('boulder', 'route')),
	CONSTRAINT "activities_climb_runs" CHECK ("activities"."climb_runs" IS NULL OR "activities"."climb_runs" BETWEEN 0 AND 200),
	CONSTRAINT "activities_climb_grade" CHECK ("activities"."climb_grade" IS NULL OR "activities"."climb_grade" ~ '^[5-8][abc]\+?$'),
	CONSTRAINT "activities_climb_color" CHECK ("activities"."climb_color" IS NULL OR "activities"."climb_color" IN ('yellow', 'green', 'blue', 'red', 'black', 'purple', 'white')),
	CONSTRAINT "activities_cardio_only" CHECK ("activities"."kind" = 'cardio' OR "activities"."cardio_type" IS NULL),
	CONSTRAINT "activities_climbing_only" CHECK ("activities"."kind" = 'climbing' OR ("activities"."climb_style" IS NULL AND "activities"."climb_runs" IS NULL AND "activities"."climb_grade" IS NULL AND "activities"."climb_color" IS NULL)),
	CONSTRAINT "activities_grade_or_color" CHECK ("activities"."climb_grade" IS NULL OR "activities"."climb_color" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "daily_steps" (
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"steps" integer,
	"steps_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('belay_sync_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_steps_user_id_date_pk" PRIMARY KEY("user_id","date"),
	CONSTRAINT "daily_steps_range" CHECK ("daily_steps"."steps" IS NULL OR "daily_steps"."steps" BETWEEN 0 AND 100000)
);
--> statement-breakpoint
ALTER TABLE "workout_sets" ALTER COLUMN "reps" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "seconds" smallint;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "plan_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "started_at_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_steps" ADD CONSTRAINT "daily_steps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_user_seq" ON "activities" USING btree ("user_id","server_seq");--> statement-breakpoint
CREATE INDEX "daily_steps_user_seq" ON "daily_steps" USING btree ("user_id","server_seq");--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_seconds" CHECK ("workout_sets"."seconds" BETWEEN 0 AND 3600);--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_one_measure" CHECK (("workout_sets"."reps" IS NULL) <> ("workout_sets"."seconds" IS NULL));--> statement-breakpoint
-- Hand-written below this line: drizzle-kit does not track grants and policies (see 0001_rls).
-- Steps and activities: read and write one's own rows, never delete (a deletion is a tombstone).
-- The new columns of workouts and workout_sets are covered by their table grants (0005_workouts).
GRANT SELECT, INSERT, UPDATE ON daily_steps, activities TO belay_app;
--> statement-breakpoint
ALTER TABLE daily_steps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY daily_steps_owner ON daily_steps TO belay_app
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY activities_owner ON activities TO belay_app
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
