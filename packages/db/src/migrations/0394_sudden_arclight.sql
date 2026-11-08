CREATE TABLE "agentos_board_directions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_company_id" uuid NOT NULL,
	"source_agent_id" uuid NOT NULL,
	"source_run_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"authorizing_user_id" text,
	"mandate_id" uuid NOT NULL,
	"mandate_revision" integer NOT NULL,
	"grant_id" uuid NOT NULL,
	"target_company_id" uuid NOT NULL,
	"executive_agent_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"expected_issue_status_version" integer NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"input_fingerprint" text NOT NULL,
	"wakeup_request_id" uuid NOT NULL,
	"dispatch_state" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	CONSTRAINT "agentos_board_directions_intent_uq" UNIQUE("source_company_id","source_agent_id","idempotency_key"),
	CONSTRAINT "agentos_board_directions_wake_uq" UNIQUE("wakeup_request_id"),
	CONSTRAINT "agentos_board_directions_state_check" CHECK ("agentos_board_directions"."dispatch_state" in ('pending', 'dispatched', 'cancelled') and "agentos_board_directions"."mandate_revision" > 0 and "agentos_board_directions"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "agentos_board_directions" ADD CONSTRAINT "agentos_board_directions_source_company_id_companies_id_fk" FOREIGN KEY ("source_company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_board_directions" ADD CONSTRAINT "agentos_board_directions_source_fk" FOREIGN KEY ("source_company_id","source_agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_board_directions" ADD CONSTRAINT "agentos_board_directions_task_fk" FOREIGN KEY ("target_company_id","issue_id") REFERENCES "public"."issues"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_board_directions" ADD CONSTRAINT "agentos_board_directions_executive_fk" FOREIGN KEY ("target_company_id","executive_agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agentos_board_directions_due_idx" ON "agentos_board_directions" USING btree ("next_attempt_at","id") WHERE "agentos_board_directions"."dispatch_state" = 'pending';