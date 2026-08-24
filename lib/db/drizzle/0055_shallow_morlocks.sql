ALTER TYPE "public"."leave_request_status" ADD VALUE 'pending_hr' BEFORE 'approved';--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "department_head_approved_by" integer;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "department_head_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "department_head_rejected_by" integer;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "department_head_rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "department_head_rejection_reason" text;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "rejected_by" integer;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_department_head_approved_by_users_id_fk" FOREIGN KEY ("department_head_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_department_head_rejected_by_users_id_fk" FOREIGN KEY ("department_head_rejected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_rejected_by_users_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;