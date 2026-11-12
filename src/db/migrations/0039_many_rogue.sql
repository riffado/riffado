ALTER TABLE "transcriptions" ADD COLUMN "segments" jsonb;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "auto_chunk_transcriptions" boolean DEFAULT true NOT NULL;