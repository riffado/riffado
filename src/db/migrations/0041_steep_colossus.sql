CREATE TABLE "storage_deletion_queue" (
	"storage_key" text PRIMARY KEY NOT NULL,
	"source" varchar(40) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"claim_token" text,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "storage_deletion_queue_due_idx" ON "storage_deletion_queue" USING btree ("status","next_attempt_at");