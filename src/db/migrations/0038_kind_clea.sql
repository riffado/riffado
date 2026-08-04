CREATE TABLE "plaud_filetags" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plaud_tag_id" varchar(255),
	"name" text NOT NULL,
	"icon" varchar(64) DEFAULT 'iconfont_folder_foler_1' NOT NULL,
	"color" varchar(9) DEFAULT '#191919' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plaud_filetags_user_id_plaud_tag_id_unique" UNIQUE("user_id","plaud_tag_id")
);
--> statement-breakpoint
ALTER TABLE "recordings" ADD COLUMN "filetag_id" text;--> statement-breakpoint
ALTER TABLE "plaud_filetags" ADD CONSTRAINT "plaud_filetags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plaud_filetags_user_id_idx" ON "plaud_filetags" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_filetag_id_plaud_filetags_id_fk" FOREIGN KEY ("filetag_id") REFERENCES "public"."plaud_filetags"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recordings_user_id_filetag_id_idx" ON "recordings" USING btree ("user_id","filetag_id");