CREATE TYPE "public"."export_job_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" "export_job_status" DEFAULT 'pending' NOT NULL,
	"storage_key" text,
	"file_size" integer,
	"recording_count" integer,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"expires_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_jobs_user_id_idx" ON "export_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "export_jobs_status_created_at_idx" ON "export_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "export_jobs_expires_at_idx" ON "export_jobs" USING btree ("expires_at");