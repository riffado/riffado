ALTER TABLE "ai_enhancements" ADD COLUMN "source" varchar(20) DEFAULT 'riffado' NOT NULL;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD COLUMN "source" varchar(20) DEFAULT 'riffado' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "import_plaud_content" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "transcript_mode" varchar(20) DEFAULT 'plaud_only' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "preferred_transcript_source" varchar(20) DEFAULT 'plaud' NOT NULL;--> statement-breakpoint
ALTER TABLE "transcriptions" ADD CONSTRAINT "transcriptions_recording_user_source_unique" UNIQUE("recording_id","user_id","source");