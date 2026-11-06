CREATE TABLE "model_profile_qualifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"review_decision_id" uuid,
	"request_key" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"state" text NOT NULL,
	"account_fingerprint" text NOT NULL,
	"profile" jsonb NOT NULL,
	"evidence_fingerprint" text NOT NULL,
	"observed_provider_version" text NOT NULL,
	"observed_model" text NOT NULL,
	"observed_effort" text,
	"observed_at" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"qualified_by_user_id" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_profile_qualification_state_check" CHECK ("model_profile_qualifications"."state" in ('access_verified','workflow_qualified') and "model_profile_qualifications"."valid_until" > "model_profile_qualifications"."observed_at")
);
--> statement-breakpoint
ALTER TABLE "model_profile_qualifications" ADD CONSTRAINT "model_profile_qualifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_profile_qualifications" ADD CONSTRAINT "model_profile_qualifications_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_profile_qualifications" ADD CONSTRAINT "model_profile_qualifications_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_profile_qualifications" ADD CONSTRAINT "model_profile_qualifications_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_profile_qualifications" ADD CONSTRAINT "model_profile_qualifications_review_decision_id_issue_execution_decisions_id_fk" FOREIGN KEY ("review_decision_id") REFERENCES "public"."issue_execution_decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_profile_qualification_request_uq" ON "model_profile_qualifications" USING btree ("company_id","request_key");--> statement-breakpoint
CREATE INDEX "model_profile_qualification_candidates_idx" ON "model_profile_qualifications" USING btree ("company_id","agent_id","account_fingerprint","valid_until");