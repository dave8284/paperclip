import { z } from "zod";

// These pins are part of an explicitly reviewed adoption, not an optional
// experimental selection. Runtime resolution retains them when beta UI is off.
export const AGENTOS_CAPABILITY_SKILL_PREFIX = "agentos-capability:";
export const publishAgentosCapabilitySchema = z.object({
  id: z.uuid(), employeeId: z.uuid(),
  capabilityKey: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
  name: z.string().trim().min(1).max(120),
  expectedLatestRevision: z.number().int().nonnegative(),
  sourceCompanyId: z.uuid(), sourceSkillId: z.uuid(), sourceVersionId: z.uuid(), sourceTestRunId: z.uuid(),
  evaluationSummary: z.string().trim().min(1).max(4000),
  reviewedAndSanitized: z.literal(true),
}).strict();
export const decideAgentosCapabilitySchema = z.object({
  id: z.uuid(), releaseId: z.uuid(), action: z.enum(["adopt", "refuse", "rollback"]),
  reason: z.string().trim().min(1).max(4000),
  expectedAssignmentRevision: z.number().int().positive(),
  expectedSelectionHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type PublishAgentosCapability = z.infer<typeof publishAgentosCapabilitySchema>;
export type DecideAgentosCapability = z.infer<typeof decideAgentosCapabilitySchema>;
export interface AgentosCapabilityRelease {
  id: string; employeeId: string; capabilityKey: string; revision: number; name: string;
  markdown: string; contentHash: string; evaluationSummary: string; createdAt: string;
}
export interface AgentosCapabilityDecision {
  id: string; releaseId: string; action: "adopt" | "refuse" | "rollback"; reason: string;
  importedSkillId: string | null; importedVersionId: string | null; createdAt: string;
}
export interface AgentosCapabilityAssignment {
  assignmentId: string; companyId: string; revision: number; selectionHash: string; canManage: boolean;
  selected: Array<{ capabilityKey: string; releaseId: string; versionId: string }>;
  previouslyAdoptedReleaseIds: string[];
  decisions: AgentosCapabilityDecision[];
}
export interface AgentosCapabilities {
  releases: AgentosCapabilityRelease[]; assignments: AgentosCapabilityAssignment[];
  canPublish: boolean;
  releaseOffset: number;
  hasMoreReleases: boolean;
  latestRevisions: Record<string, number>;
}
