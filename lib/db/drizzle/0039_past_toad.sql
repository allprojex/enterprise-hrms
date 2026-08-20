CREATE TYPE "public"."learning_course_delivery_mode" AS ENUM('self_paced', 'instructor_led');--> statement-breakpoint
CREATE TYPE "public"."learning_course_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."learning_session_status" AS ENUM('scheduled', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."learning_enrollment_approval_status" AS ENUM('auto_approved', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."learning_enrollment_origin_type" AS ENUM('hr_assigned', 'manager_assigned', 'employee_requested');--> statement-breakpoint
CREATE TYPE "public"."learning_enrollment_status" AS ENUM('assigned', 'in_progress', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."learning_certificate_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "learning_courses" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"category_code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"delivery_mode" "learning_course_delivery_mode" NOT NULL,
	"mandatory_default" boolean DEFAULT false NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"has_assessment" boolean DEFAULT false NOT NULL,
	"issues_certificate" boolean DEFAULT false NOT NULL,
	"certificate_validity_months" integer,
	"status" "learning_course_status" DEFAULT 'draft' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_course_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"course_id" integer NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"location" text,
	"meeting_link" text,
	"instructor_employee_id" integer,
	"capacity" integer,
	"status" "learning_session_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"course_id" integer NOT NULL,
	"session_id" integer,
	"employee_id" integer NOT NULL,
	"course_title_snapshot" text NOT NULL,
	"category_snapshot" text NOT NULL,
	"delivery_mode_snapshot" "learning_course_delivery_mode" NOT NULL,
	"has_assessment_snapshot" boolean NOT NULL,
	"issues_certificate_snapshot" boolean NOT NULL,
	"certificate_validity_months_snapshot" integer,
	"department_id_snapshot" integer,
	"position_id_snapshot" integer,
	"manager_employee_id_snapshot" integer,
	"mandatory_at_assignment" boolean DEFAULT false NOT NULL,
	"origin_type" "learning_enrollment_origin_type" NOT NULL,
	"assigned_by_membership_id" integer,
	"due_date" timestamp with time zone,
	"approval_status" "learning_enrollment_approval_status" DEFAULT 'auto_approved' NOT NULL,
	"approval_decided_by_membership_id" integer,
	"approval_decided_at" timestamp with time zone,
	"status" "learning_enrollment_status" DEFAULT 'assigned' NOT NULL,
	"attended" boolean,
	"attendance_marked_by_membership_id" integer,
	"attendance_marked_at" timestamp with time zone,
	"passed" boolean,
	"score" numeric(7, 2),
	"completed_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_enrollment_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"enrollment_id" integer NOT NULL,
	"employee_document_id" integer NOT NULL,
	"added_by_membership_id" integer,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"enrollment_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"course_title_snapshot" text NOT NULL,
	"certificate_number" text,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"status" "learning_certificate_status" DEFAULT 'active' NOT NULL,
	"revoked_by_membership_id" integer,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"employee_document_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "learning_courses" ADD CONSTRAINT "learning_courses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_courses" ADD CONSTRAINT "learning_courses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_course_sessions" ADD CONSTRAINT "learning_course_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_course_sessions" ADD CONSTRAINT "learning_course_sessions_course_id_learning_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."learning_courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_course_sessions" ADD CONSTRAINT "learning_course_sessions_instructor_employee_id_employees_id_fk" FOREIGN KEY ("instructor_employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_enrollments" ADD CONSTRAINT "learning_enrollments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_enrollments" ADD CONSTRAINT "learning_enrollments_course_id_learning_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."learning_courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_enrollments" ADD CONSTRAINT "learning_enrollments_session_id_learning_course_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."learning_course_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_enrollments" ADD CONSTRAINT "learning_enrollments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_enrollments" ADD CONSTRAINT "learning_enrollments_department_id_snapshot_departments_id_fk" FOREIGN KEY ("department_id_snapshot") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_enrollments" ADD CONSTRAINT "learning_enrollments_position_id_snapshot_positions_id_fk" FOREIGN KEY ("position_id_snapshot") REFERENCES "public"."positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_enrollments" ADD CONSTRAINT "learning_enrollments_manager_employee_id_snapshot_employees_id_fk" FOREIGN KEY ("manager_employee_id_snapshot") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_enrollments" ADD CONSTRAINT "learning_enrollments_assigned_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("assigned_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_enrollments" ADD CONSTRAINT "learning_enrollments_approval_decided_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("approval_decided_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_enrollments" ADD CONSTRAINT "learning_enrollments_attendance_marked_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("attendance_marked_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_enrollment_evidence" ADD CONSTRAINT "learning_enrollment_evidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_enrollment_evidence" ADD CONSTRAINT "learning_enrollment_evidence_enrollment_id_learning_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."learning_enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_enrollment_evidence" ADD CONSTRAINT "learning_enrollment_evidence_employee_document_id_employee_documents_id_fk" FOREIGN KEY ("employee_document_id") REFERENCES "public"."employee_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_enrollment_evidence" ADD CONSTRAINT "learning_enrollment_evidence_added_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("added_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_certificates" ADD CONSTRAINT "learning_certificates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_certificates" ADD CONSTRAINT "learning_certificates_enrollment_id_learning_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."learning_enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_certificates" ADD CONSTRAINT "learning_certificates_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_certificates" ADD CONSTRAINT "learning_certificates_revoked_by_membership_id_organization_memberships_id_fk" FOREIGN KEY ("revoked_by_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_certificates" ADD CONSTRAINT "learning_certificates_employee_document_id_employee_documents_id_fk" FOREIGN KEY ("employee_document_id") REFERENCES "public"."employee_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_courses_org_status_idx" ON "learning_courses" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "learning_course_sessions_org_course_idx" ON "learning_course_sessions" USING btree ("organization_id","course_id");--> statement-breakpoint
CREATE INDEX "learning_course_sessions_org_instructor_idx" ON "learning_course_sessions" USING btree ("organization_id","instructor_employee_id");--> statement-breakpoint
CREATE INDEX "learning_enrollments_org_employee_idx" ON "learning_enrollments" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "learning_enrollments_org_manager_idx" ON "learning_enrollments" USING btree ("organization_id","manager_employee_id_snapshot");--> statement-breakpoint
CREATE INDEX "learning_enrollments_org_course_status_idx" ON "learning_enrollments" USING btree ("organization_id","course_id","status");--> statement-breakpoint
CREATE INDEX "learning_enrollments_org_session_idx" ON "learning_enrollments" USING btree ("organization_id","session_id");--> statement-breakpoint
CREATE INDEX "learning_enrollment_evidence_org_enrollment_idx" ON "learning_enrollment_evidence" USING btree ("organization_id","enrollment_id");--> statement-breakpoint
CREATE INDEX "learning_certificates_org_employee_idx" ON "learning_certificates" USING btree ("organization_id","employee_id");--> statement-breakpoint
CREATE INDEX "learning_certificates_org_expires_idx" ON "learning_certificates" USING btree ("organization_id","expires_at");--> statement-breakpoint
ALTER TABLE "public"."learning_courses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."learning_course_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."learning_enrollments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."learning_enrollment_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."learning_certificates" ENABLE ROW LEVEL SECURITY;