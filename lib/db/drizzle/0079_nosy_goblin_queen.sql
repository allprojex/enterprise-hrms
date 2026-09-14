CREATE TYPE "public"."form_assistance_reason" AS ENUM('system_access_unavailable', 'medical_or_incapacity', 'accessibility_assistance', 'administrative_assistance', 'other');--> statement-breakpoint
ALTER TYPE "public"."form_submission_event_type" ADD VALUE 'created_on_behalf' BEFORE 'draft_saved';--> statement-breakpoint
ALTER TYPE "public"."form_submission_event_type" ADD VALUE 'submitted_on_behalf' BEFORE 'stage_completed';--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN "assisted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN "assistance_reason" "form_assistance_reason";--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN "assistance_notes" text;--> statement-breakpoint
ALTER TABLE "form_template_versions" ADD COLUMN "submission_policy" jsonb;