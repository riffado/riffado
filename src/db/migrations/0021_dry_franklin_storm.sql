CREATE TABLE "api_rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_rate_limit_buckets_reset_at_idx" ON "api_rate_limit_buckets" USING btree ("reset_at");