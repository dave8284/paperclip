import { z } from "zod";

export const EGM_PACKET_LIMITS = { sourceCount: 8, documentBytes: 65_536, totalBytes: 262_144 } as const;
export const egmDocumentReferenceSchema = z.object({ documentId: z.string().uuid(), revisionId: z.string().uuid() }).strict();
export const prepareEgmPacketSchema = z.object({
  reviewerAgentId: z.string().uuid(),
  packet: egmDocumentReferenceSchema,
  target: egmDocumentReferenceSchema,
  sources: z.array(egmDocumentReferenceSchema).max(EGM_PACKET_LIMITS.sourceCount).default([]),
  persona: z.enum(["zoom_out", "comprehension", "design_critic", "implementation_readiness"]),
  question: z.string().trim().min(1).max(2000),
}).strict();
export const clearEgmPacketSchema = z.object({ requestSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const egmPacketBindingSchema = z.object({
  schema: z.literal("agentos.egm-review-binding.v1"),
  sourceRunId: z.string().uuid(),
  requestSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type PrepareEgmPacket = z.infer<typeof prepareEgmPacketSchema>;
export type EgmPacketBinding = z.infer<typeof egmPacketBindingSchema>;
