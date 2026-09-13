CREATE TYPE "public"."session_exercise_source" AS ENUM('from_routine', 'added_ad_hoc');--> statement-breakpoint
CREATE TABLE "session_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"tracking_type" "tracking_type" NOT NULL,
	"source" "session_exercise_source" NOT NULL,
	"position" integer NOT NULL,
	"target_sets" integer NOT NULL,
	"rest_seconds" integer,
	"notes" text,
	"skipped_at" timestamp with time zone,
	"target_reps" integer,
	"target_weight_kg" numeric(7, 2),
	"target_duration_seconds" integer,
	"target_distance_m" numeric(9, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_exercises_target_sets_check" CHECK ("session_exercises"."target_sets" >= 1),
	CONSTRAINT "session_exercises_targets_non_negative_check" CHECK (coalesce("session_exercises"."rest_seconds", 0) >= 0 and coalesce("session_exercises"."target_reps", 0) >= 0 and coalesce("session_exercises"."target_weight_kg", 0) >= 0 and coalesce("session_exercises"."target_duration_seconds", 0) >= 0 and coalesce("session_exercises"."target_distance_m", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "set_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_exercise_id" uuid NOT NULL,
	"set_index" integer NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_warmup" boolean DEFAULT false NOT NULL,
	"rpe" numeric(3, 1),
	"weight_kg" numeric(7, 2),
	"reps" integer,
	"duration_seconds" integer,
	"distance_m" numeric(9, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "set_entries_set_index_check" CHECK ("set_entries"."set_index" >= 1),
	CONSTRAINT "set_entries_rpe_check" CHECK ("set_entries"."rpe" is null or ("set_entries"."rpe" >= 0 and "set_entries"."rpe" <= 10)),
	CONSTRAINT "set_entries_measurements_non_negative_check" CHECK (coalesce("set_entries"."weight_kg", 0) >= 0 and coalesce("set_entries"."reps", 0) >= 0 and coalesce("set_entries"."duration_seconds", 0) >= 0 and coalesce("set_entries"."distance_m", 0) >= 0),
	CONSTRAINT "set_entries_measurement_present_check" CHECK ("set_entries"."reps" is not null or "set_entries"."duration_seconds" is not null)
);
--> statement-breakpoint
CREATE TABLE "workout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"routine_id" uuid,
	"name" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_session_id_workout_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."workout_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_exercises" ADD CONSTRAINT "session_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_entries" ADD CONSTRAINT "set_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_entries" ADD CONSTRAINT "set_entries_session_exercise_id_session_exercises_id_fk" FOREIGN KEY ("session_exercise_id") REFERENCES "public"."session_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sessions" ADD CONSTRAINT "workout_sessions_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_exercises_workspace_id_idx" ON "session_exercises" USING btree ("workspace_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "session_exercises_session_id_idx" ON "session_exercises" USING btree ("session_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "session_exercises_exercise_id_idx" ON "session_exercises" USING btree ("exercise_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "set_entries_workspace_id_idx" ON "set_entries" USING btree ("workspace_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "set_entries_session_exercise_id_set_index_uidx" ON "set_entries" USING btree ("session_exercise_id","set_index");--> statement-breakpoint
CREATE INDEX "workout_sessions_workspace_id_idx" ON "workout_sessions" USING btree ("workspace_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "workout_sessions_active_uidx" ON "workout_sessions" USING btree ("workspace_id") WHERE "workout_sessions"."completed_at" is null;