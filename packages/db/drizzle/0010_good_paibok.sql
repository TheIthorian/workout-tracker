CREATE TABLE "exercise_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"weight_kg" numeric(7, 2),
	"reps" integer,
	"duration_seconds" integer,
	"distance_m" numeric(9, 2),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercise_targets_measurements_non_negative_check" CHECK (coalesce("exercise_targets"."weight_kg", 0) >= 0 and coalesce("exercise_targets"."reps", 0) >= 0 and coalesce("exercise_targets"."duration_seconds", 0) >= 0 and coalesce("exercise_targets"."distance_m", 0) >= 0),
	CONSTRAINT "exercise_targets_measurement_present_check" CHECK ("exercise_targets"."weight_kg" is not null or "exercise_targets"."reps" is not null or "exercise_targets"."duration_seconds" is not null or "exercise_targets"."distance_m" is not null)
);
--> statement-breakpoint
ALTER TABLE "exercise_targets" ADD CONSTRAINT "exercise_targets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_targets" ADD CONSTRAINT "exercise_targets_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercise_targets_workspace_id_idx" ON "exercise_targets" USING btree ("workspace_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_targets_workspace_id_exercise_id_uidx" ON "exercise_targets" USING btree ("workspace_id","exercise_id");