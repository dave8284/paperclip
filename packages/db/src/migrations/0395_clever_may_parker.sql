ALTER TABLE "connection_grants" ADD CONSTRAINT "connection_grants_company_connection_id_uq" UNIQUE("company_id","connection_id","id");
--> statement-breakpoint
CREATE TABLE "ai_workspace_account_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_workspace_account_links_account_company_uq" UNIQUE("account_id","company_id"),
	CONSTRAINT "ai_workspace_account_links_grant_uq" UNIQUE("grant_id"),
	CONSTRAINT "ai_workspace_account_links_connection_uq" UNIQUE("connection_id"),
	CONSTRAINT "ai_workspace_account_links_revision_check" CHECK ("ai_workspace_account_links"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "ai_workspace_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"source_company_id" uuid NOT NULL,
	"source_connection_id" uuid NOT NULL,
	"source_grant_id" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"auto_install" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_workspace_accounts_source_grant_uq" UNIQUE("source_grant_id"),
	CONSTRAINT "ai_workspace_accounts_revision_check" CHECK ("ai_workspace_accounts"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "ai_workspace_account_links" ADD CONSTRAINT "ai_workspace_account_links_account_id_ai_workspace_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ai_workspace_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_workspace_account_links" ADD CONSTRAINT "ai_workspace_account_links_target_fk" FOREIGN KEY ("company_id","connection_id","grant_id") REFERENCES "public"."connection_grants"("company_id","connection_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_workspace_accounts" ADD CONSTRAINT "ai_workspace_accounts_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_workspace_accounts" ADD CONSTRAINT "ai_workspace_accounts_source_fk" FOREIGN KEY ("source_company_id","source_connection_id","source_grant_id") REFERENCES "public"."connection_grants"("company_id","connection_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_workspace_account_links_company_idx" ON "ai_workspace_account_links" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ai_workspace_accounts_owner_idx" ON "ai_workspace_accounts" USING btree ("owner_user_id");
