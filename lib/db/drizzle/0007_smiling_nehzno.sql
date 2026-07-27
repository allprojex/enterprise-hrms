CREATE TYPE "public"."department_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."position_status" AS ENUM('active', 'inactive');--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "status" "department_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "status" "position_status" DEFAULT 'active' NOT NULL;