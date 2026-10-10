CREATE TABLE "kaipu_record_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kaipu_record_session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "kaipu_record_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "kaipu_record_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "kaipu_record_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "kaipu_record_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kaipu_record_cloud_asset" (
	"user_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"current_revision_id" text,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"derived_from_asset_id" text,
	"auto_upload_excluded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "kaipu_record_cloud_asset_user_id_asset_id_pk" PRIMARY KEY("user_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "kaipu_record_cloud_control" (
	"id" text PRIMARY KEY NOT NULL,
	"uploads_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kaipu_record_cloud_purge" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"done_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kaipu_record_cloud_revision" (
	"revision_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"intent_key" text NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"storage_key" text NOT NULL,
	"thumbnail_key" text,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"thumbnail_bytes" integer DEFAULT 0 NOT NULL,
	"content_sha256" text NOT NULL,
	"reserved_bytes" bigint NOT NULL,
	"ticket_expires_at" timestamp NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "kaipu_record_cloud_revision_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "kaipu_record_cloud_storage_account" (
	"user_id" text PRIMARY KEY NOT NULL,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"reserved_bytes" bigint DEFAULT 0 NOT NULL,
	"pending_uploads" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kaipu_record_recording" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "kaipu_record_recording_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "kaipu_record_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_period_end" timestamp,
	"provider" text DEFAULT 'manual' NOT NULL,
	"provider_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "kaipu_record_subscription_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "kaipu_record_account" ADD CONSTRAINT "kaipu_record_account_user_id_kaipu_record_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."kaipu_record_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kaipu_record_session" ADD CONSTRAINT "kaipu_record_session_user_id_kaipu_record_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."kaipu_record_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kaipu_record_cloud_asset" ADD CONSTRAINT "kaipu_record_cloud_asset_user_id_kaipu_record_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."kaipu_record_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kaipu_record_cloud_revision" ADD CONSTRAINT "kaipu_record_cloud_revision_user_id_kaipu_record_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."kaipu_record_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kaipu_record_cloud_storage_account" ADD CONSTRAINT "kaipu_record_cloud_storage_account_user_id_kaipu_record_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."kaipu_record_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kaipu_record_recording" ADD CONSTRAINT "kaipu_record_recording_user_id_kaipu_record_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."kaipu_record_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kaipu_record_subscription" ADD CONSTRAINT "kaipu_record_subscription_user_id_kaipu_record_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."kaipu_record_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "kaipu_record_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "kaipu_record_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "kaipu_record_verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "cloud_asset_user_created_idx" ON "kaipu_record_cloud_asset" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cloud_revision_user_intent_idx" ON "kaipu_record_cloud_revision" USING btree ("user_id","intent_key");--> statement-breakpoint
CREATE INDEX "cloud_revision_user_asset_idx" ON "kaipu_record_cloud_revision" USING btree ("user_id","asset_id");--> statement-breakpoint
CREATE INDEX "cloud_revision_status_ticket_idx" ON "kaipu_record_cloud_revision" USING btree ("status","ticket_expires_at");--> statement-breakpoint
CREATE INDEX "recording_userId_idx" ON "kaipu_record_recording" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscription_userId_idx" ON "kaipu_record_subscription" USING btree ("user_id");