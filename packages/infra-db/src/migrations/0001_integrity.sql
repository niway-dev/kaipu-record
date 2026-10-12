DROP INDEX "subscription_userId_idx";--> statement-breakpoint
ALTER TABLE "kaipu_record_account" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "kaipu_record_session" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "kaipu_record_cloud_asset" ADD CONSTRAINT "cloud_asset_current_revision_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."kaipu_record_cloud_revision"("revision_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kaipu_record_cloud_revision" ADD CONSTRAINT "cloud_revision_asset_fk" FOREIGN KEY ("user_id","asset_id") REFERENCES "public"."kaipu_record_cloud_asset"("user_id","asset_id") ON DELETE cascade ON UPDATE no action;