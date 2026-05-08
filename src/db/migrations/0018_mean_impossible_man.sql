ALTER TABLE "ai_enhancements" DROP CONSTRAINT "ai_enhancements_recording_id_user_id_unique";--> statement-breakpoint
ALTER TABLE "ai_enhancements" ADD COLUMN "preset_id" varchar(100) DEFAULT 'general' NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_enhancements_recording_id_idx" ON "ai_enhancements" USING btree ("recording_id");--> statement-breakpoint
CREATE INDEX "ai_enhancements_user_id_idx" ON "ai_enhancements" USING btree ("user_id");