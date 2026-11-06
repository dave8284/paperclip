CREATE TABLE "agentos_portfolio_mandates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"owner_user_id" text NOT NULL,
	"source_company_id" uuid NOT NULL,
	"source_agent_id" uuid NOT NULL,
	"grant_id" uuid,
	"target_company_ids" jsonb NOT NULL,
	"action" text NOT NULL,
	"read_scope" text NOT NULL,
	"revision" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agentos_portfolio_mandates_delegate_uq" UNIQUE("source_agent_id"),
	CONSTRAINT "agentos_portfolio_mandates_scope_check" CHECK ("agentos_portfolio_mandates"."action" = 'portfolio_work:read' and "agentos_portfolio_mandates"."read_scope" = 'company_shared_only' and "agentos_portfolio_mandates"."revision" > 0 and jsonb_typeof("agentos_portfolio_mandates"."target_company_ids") = 'array' and jsonb_array_length("agentos_portfolio_mandates"."target_company_ids") between 1 and 50)
);
--> statement-breakpoint
ALTER TABLE "agentos_portfolio_mandates" ADD CONSTRAINT "agentos_portfolio_mandates_portfolio_id_agentos_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."agentos_portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_portfolio_mandates" ADD CONSTRAINT "agentos_portfolio_mandates_grant_id_principal_permission_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."principal_permission_grants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_portfolio_mandates" ADD CONSTRAINT "agentos_portfolio_mandates_source_fk" FOREIGN KEY ("portfolio_id","source_company_id") REFERENCES "public"."agentos_portfolio_companies"("portfolio_id","company_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agentos_portfolio_mandates" ADD CONSTRAINT "agentos_portfolio_mandates_agent_fk" FOREIGN KEY ("source_company_id","source_agent_id") REFERENCES "public"."agents"("company_id","id") ON DELETE cascade ON UPDATE no action;