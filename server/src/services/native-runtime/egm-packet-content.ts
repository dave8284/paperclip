import { createHash } from "node:crypto";
import { z } from "zod";
import { EGM_PACKET_LIMITS, prepareEgmPacketSchema, type PrepareEgmPacket } from "@paperclipai/shared";
import type { Db } from "@paperclipai/db";
import { documentService } from "../documents.js";
import { getCatalogPackageMetadata, getCatalogSkillOrThrow, readCatalogSkillFile } from "../skills-catalog.js";
import { conflict, notFound, unprocessable } from "../../errors.js";
import { egmCreatorAuthoritySchema, type EgmCreatorAuthority } from "./egm-packet-authority.js";

const skillKey = "paperclipai/bundled/paperclip-operations/agentos-context-review";
const standards = { zoom_out: "zoom-out-standard", comprehension: "re-implementation-standard", design_critic: "feature-spec-standard", implementation_readiness: "implementation-readiness-standard" } as const;
export const egmDigest = (text: string) => createHash("sha256").update(text).digest("hex");
export function canonicalEgmJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalEgmJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalEgmJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const frozenDocumentSchema = z.object({ documentId: z.string().uuid(), revisionId: z.string().uuid(), key: z.string(), revisionNumber: z.number().int().positive(), body: z.string(), sha256: hash }).strict();
const packagedTextSchema = z.object({ path: z.string(), body: z.string(), sha256: hash }).strict();
export const egmPacketPreparationSchema = z.object({
  schema: z.literal("agentos.egm-packet-preparation.v1"),
  companyId: z.string().uuid(), issueId: z.string().uuid(), sourceRunId: z.string().uuid(), authorAgentId: z.string().uuid(),
  preparedBy: z.discriminatedUnion("type", [z.object({ type: z.literal("agent"), id: z.string().uuid() }).strict(), z.object({ type: z.literal("user"), id: z.string().min(1) }).strict()]),
  creatorAuthority: egmCreatorAuthoritySchema,
  request: prepareEgmPacketSchema, requestSha256: hash,
  packet: frozenDocumentSchema, target: frozenDocumentSchema, sources: z.array(frozenDocumentSchema).max(EGM_PACKET_LIMITS.sourceCount),
  persona: packagedTextSchema, standard: packagedTextSchema,
  bundle: z.object({ key: z.literal(skillKey), packageVersion: z.string(), contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/) }).strict(),
  preparedAt: z.string().datetime(),
  execution: z.literal("independent_review_unavailable"),
}).strict();
export type EgmPacketPreparation = z.infer<typeof egmPacketPreparationSchema>;

export function parseRetainedEgmPacket(value: unknown): EgmPacketPreparation {
  const parsed = egmPacketPreparationSchema.safeParse(value);
  if (!parsed.success) throw conflict("Saved EGM packet preparation is invalid");
  const packet = parsed.data;
  if ((packet.preparedBy.type === "agent" && (packet.creatorAuthority.type !== "agent" || packet.creatorAuthority.agentId !== packet.preparedBy.id || packet.authorAgentId !== packet.preparedBy.id))
    || (packet.preparedBy.type === "user" && (packet.creatorAuthority.type !== "board" || packet.creatorAuthority.userId !== packet.preparedBy.id)))
    throw conflict("Saved EGM creator authority does not match");
  const { requestSha256, preparedAt: _time, execution: _state, ...content } = packet;
  if (egmDigest(canonicalEgmJson(content)) !== requestSha256
    || [...packet.sources, packet.packet, packet.target, packet.persona, packet.standard].some(source => egmDigest(source.body) !== source.sha256))
    throw conflict("Saved EGM packet preparation digest does not match");
  return packet;
}

/** Caller must authorize the owning task for both author and named reviewer.
 * Every source stays in that task; no cross-project reference grants are added. */
