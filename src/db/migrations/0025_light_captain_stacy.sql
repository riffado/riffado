CREATE TABLE IF NOT EXISTS "archive_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"color" varchar(20) DEFAULT 'gray' NOT NULL,
	"icon" varchar(40),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "archive_category_assignments" (
	"recording_id" text NOT NULL,
	"category_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "archive_category_assignments_recording_id_category_id_pk" PRIMARY KEY("recording_id","category_id")
);
--> statement-breakpoint
-- nickname column intentionally omitted: already added in 0024_provider_nickname.sql
ALTER TABLE "recordings" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "vault_pin" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "archive_categories" ADD CONSTRAINT "archive_categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "archive_category_assignments" ADD CONSTRAINT "archive_category_assignments_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "archive_category_assignments" ADD CONSTRAINT "archive_category_assignments_category_id_archive_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."archive_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "archive_category_assignments" ADD CONSTRAINT "archive_category_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "archive_categories_user_id_idx" ON "archive_categories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "archive_assignments_recording_id_idx" ON "archive_category_assignments" USING btree ("recording_id");
