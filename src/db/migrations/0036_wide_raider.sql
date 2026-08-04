CREATE TYPE "public"."stripe_webhook_event_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" RENAME COLUMN "processed_at" TO "event_created_at";--> statement-breakpoint
DROP INDEX "stripe_webhook_events_processed_at_idx";--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "payload" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "status" "stripe_webhook_event_status" DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "claim_token" text;--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "started_at" timestamp;--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "next_attempt_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "failed_at" timestamp;--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "stripe_webhook_events_due_idx" ON "stripe_webhook_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "stripe_webhook_events_created_at_idx" ON "stripe_webhook_events" USING btree ("created_at");