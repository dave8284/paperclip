CREATE TABLE "company_operating_profiles" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"friday_agent_id" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "managed_applications" ADD COLUMN "kind" text DEFAULT 'application' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_operating_profiles" ADD CONSTRAINT "company_operating_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_operating_profiles" ADD CONSTRAINT "company_operating_profiles_company_id_friday_agent_id_agents_company_id_id_fk" FOREIGN KEY ("company_id","friday_agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_applications" ADD CONSTRAINT "managed_applications_kind_check" CHECK ("managed_applications"."kind" in ('application', 'platform'));