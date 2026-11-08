export interface Candidate { id: string; provider: string; model: string; method: "subscription"; available: true; variant?: ComparisonVariant }
export interface ComparisonSelectionBinding { comparisonId: string; caseId: string; arm: "baseline" | "candidate"; inputDigest: string; checkDigest: string }
export interface SelectionInput { namespace: string; requestId: string; taskKey: string; taskType: string; complexity: "routine" | "complex"; defaultCandidateId: string; candidates: Candidate[]; contextFingerprint?: string; promptFingerprint?: string; pinTask?: boolean; comparisonBinding?: ComparisonSelectionBinding }
export interface SelectionReceipt { id: string; namespace: string; taskKey: string; taskType: string; complexity: string; candidate: Omit<Candidate,"available">; policyVersion: string; reason: string; evidence: { evaluations: number; passed: number; lowerBound: number; medianLatencyMs: number | null; medianIterations: number | null; recentFailures: number }; contextFingerprint: string | null; promptFingerprint: string | null; createdAt: string; comparisonBinding?: ComparisonSelectionBinding; rollout?: RoutingAssignment }
export interface EvaluationInput { namespace: string; id: string; receiptId: string; passed: boolean; iterations: number; latencyMs: number; source: "human" | "checks"; evidenceRef: string; evaluator: string }
export interface PolicyInput { namespace: string; candidateId: string; action: "block" | "restore"; reason: string }
export interface PolicyEvent extends PolicyInput { id: string; createdAt: string }
export interface TaskFamily { id: string; name: string; signals: string; checks: string }
export function taskFamilyCatalog(): TaskFamily[];
export interface LearningProfile { namespace: string; taskType: string; candidate: SelectionReceipt["candidate"]; selections: number; evidence: SelectionReceipt["evidence"]; blocked: boolean; qualityQualified: boolean; gaps: string[]; promptFingerprint: string | null; lastSelectedAt: string }
export function classifyWork(title: string, description: string | null): { taskType: string; complexity: "routine" | "complex" };
export interface Analytics { profiles: LearningProfile[]; taskFamilies: TaskFamily[]; qualification: { minimumReviews: number; qualityConfidence: number; maximumMedianIterations: number; minimumLatencyImprovement: number; evidenceWindow: number; classifier: string }; policyVersion: string; counts: { selections: number; evaluations: number; policyEvents: number }; receipts: SelectionReceipt[]; evaluations: Array<EvaluationInput & { createdAt: string }>; events: PolicyEvent[] }
export interface ComparisonCase { id: string; split: "training" | "holdout"; inputDigest: string; checkDigest: string; sourceRef: string }
export interface DatasetInput { namespace: string; id: string; version: string; taskFamily: string; taskFamilyVersion: string; complexity: "routine" | "complex"; provenance: "observed" | "synthetic"; cases: ComparisonCase[] }
export interface ComparisonVariant { profileId: string; provider: string; model: string; modelVersion: string; reasoningEffort: string; method: "subscription"; harnessFingerprint: string; promptFingerprint: string; contextFingerprint: string }
export interface ComparisonThresholds { minimumHoldoutPairs: number; qualityLowerBound: number; maximumMedianIterations: number; minimumLatencyImprovement: number }
export interface ComparisonInput { namespace: string; id: string; datasetId: string; datasetVersion: string; dimension: "model" | "prompt" | "context"; baseline: ComparisonVariant; candidate: ComparisonVariant; thresholds: ComparisonThresholds }
export interface ComparisonOutcomeInput { namespace: string; id: string; comparisonId: string; caseId: string; arm: "baseline" | "candidate"; attempt: number; receiptId: string; inputDigest: string; checkDigest: string; observedVariant: ComparisonVariant | null; provenance: "observed" | "synthetic"; outcome: "passed" | "failed" | "cancelled" | "unknown"; terminal: boolean; iterations: number | null; latencyMs: number | null; source: "human" | "checks"; evaluator: string; evidenceRef: string }
export interface ComparisonArmReport { attempts: Array<ComparisonOutcomeInput & { createdAt: string }>; terminal: boolean; outcome: ComparisonOutcomeInput["outcome"] | "missing"; latencyMs: number | null; iterations: number | null }
export interface ComparisonSummary { cases: number; completed: number; passed: number; firstPass: number; failedAttempts: number; lowerBound: number; medianIterations: number | null; medianAcceptedLatencyMs: number | null }
export interface ComparisonReport { policyVersion: string; comparison: ComparisonInput & { createdAt: string }; dataset: Pick<DatasetInput, "id" | "version" | "taskFamily" | "taskFamilyVersion" | "provenance">; status: "not_ready" | "eligible_for_canary"; evidenceTrust: "host_attested"; productionImprovementProven: false; blockers: string[]; baseline: ComparisonSummary; candidate: ComparisonSummary; acceptedPairs: number; latencyImprovement: number | null; cases: Array<{ caseId: string; split: ComparisonCase["split"]; exposedToTraining: boolean; baseline: ComparisonArmReport; candidate: ComparisonArmReport }>; limitations: string[] }
export interface ComparisonDefinition { comparison: ComparisonInput & { createdAt: string }; dataset: DatasetInput }
export interface RoutingLimits {
  canaryPercent: number; maximumPending: number; minimumObservations: number; observationTimeoutMs: number;
  qualityLowerBound: number; maximumMedianIterations: number; minimumLatencyImprovement: number;
}
export interface RoutingPolicyInput {
  namespace: string; id: string; taskType: string; expectedRevision: number; mode: "off" | "automatic" | "pinned";
  pinnedReleaseId: string | null; limits: RoutingLimits; reason: string;
}
export interface RoutingPolicy extends RoutingPolicyInput { revision: number; createdAt: string }
export interface RoutingReleaseInput { namespace: string; id: string; comparisonId: string; expectedPolicyRevision: number; reason: string }
export interface RoutingRelease extends RoutingReleaseInput {
  policyVersion: string; taskType: string; taskFamilyVersion: string; version: number; parentReleaseId: string | null;
  rootBaseline: ComparisonVariant; baseline: ComparisonVariant; candidate: ComparisonVariant; limits: RoutingLimits;
  excludedInputs: string[]; comparisonEvidenceSha256: string; state: "canary" | "adopted" | "rolled_back"; createdAt: string;
}
export interface RoutingAssignment {
  releaseId: string; releaseVersion: number; policyRevision: number; phase: "canary" | "adopted";
  arm: "baseline" | "candidate"; assignmentId: string | null;
}
export interface RoutingOutcomeInput {
  namespace: string; id: string; receiptId: string; outcome: "passed" | "failed" | "cancelled" | "unknown";
  observedVariant: ComparisonVariant | null; iterations: number | null; latencyMs: number | null;
  source: "human" | "checks"; evidenceRef: string; evaluator: string;
}
export interface RoutingRolloutReport {
  policy: RoutingPolicy | null; releases: RoutingRelease[];
  events: Array<{ id: string; releaseId: string | null; action: string; reason: string; createdAt: string }>;
}
export interface RoutingStore {
  subscribeRoutingWork(listener: () => void): () => void;
  nextRoutingDeadline(): number | null;
  reconcileRoutingDeadlines(): number;
  hasRoutingRelease(input: { namespace: string; taskType: string }): boolean;
  routingPolicy(input: { namespace: string; taskType: string }): RoutingPolicy | null;
  configureRoutingPolicy(input: RoutingPolicyInput): RoutingPolicy;
  publishRoutingRelease(input: RoutingReleaseInput): RoutingRelease;
  rollbackRoutingRelease(input: { namespace: string; releaseId: string; reason: string }): RoutingRelease;
  recordRoutingOutcome(input: RoutingOutcomeInput): RoutingOutcomeInput;
  routingRollouts(input: { namespace: string; taskType: string }): RoutingRolloutReport;
}
export interface ModelIntelligence extends RoutingStore { selectionReceipt(input: { namespace: string; receiptId: string }): SelectionReceipt | null; select(input: SelectionInput): SelectionReceipt; evaluate(input: EvaluationInput): EvaluationInput; policy(input: PolicyInput): PolicyEvent; analytics(namespace?: string): Analytics; comparisonDefinition(input: { namespace: string; comparisonId: string }): ComparisonDefinition; comparisonCatalog(namespace: string): ComparisonDefinition[]; registerDataset(input: DatasetInput): DatasetInput & { createdAt: string }; registerComparison(input: ComparisonInput): ComparisonInput & { createdAt: string }; recordComparisonOutcome(input: ComparisonOutcomeInput): ComparisonOutcomeInput & { createdAt: string }; comparisonReport(input: { namespace: string; comparisonId: string }): ComparisonReport; close(): void }
export const POLICY_VERSION: string;
export const COMPARISON_POLICY_VERSION: string;
export const ROLLOUT_POLICY_VERSION: string;
export function createModelIntelligence(path: string): ModelIntelligence;
