ALTER TABLE "plaud_connections" ADD COLUMN "refresh_token" text;--> statement-breakpoint
ALTER TABLE "plaud_connections" ADD COLUMN "access_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "plaud_connections" ADD COLUMN "session_expires_at" timestamp;