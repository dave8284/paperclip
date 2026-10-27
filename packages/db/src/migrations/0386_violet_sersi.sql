CREATE TABLE "company_performance_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"period" text NOT NULL,
	"currency" text,
	"basis" text NOT NULL,
	"values" jsonb NOT NULL,
	"revenue_complete" boolean DEFAULT false NOT NULL,
	"costs_complete" boolean DEFAULT false NOT NULL,
	"source_label" text NOT NULL,
	"evidence_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_performance_reports" ADD CONSTRAINT "company_performance_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_performance_reports" ADD CONSTRAINT "company_performance_reports_company_id_project_id_projects_company_id_id_fk" FOREIGN KEY ("company_id","project_id") REFERENCES "public"."projects"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_performance_period_idx" ON "company_performance_reports" USING btree ("company_id","period","project_id");