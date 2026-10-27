export interface Candidate { id: string; provider: string; model: string; method: "subscription"; available: true }
export interface SelectionInput { namespace: string; requestId: string; taskKey: string; taskType: string; complexity: "routine" | "complex"; defaultCandidateId: string; candidates: Candidate[]; contextFingerprint?: string; promptFingerprint?: string; pinTask?: boolean }
export interface SelectionReceipt { id: string; namespace: string; taskKey: string; taskType: string; complexity: string; candidate: Omit<Candidate,"available">; policyVersion: string; reason: string; evidence: { evaluations: number; passed: number; lowerBound: number; medianLatencyMs: number | null; medianIterations: number | null; recentFailures: number }; contextFingerprint: string | null; promptFingerprint: string | null; createdAt: string }
export interface EvaluationInput { namespace: string; id: string; receiptId: string; passed: boolean; iterations: number; latencyMs: number; source: "human" | "checks"; evidenceRef: string; evaluator: string }
export interface PolicyInput { namespace: string; candidateId: string; action: "block" | "restore"; reason: string }
export interface PolicyEvent extends PolicyInput { id: string; createdAt: string }
export interface Analytics { policyVersion: string; counts: { selections: number; evaluations: number; policyEvents: number }; receipts: SelectionReceipt[]; evaluations: Array<EvaluationInput & { createdAt: string }>; events: PolicyEvent[] }
export interface ModelIntelligence { select(input: SelectionInput): SelectionReceipt; evaluate(input: EvaluationInput): EvaluationInput; policy(input: PolicyInput): PolicyEvent; analytics(namespace?: string): Analytics; close(): void }
export const POLICY_VERSION: string;
export function createModelIntelligence(path: string): ModelIntelligence;
