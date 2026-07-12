CREATE TYPE "public"."founding_member_reservation_status" AS ENUM('reserved', 'consumed', 'released', 'expired');--> statement-breakpoint
CREATE TABLE "founding_member_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"stripe_checkout_session_id" text,
	"stripe_price_id" text NOT NULL,
	"status" "founding_member_reservation_status" DEFAULT 'reserved' NOT NULL,
	"reserved_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"released_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "founding_member_reservations_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id")
);
--> statement-breakpoint
ALTER TABLE "founding_member_reservations" ADD CONSTRAINT "founding_member_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "founding_member_reservations_status_expires_at_idx" ON "founding_member_reservations" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "founding_member_reservations_user_status_idx" ON "founding_member_reservations" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "founding_member_reservations_user_reserved_unique" ON "founding_member_reservations" USING btree ("user_id") WHERE "founding_member_reservations"."status" = 'reserved';