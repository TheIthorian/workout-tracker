CREATE TYPE "public"."onboarding_stage" AS ENUM('equipment', 'complete');--> statement-breakpoint
CREATE TYPE "public"."equipment" AS ENUM('barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'squat_rack', 'bench', 'pull_up_bar', 'resistance_band', 'treadmill', 'stationary_bike', 'rowing_machine');--> statement-breakpoint
CREATE TABLE "equipment_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"equipment" "equipment"[] DEFAULT '{}'::equipment[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "onboarding_stage" "onboarding_stage" DEFAULT 'equipment' NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "equipment" "equipment"[] DEFAULT '{}'::equipment[] NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_presets" ADD CONSTRAINT "equipment_presets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_presets_workspace_id_idx" ON "equipment_presets" USING btree ("workspace_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_presets_workspace_id_name_uidx" ON "equipment_presets" USING btree ("workspace_id","name");