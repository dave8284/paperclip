CREATE TABLE "managed_application_projects" (
	"company_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "managed_application_projects_application_id_project_id_pk" PRIMARY KEY("application_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "managed_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"home_project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"brief" text NOT NULL,
	"source" text NOT NULL,
	"stage" text DEFAULT 'discovery' NOT NULL,
	"creation_key" text NOT NULL,
	"creation_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "managed_applications_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "managed_applications_creation_key_uq" UNIQUE("company_id","creation_key"),
	CONSTRAINT "managed_applications_home_project_uq" UNIQUE("company_id","home_project_id"),
	CONSTRAINT "managed_applications_stage_check" CHECK ("managed_applications"."stage" in ('discovery', 'building', 'operating', 'archived')),
	CONSTRAINT "managed_applications_source_check" CHECK ("managed_applications"."source" in ('existing', 'new'))
);
--> statement-breakpoint
ALTER TABLE "managed_application_projects" ADD CONSTRAINT "managed_application_projects_company_id_application_id_managed_applications_company_id_id_fk" FOREIGN KEY ("company_id","application_id") REFERENCES "public"."managed_applications"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_application_projects" ADD CONSTRAINT "managed_application_projects_company_id_project_id_projects_company_id_id_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."projects"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_applications" ADD CONSTRAINT "managed_applications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_applications" ADD CONSTRAINT "managed_applications_company_id_home_project_id_projects_company_id_id_fk" FOREIGN KEY ("company_id","home_project_id") REFERENCES "public"."projects"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "managed_application_projects_project_idx" ON "managed_application_projects" USING btree ("company_id","project_id");--> statement-breakpoint
CREATE INDEX "managed_applications_company_idx" ON "managed_applications" USING btree ("company_id","id");