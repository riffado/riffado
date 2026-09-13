ALTER TABLE "user_settings" ADD COLUMN "speaker_diarization" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "diarization_speaker_count" integer;