CREATE TYPE "public"."module_status" AS ENUM('active', 'beta', 'hidden', 'deprecated');--> statement-breakpoint
CREATE TABLE "modules" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" varchar(64) NOT NULL,
	"version" varchar(32) DEFAULT '1.0.0' NOT NULL,
	"status" "module_status" DEFAULT 'hidden' NOT NULL,
	"default_enabled" boolean DEFAULT false NOT NULL,
	"required_module_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"optional_module_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "modules_key_unique" ON "modules" USING btree ("key");