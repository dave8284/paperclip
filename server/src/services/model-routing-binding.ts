import type { heartbeatRuns } from "@paperclipai/db";
import type { SelectionInput, SelectionReceipt } from "@agentos/model-intelligence";
import { modelProfileDigest } from "./model-profile-binding.js";
export const NATIVE_MODEL_ROUTING_ADMISSION = "nativeModelRoutingAdmission";
export const NATIVE_MODEL_ROUTING_DELIVERY = "nativeModelRoutingDelivery";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function nativeModelRoutingAdmission(request: SelectionInput) {
  if (!request.candidates.some(candidate => candidate.variant) || request.comparisonBinding) return null;
  return { schema: "agentos.native-model-routing-admission.v1", runId: request.requestId, companyId: request.namespace,
    requestFingerprint: modelProfileDigest(request), admittedAt: new Date().toISOString() };
}
export function readNativeModelRoutingAdmission(run: typeof heartbeatRuns.$inferSelect) {
  const admission = record(run.runnerProfileJson?.[NATIVE_MODEL_ROUTING_ADMISSION]);
  if (admission.schema !== "agentos.native-model-routing-admission.v1" || admission.runId !== run.id || admission.companyId !== run.companyId
    || typeof admission.admittedAt !== "string" || !Number.isFinite(Date.parse(admission.admittedAt))
    || admission.requestFingerprint !== modelProfileDigest(run.contextSnapshot?.modelIntelligenceRequest ?? null)) return null;
  return admission as { schema: string; runId: string; companyId: string; requestFingerprint: string; admittedAt: string };
}
export function exactNativeRoutingSelection(run: typeof heartbeatRuns.$inferSelect, receipt: SelectionReceipt | null) {
  if (!readNativeModelRoutingAdmission(run) || !receipt?.candidate || receipt.id !== run.id || receipt.namespace !== run.companyId || receipt.comparisonBinding) return false;
  const request = record(run.contextSnapshot?.modelIntelligenceRequest);
  return request.requestId === run.id && request.namespace === run.companyId && request.taskKey === receipt.taskKey && request.taskType === receipt.taskType
    && request.contextFingerprint === receipt.contextFingerprint && request.promptFingerprint === receipt.promptFingerprint
    && Array.isArray(request.candidates) && request.candidates.some(value => {
      const candidate = record(value);
      return candidate.id === receipt.candidate.id && candidate.provider === receipt.candidate.provider && candidate.model === receipt.candidate.model
        && candidate.method === "subscription" && receipt.candidate.method === "subscription"
        && candidate.variant != null && receipt.candidate.variant != null && modelProfileDigest(candidate.variant) === modelProfileDigest(receipt.candidate.variant);
    });
}