export async function readEgmPacketDocuments(db: Db, input: {
  companyId: string; issueId: string; request: PrepareEgmPacket; requireCurrent: boolean;
}) {
  const refs = [input.request.packet, input.request.target, ...input.request.sources];
  if (new Set(refs.map(ref => ref.documentId)).size !== refs.length) throw unprocessable("EGM packet documents must be distinct");
  const service = documentService(db);
  const documents = await Promise.all(refs.map(ref => service.getIssueDocumentRevision({ ...ref, companyId: input.companyId, issueId: input.issueId, maxBodyBytes: EGM_PACKET_LIMITS.documentBytes, lock: input.requireCurrent })));
  if (documents.some(row => !row)) throw notFound("EGM source unavailable or exceeds the document size limit");
  const present = documents.map(row => row!);
  if (present[0].key !== "context-packet" || present[1].key !== "plan") throw unprocessable("EGM preparation requires the context-packet and plan documents");
  if (input.requireCurrent && present.slice(0, 2).some(row => row.latestRevisionId !== row.revisionId)) throw conflict("The packet or plan has a newer revision; prepare that revision explicitly");
  const total = present.reduce((sum, row) => sum + Buffer.byteLength(row.body), 0);
  if (total > EGM_PACKET_LIMITS.totalBytes) throw unprocessable("EGM packet exceeds the total size limit");
  const frozen = present.map(row => ({ documentId: row.documentId, revisionId: row.revisionId, key: row.key, revisionNumber: row.revisionNumber, body: row.body, sha256: egmDigest(row.body) }));
  return { packet: frozen[0], target: frozen[1], sources: frozen.slice(2) };
}

export async function prepareEgmPacketContent(db: Db, input: {
  companyId: string; issueId: string; sourceRunId: string; authorAgentId: string; request: PrepareEgmPacket;
  preparedBy: EgmPacketPreparation["preparedBy"];
  creatorAuthority: EgmCreatorAuthority;
}): Promise<EgmPacketPreparation> {
  const request = prepareEgmPacketSchema.parse(input.request);
  const documents = await readEgmPacketDocuments(db, { ...input, request, requireCurrent: true });
  const skill = getCatalogSkillOrThrow(skillKey);
  const paths = [`references/upstream/agents/${request.persona}.md`, `references/upstream/resources/document_standards/${standards[request.persona]}.md`];
  const packaged = await Promise.all(paths.map(async path => {
    const entry = skill.files.find(file => file.path === path);
    if (!entry || entry.sizeBytes > EGM_PACKET_LIMITS.documentBytes) throw conflict("The selected packaged EGM source is unavailable");
    const source = await readCatalogSkillFile(skillKey, path);
    const sha256 = egmDigest(source.content);
    if (sha256 !== entry.sha256 || Buffer.byteLength(source.content) !== entry.sizeBytes) throw conflict("The selected EGM package does not match its catalog digest");
    return { path, body: source.content, sha256 };
  }));
  const content = { schema: "agentos.egm-packet-preparation.v1" as const, companyId: input.companyId, issueId: input.issueId,
    sourceRunId: input.sourceRunId, authorAgentId: input.authorAgentId, preparedBy: input.preparedBy, creatorAuthority: input.creatorAuthority, request, ...documents,
    persona: packaged[0], standard: packaged[1], bundle: { key: skillKey, packageVersion: getCatalogPackageMetadata().packageVersion, contentHash: skill.contentHash } };
  if (Buffer.byteLength(canonicalEgmJson(content)) > EGM_PACKET_LIMITS.totalBytes) throw unprocessable("EGM packet including standards exceeds the total size limit");
  return egmPacketPreparationSchema.parse({ ...content, requestSha256: egmDigest(canonicalEgmJson(content)), preparedAt: new Date().toISOString(), execution: "independent_review_unavailable" });
}

export async function revalidateEgmPacketSources(db: Db, packet: EgmPacketPreparation) {
  const current = await readEgmPacketDocuments(db, { ...packet, requireCurrent: false });
  if (canonicalEgmJson(current) !== canonicalEgmJson({ packet: packet.packet, target: packet.target, sources: packet.sources }))
    throw conflict("The exact retained EGM sources are no longer available");
}
