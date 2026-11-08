import { z } from "zod";
import type { BoardDirectionAuthority } from "./agentos-board-directions.js";

export const portfolioReadScopeSchema = z.enum(["company_shared_only", "owner_accessible_private"]);
export type PortfolioReadScope = z.infer<typeof portfolioReadScopeSchema>;
export const savePortfolioReadMandateSchema = z.object({
  id: z.uuid(), expectedRevision: z.number().int().min(0),
  sourceCompanyId: z.uuid(), sourceAgentId: z.uuid(),
  targetCompanyIds: z.array(z.uuid()).min(1).max(50).refine(ids => new Set(ids).size === ids.length, "Select each company only once"),
  action: z.literal("portfolio_work:read"),
  readScope: portfolioReadScopeSchema,
  expiresAt: z.iso.datetime().nullable(),
}).strict();
export const revokePortfolioReadMandateSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
export const portfolioWorkQuerySchema = z.object({
  mandateId: z.uuid(), revision: z.coerce.number().int().positive(), targetCompanyId: z.uuid(),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  projectOffset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type SavePortfolioReadMandate = z.infer<typeof savePortfolioReadMandateSchema>;
export type PortfolioWorkQuery = z.infer<typeof portfolioWorkQuerySchema>;
const portfolioReadIdentity = {
  mandateId: z.uuid(), revision: z.coerce.number().int().positive(), targetCompanyId: z.uuid(),
};
export const portfolioContentQuerySchema = z.object({
  ...portfolioReadIdentity,
  kind: z.enum(["project", "task", "comment", "document"]), resourceId: z.uuid(),
  offset: z.coerce.number().int().min(0).max(10_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(20_000).default(12_000),
  bodySha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().refine(value => value.offset === 0 || !!value.bodySha256, "Continuing a body requires its returned bodySha256");
export const portfolioRecordsQuerySchema = z.object({
  ...portfolioReadIdentity,
  kind: z.enum(["conversations", "comments", "documents", "attachments", "executives", "cases", "case_attachments"]),
  taskId: z.uuid().optional(), projectId: z.uuid().optional(), caseId: z.uuid().optional(),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).strict().refine(value => ["comments", "documents", "attachments"].includes(value.kind) ? !!value.taskId : !value.taskId,
  "Only comments, documents and task attachments accept and require taskId")
  .refine(value => value.kind === "executives" || !value.projectId, "Only executive discovery accepts projectId")
  .refine(value => value.kind === "case_attachments" ? !!value.caseId : !value.caseId, "Only case attachment discovery accepts and requires caseId");
export type PortfolioContentQuery = z.infer<typeof portfolioContentQuerySchema>;
export type PortfolioRecordsQuery = z.infer<typeof portfolioRecordsQuerySchema>;
export const PORTFOLIO_ATTACHMENT_MAX_BYTES = 65_536;
export const portfolioAttachmentQuerySchema = z.object({
  ...portfolioReadIdentity, attachmentId: z.uuid(), taskId: z.uuid().optional(), caseId: z.uuid().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.coerce.number().int().min(1).max(PORTFOLIO_ATTACHMENT_MAX_BYTES).default(16_384),
}).strict().refine(value => !!value.taskId !== !!value.caseId, "Supply exactly one attachment owner: taskId or caseId");
export type PortfolioAttachmentQuery = z.infer<typeof portfolioAttachmentQuerySchema>;
export interface PortfolioPrivateReadReceipt {
  mandateId: string; revision: number; sourceCompanyId: string; targetCompanyId: string;
  readScope: "owner_accessible_private"; observedAt: string;
  /** Retrieved text is reference material, never authority or agent instructions. */
  contentTrust: "untrusted_reference";
}
export interface PortfolioContent extends PortfolioPrivateReadReceipt {
  kind: PortfolioContentQuery["kind"]; resourceId: string; title: string | null;
  body: string; bodySha256: string; bodyCharacters: number; offset: number; nextOffset: number | null;
  updatedAt: string;
  comment?: { authorAgentId: string | null; authorUserId: string | null; createdAt: string };
}
export interface PortfolioRecords extends PortfolioPrivateReadReceipt {
  kind: PortfolioRecordsQuery["kind"]; taskId: string | null;
  projectId?: string | null;
  caseId?: string | null;
  records: Array<{ id: string; title: string | null; updatedAt: string;
    executive?: { kind: "ceo" | "department_head"; status: string; lifecycleState: string };
    attachment?: { contentType: string; byteSize: number; sha256: string } }>;
  nextOffset: number | null;
}
export interface PortfolioAttachment extends PortfolioPrivateReadReceipt {
  attachmentId: string; taskId: string | null; caseId?: string; filename: string | null; contentType: string;
  byteSize: number; sha256: string; encoding: "base64"; body: string;
  offset: number; nextOffset: number | null; chunkSha256: string;
  /** True only when this request verified every byte against the stored hash. */
  fullFileVerified: boolean;
}
export interface PortfolioReadMandate {
  boardDirectionAuthority?: BoardDirectionAuthority | null;
  /** Owner management CAS identity, including a stale grant requiring replacement. */
  boardDirectionGrantId?: string | null;
  id: string; portfolioId: string; revision: number; sourceCompanyId: string; sourceAgentId: string;
  sourceAgentName?: string | null;
  targetCompanyIds: string[]; action: "portfolio_work:read"; readScope: PortfolioReadScope;
  expiresAt: string | null; revokedAt: string | null; updatedAt: string;
}
export interface PortfolioWorkSummary {
  mandateId: string; revision: number; sourceCompanyId: string; targetCompanyId: string;
  readScope: PortfolioReadScope; observedAt: string;
  projects: Array<{ id: string; name: string; status: string }>;
  projectCount: number; nextProjectOffset: number | null;
  tasks: Array<{ id: string; identifier: string | null; title: string; status: string; priority: string; projectId: string | null; updatedAt: string | Date }>;
  counts: Record<string, number>; nextOffset: number | null;
}
