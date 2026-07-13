ALTER TABLE "founding_member_reservations" DROP CONSTRAINT "founding_member_reservations_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "founding_member_reservations" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "founding_member_reservations" ADD CONSTRAINT "founding_member_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;