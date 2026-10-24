ALTER TABLE "workouts" ADD COLUMN "session_name" text;--> statement-breakpoint
ALTER TABLE "workouts" ADD COLUMN "session_name_kept" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_session_name" CHECK ("workouts"."session_name" IS NULL OR ("workouts"."session_name_kept" AND char_length("workouts"."session_name") BETWEEN 1 AND 40));