CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(64) NOT NULL,
	"label" varchar(128) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" varchar(64) NOT NULL,
	"required_permission_key" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reports_key_unique" ON "reports" USING btree ("key");