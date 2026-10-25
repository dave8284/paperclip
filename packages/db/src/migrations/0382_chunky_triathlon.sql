CREATE TABLE "agentos_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"department" text,
	"status" text DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"retirement_reason" text,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agentos_assignments_agent_uq" UNIQUE("agent_id"),
	CONSTRAINT "agentos_assignments_status_check" CHECK ("agentos_assignments"."status" in ('active', 'retired')),
	CONSTRAINT "agentos_assignments_retirement_check" CHECK (("agentos_assignments"."status" = 'active' and "agentos_assignments"."retired_at" is null and "agentos_assignments"."retirement_reason" is null) or ("agentos_assignments"."status" = 'retired' and "agentos_assignments"."retired_at" is not null and length("agentos_assignments"."retirement_reason") > 0))
);
--> statement-breakpoint
CREATE TABLE "agentos_employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"name" text NOT NULL,
	"specialty" text DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agentos_employees_portfolio_id_uq" UNIQUE("portfolio_id","id")
);
--> statement-breakpoint
CREATE TABLE "agentos_portfolio_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agentos_portfolio_companies_company_uq" UNIQUE("company_id"),
	CONSTRAINT "agentos_portfolio_companies_membership_uq" UNIQUE("portfolio_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "agentos_portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"home_company_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agentos_assignments" ADD CONSTRAINT "agentos_assignments_employee_fk" FOREIGN KEY ("portfolio_id","employee_id") REFERENCES "public"."agentos_employees"("portfolio_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_assignments" ADD CONSTRAINT "agentos_assignments_company_fk" FOREIGN KEY ("portfolio_id","company_id") REFERENCES "public"."agentos_portfolio_companies"("portfolio_id","company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_assignments" ADD CONSTRAINT "agentos_assignments_agent_fk" FOREIGN KEY ("company_id","agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_employees" ADD CONSTRAINT "agentos_employees_portfolio_id_agentos_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."agentos_portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_portfolio_companies" ADD CONSTRAINT "agentos_portfolio_companies_portfolio_id_agentos_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."agentos_portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_portfolio_companies" ADD CONSTRAINT "agentos_portfolio_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_portfolios" ADD CONSTRAINT "agentos_portfolios_home_company_id_companies_id_fk" FOREIGN KEY ("home_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agentos_assignments_active_employee_uq" ON "agentos_assignments" USING btree ("employee_id","company_id") WHERE "agentos_assignments"."status" = 'active';--> statement-breakpoint
CREATE INDEX "agentos_assignments_company_idx" ON "agentos_assignments" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE INDEX "agentos_employees_portfolio_idx" ON "agentos_employees" USING btree ("portfolio_id");--> statement-breakpoint
CREATE INDEX "agentos_portfolios_owner_idx" ON "agentos_portfolios" USING btree ("owner_user_id");