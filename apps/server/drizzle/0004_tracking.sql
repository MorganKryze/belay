CREATE TABLE "annotations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"fields_at" timestamp with time zone NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('belay_sync_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annotations_kind" CHECK ("annotations"."kind" IN ('deload', 'diet_break', 'note')),
	CONSTRAINT "annotations_label" CHECK ("annotations"."label" IS NULL OR char_length("annotations"."label") <= 80)
);
--> statement-breakpoint
CREATE TABLE "intake_logs" (
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kcal" integer,
	"kcal_at" timestamp with time zone,
	"protein_g" integer,
	"protein_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('belay_sync_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intake_logs_user_id_date_pk" PRIMARY KEY("user_id","date"),
	CONSTRAINT "intake_logs_range" CHECK (("intake_logs"."kcal" IS NULL OR "intake_logs"."kcal" BETWEEN 0 AND 10000) AND ("intake_logs"."protein_g" IS NULL OR "intake_logs"."protein_g" BETWEEN 0 AND 500))
);
--> statement-breakpoint
CREATE TABLE "supplement_logs" (
	"user_id" uuid NOT NULL,
	"supplement_id" uuid NOT NULL,
	"date" date NOT NULL,
	"taken" boolean NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"server_seq" bigint DEFAULT nextval('belay_sync_seq') NOT NULL,
	CONSTRAINT "supplement_logs_user_id_supplement_id_date_pk" PRIMARY KEY("user_id","supplement_id","date")
);
--> statement-breakpoint
CREATE TABLE "supplements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"server_seq" bigint DEFAULT nextval('belay_sync_seq') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplements_id_user" UNIQUE("id","user_id"),
	CONSTRAINT "supplements_kind" CHECK ("supplements"."kind" IN ('creatine', 'other')),
	CONSTRAINT "supplements_name" CHECK (char_length("supplements"."name") BETWEEN 1 AND 40)
);
--> statement-breakpoint
ALTER TABLE "body_metrics" ADD COLUMN "waist_cm" numeric(4, 1);--> statement-breakpoint
ALTER TABLE "body_metrics" ADD COLUMN "waist_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "body_metrics" ADD COLUMN "neck_cm" numeric(4, 1);--> statement-breakpoint
ALTER TABLE "body_metrics" ADD COLUMN "neck_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "body_metrics" ADD COLUMN "hip_cm" numeric(4, 1);--> statement-breakpoint
ALTER TABLE "body_metrics" ADD COLUMN "hip_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "formula" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "formula_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birth_year" smallint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birth_year_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "height_cm" smallint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "height_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_logs" ADD CONSTRAINT "intake_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplement_logs" ADD CONSTRAINT "supplement_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplement_logs" ADD CONSTRAINT "supplement_logs_supplement_fk" FOREIGN KEY ("supplement_id","user_id") REFERENCES "public"."supplements"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplements" ADD CONSTRAINT "supplements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "annotations_user_seq" ON "annotations" USING btree ("user_id","server_seq");--> statement-breakpoint
CREATE INDEX "intake_logs_user_seq" ON "intake_logs" USING btree ("user_id","server_seq");--> statement-breakpoint
CREATE INDEX "supplement_logs_user_seq" ON "supplement_logs" USING btree ("user_id","server_seq");--> statement-breakpoint
CREATE INDEX "supplements_user_seq" ON "supplements" USING btree ("user_id","server_seq");--> statement-breakpoint
ALTER TABLE "body_metrics" ADD CONSTRAINT "body_metrics_measures_range" CHECK (("body_metrics"."waist_cm" IS NULL OR "body_metrics"."waist_cm" BETWEEN 40 AND 200) AND ("body_metrics"."neck_cm" IS NULL OR "body_metrics"."neck_cm" BETWEEN 20 AND 80) AND ("body_metrics"."hip_cm" IS NULL OR "body_metrics"."hip_cm" BETWEEN 50 AND 200));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_formula" CHECK ("users"."formula" IS NULL OR "users"."formula" IN ('female', 'male'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_birth_year" CHECK ("users"."birth_year" IS NULL OR "users"."birth_year" >= 1900);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_height" CHECK ("users"."height_cm" IS NULL OR "users"."height_cm" BETWEEN 120 AND 230);--> statement-breakpoint
-- Hand-written below this line: drizzle-kit does not track grants and policies (see 0001_rls).
-- The tracking tables: read and write one's own rows, never delete (a deletion is a tombstone).
-- body_metrics' new columns are covered by its table grant (0003_sync).
GRANT SELECT, INSERT, UPDATE ON intake_logs, supplements, supplement_logs, annotations TO belay_app;
--> statement-breakpoint
ALTER TABLE intake_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE supplements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE supplement_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY intake_logs_owner ON intake_logs TO belay_app
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY supplements_owner ON supplements TO belay_app
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
-- The key supplement_logs_supplement_fk also ties a tick to a supplement of the same person.
CREATE POLICY supplement_logs_owner ON supplement_logs TO belay_app
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY annotations_owner ON annotations TO belay_app
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
-- users: the profile and its timestamps, on top of the range (0003_sync); still one's own row only.
GRANT UPDATE (formula, formula_at, birth_year, birth_year_at, height_cm, height_at) ON users TO belay_app;
