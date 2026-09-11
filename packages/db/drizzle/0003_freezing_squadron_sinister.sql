ALTER TABLE "exercise_guide_images" ALTER COLUMN "workspace_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exercise_links" ALTER COLUMN "workspace_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ALTER COLUMN "workspace_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_catalog_slug_uidx" ON "exercises" USING btree ("slug") WHERE "exercises"."workspace_id" is null;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_catalog_slug_check" CHECK (("exercises"."workspace_id" is null) = ("exercises"."slug" is not null));