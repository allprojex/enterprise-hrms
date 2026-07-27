ALTER TABLE "organization_memberships" ADD COLUMN "invite_token" text;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD COLUMN "invite_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_invite_token_unique" UNIQUE("invite_token");