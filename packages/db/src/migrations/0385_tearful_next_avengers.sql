CREATE TABLE "agentos_department_projects" (
	"company_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	CONSTRAINT "agentos_department_projects_company_id_project_id_pk" PRIMARY KEY("company_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "agentos_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agentos_departments_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "agentos_departments_name_uq" UNIQUE("company_id","name")
);
--> statement-breakpoint
ALTER TABLE "agentos_department_projects" ADD CONSTRAINT "agentos_department_projects_company_id_department_id_agentos_departments_company_id_id_fk" FOREIGN KEY ("company_id","department_id") REFERENCES "public"."agentos_departments"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_department_projects" ADD CONSTRAINT "agentos_department_projects_company_id_project_id_projects_company_id_id_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."projects"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_departments" ADD CONSTRAINT "agentos_departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;