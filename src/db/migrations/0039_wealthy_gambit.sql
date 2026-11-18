CREATE TABLE "status_job_runs" (
	"job" varchar(40) PRIMARY KEY NOT NULL,
	"last_success_at" timestamp,
	"last_error_at" timestamp,
	"failing_since" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_minute_buckets" (
	"part" varchar(40) NOT NULL,
	"minute" timestamp NOT NULL,
	"ok" integer DEFAULT 0 NOT NULL,
	"err" integer DEFAULT 0 NOT NULL,
	"latency_buckets" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"verdict_ok" text,
	"verdict_slow" text,
	"verdict_down" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "status_minute_buckets_part_minute_pk" PRIMARY KEY("part","minute")
);
--> statement-breakpoint
CREATE INDEX "status_minute_buckets_minute_idx" ON "status_minute_buckets" USING btree ("minute");