CREATE TABLE "speaker_names" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"recording_id" text NOT NULL,
	"speaker_label" varchar(50) NOT NULL,
	"display_name" text NOT NULL,
	"voice_profile_id" text,
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"confidence" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "speaker_names_recording_id_speaker_label_unique" UNIQUE("recording_id","speaker_label")
);
--> statement-breakpoint
CREATE TABLE "voice_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"embedding" jsonb NOT NULL,
	"sample_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "voice_profiles_user_id_display_name_unique" UNIQUE("user_id","display_name")
);
--> statement-breakpoint
ALTER TABLE "speaker_names" ADD CONSTRAINT "speaker_names_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaker_names" ADD CONSTRAINT "speaker_names_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speaker_names" ADD CONSTRAINT "speaker_names_voice_profile_id_voice_profiles_id_fk" FOREIGN KEY ("voice_profile_id") REFERENCES "public"."voice_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "speaker_names_recording_id_idx" ON "speaker_names" USING btree ("recording_id");--> statement-breakpoint
CREATE INDEX "speaker_names_user_id_idx" ON "speaker_names" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "voice_profiles_user_id_idx" ON "voice_profiles" USING btree ("user_id");