CREATE TABLE "agentos_capability_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"expected_assignment_revision" integer NOT NULL,
	"expected_selection_hash" text NOT NULL,
	"imported_skill_id" uuid,
	"imported_version_id" uuid,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agentos_capability_decision_action_check" CHECK ("agentos_capability_decisions"."action" in ('adopt', 'refuse', 'rollback')),
	CONSTRAINT "agentos_capability_decision_pin_check" CHECK (("agentos_capability_decisions"."action" = 'refuse' and "agentos_capability_decisions"."imported_skill_id" is null and "agentos_capability_decisions"."imported_version_id" is null) or ("agentos_capability_decisions"."action" <> 'refuse' and "agentos_capability_decisions"."imported_skill_id" is not null and "agentos_capability_decisions"."imported_version_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "agentos_capability_releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"capability_key" text NOT NULL,
	"revision" integer NOT NULL,
	"name" text NOT NULL,
	"markdown" text NOT NULL,
	"content_hash" text NOT NULL,
	"evaluation_summary" text NOT NULL,
	"source_company_id" uuid NOT NULL,
	"source_skill_id" uuid NOT NULL,
	"source_version_id" uuid NOT NULL,
	"source_test_run_id" uuid NOT NULL,
	"reviewed_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agentos_capability_release_revision_uq" UNIQUE("employee_id","capability_key","revision"),
	CONSTRAINT "agentos_capability_release_revision_check" CHECK ("agentos_capability_releases"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "ai_execution_capacity_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_execution_capacity_claims" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"interactive" boolean NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"warning_at" timestamp with time zone NOT NULL,
	"warned_at" timestamp with time zone,
	"admitted_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"release_reason" text
);
--> statement-breakpoint
CREATE TABLE "ai_execution_capacity_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"max_concurrent" integer NOT NULL,
	"interactive_reserved" integer NOT NULL,
	"interactive_priority" boolean NOT NULL,
	"wait_warning_ms" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_execution_capacity_group_limits" CHECK ("ai_execution_capacity_groups"."max_concurrent" between 1 and 32 and "ai_execution_capacity_groups"."interactive_reserved" >= 0 and "ai_execution_capacity_groups"."interactive_reserved" < "ai_execution_capacity_groups"."max_concurrent" and "ai_execution_capacity_groups"."wait_warning_ms" between 1000 and 86400000 and "ai_execution_capacity_groups"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "agentos_capability_decisions" ADD CONSTRAINT "agentos_capability_decisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_capability_decisions" ADD CONSTRAINT "agentos_capability_decisions_assignment_id_agentos_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."agentos_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_capability_decisions" ADD CONSTRAINT "agentos_capability_decisions_release_id_agentos_capability_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."agentos_capability_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_capability_decisions" ADD CONSTRAINT "agentos_capability_decisions_imported_skill_id_company_skills_id_fk" FOREIGN KEY ("imported_skill_id") REFERENCES "public"."company_skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_capability_decisions" ADD CONSTRAINT "agentos_capability_decisions_imported_version_id_company_skill_versions_id_fk" FOREIGN KEY ("imported_version_id") REFERENCES "public"."company_skill_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_capability_releases" ADD CONSTRAINT "agentos_capability_releases_portfolio_id_agentos_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."agentos_portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_capability_releases" ADD CONSTRAINT "agentos_capability_releases_source_company_id_companies_id_fk" FOREIGN KEY ("source_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_capability_releases" ADD CONSTRAINT "agentos_capability_releases_source_skill_id_company_skills_id_fk" FOREIGN KEY ("source_skill_id") REFERENCES "public"."company_skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_capability_releases" ADD CONSTRAINT "agentos_capability_releases_source_version_id_company_skill_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."company_skill_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_capability_releases" ADD CONSTRAINT "agentos_capability_releases_source_test_run_id_company_skill_test_runs_id_fk" FOREIGN KEY ("source_test_run_id") REFERENCES "public"."company_skill_test_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_capability_releases" ADD CONSTRAINT "agentos_capability_release_employee_fk" FOREIGN KEY ("portfolio_id","employee_id") REFERENCES "public"."agentos_employees"("portfolio_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_execution_capacity_bindings" ADD CONSTRAINT "ai_execution_capacity_bindings_group_id_ai_execution_capacity_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."ai_execution_capacity_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_execution_capacity_bindings" ADD CONSTRAINT "ai_execution_capacity_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_execution_capacity_bindings" ADD CONSTRAINT "ai_execution_capacity_bindings_connection_id_tool_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."tool_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_execution_capacity_bindings" ADD CONSTRAINT "ai_execution_capacity_bindings_grant_id_connection_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."connection_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_execution_capacity_claims" ADD CONSTRAINT "ai_execution_capacity_claims_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_execution_capacity_claims" ADD CONSTRAINT "ai_execution_capacity_claims_group_id_ai_execution_capacity_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."ai_execution_capacity_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_execution_capacity_claims" ADD CONSTRAINT "ai_execution_capacity_claims_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agentos_capability_decision_history_idx" ON "agentos_capability_decisions" USING btree ("company_id","assignment_id","created_at");--> statement-breakpoint
CREATE INDEX "agentos_capability_release_portfolio_idx" ON "agentos_capability_releases" USING btree ("portfolio_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_execution_capacity_binding_grant_uq" ON "ai_execution_capacity_bindings" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "ai_execution_capacity_binding_group_idx" ON "ai_execution_capacity_bindings" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "ai_execution_capacity_claim_pending_idx" ON "ai_execution_capacity_claims" USING btree ("group_id","queued_at","run_id") WHERE "ai_execution_capacity_claims"."released_at" is null;--> statement-breakpoint
CREATE INDEX "ai_execution_capacity_claim_company_idx" ON "ai_execution_capacity_claims" USING btree ("company_id","run_id");