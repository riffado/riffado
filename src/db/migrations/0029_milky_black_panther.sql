ALTER TABLE "export_jobs" ALTER COLUMN "file_size" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "claim_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "export_jobs_user_active_unique" ON "export_jobs" USING btree ("user_id") WHERE "export_jobs"."status" in ('pending', 'processing');