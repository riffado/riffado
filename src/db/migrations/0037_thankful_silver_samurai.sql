ALTER TABLE "user_settings" ADD COLUMN "auto_summarize" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "auto_summarize_preset" text;