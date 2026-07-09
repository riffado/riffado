CREATE TYPE "public"."user_plan" AS ENUM('self_host', 'hosted_free', 'hosted_pro');--> statement-breakpoint
CREATE TABLE "billing_customers" (
	"user_id" text PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_customers_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE "email_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"subject" text NOT NULL,
	"kind" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_campaigns_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"user_id" text,
	"subscriber_id" text,
	"email" text NOT NULL,
	"status" varchar(30) NOT NULL,
	"message_id" text,
	"error" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_deliveries_campaign_email_unique" UNIQUE("campaign_id","email")
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" varchar(120) NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_log_user_kind_unique" UNIQUE("user_id","kind")
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" varchar(20) NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_validations" (
	"email" text PRIMARY KEY NOT NULL,
	"reachable" varchar(20) NOT NULL,
	"is_disposable" boolean DEFAULT false NOT NULL,
	"is_role_account" boolean DEFAULT false NOT NULL,
	"has_full_inbox" boolean DEFAULT false NOT NULL,
	"is_catch_all" boolean DEFAULT false NOT NULL,
	"mx_accepts" boolean DEFAULT false NOT NULL,
	"raw_response" jsonb,
	"provider" varchar(30) DEFAULT 'reacher-stacked' NOT NULL,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"source" varchar(20) NOT NULL,
	"consented_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	"unsubscribed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_subscriptions_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "stripe_webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" varchar(60) NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_price_id" text,
	"status" varchar(24) NOT NULL,
	"amount_value" text NOT NULL,
	"amount_currency" varchar(3) NOT NULL,
	"interval" text NOT NULL,
	"description" text,
	"billing_country" varchar(2),
	"start_date" timestamp,
	"next_payment_at" timestamp,
	"canceled_at" timestamp,
	"withdrawal_waiver_accepted_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "marketing_email_consent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan" "user_plan";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_transition_until" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "monthly_mynah_seconds_remaining" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "monthly_mynah_grant_reset_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "founding_member" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ever_paid_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_deletion_scheduled_at" timestamp;--> statement-breakpoint
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_campaign_id_email_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."email_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_subscriber_id_newsletter_subscriptions_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."newsletter_subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_deliveries_campaign_status_idx" ON "email_deliveries" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "email_deliveries_user_id_idx" ON "email_deliveries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_suppressions_created_at_idx" ON "email_suppressions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_validations_checked_at_idx" ON "email_validations" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX "newsletter_subscriptions_confirmed_at_idx" ON "newsletter_subscriptions" USING btree ("confirmed_at");--> statement-breakpoint
CREATE INDEX "stripe_webhook_events_processed_at_idx" ON "stripe_webhook_events" USING btree ("processed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_user_id_active_unique" ON "subscriptions" USING btree ("user_id") WHERE "subscriptions"."status" IN ('active', 'trialing', 'past_due');--> statement-breakpoint
CREATE INDEX "subscriptions_user_status_idx" ON "subscriptions" USING btree ("user_id","status");