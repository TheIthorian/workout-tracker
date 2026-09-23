ALTER TABLE "routines" ADD COLUMN "excluded_from_recommendations" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "recommendation_score" integer;--> statement-breakpoint
ALTER TABLE "routines" ADD COLUMN "recommendation_scored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_recommendation_score_check" CHECK ("routines"."recommendation_score" is null or "routines"."recommendation_score" between 0 and 100);