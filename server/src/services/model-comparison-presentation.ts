/** Run readers may read an open target without access to its comparison's
 * private source. Only the source-scoped audit exposes preparation provenance. */
export function publicModelComparisonRecord(value: Record<string, unknown>): Record<string, unknown> {
  const { nativeModelComparison: _binding, nativeModelComparisonDelivery: _outbox,
    nativeModelRoutingAdmission: _routingAdmission, nativeModelRoutingDelivery: _routingDelivery, ...visible } = value;
  if (!visible.comparisonBinding) return visible;
  const candidate = visible.candidate && typeof visible.candidate === "object" ? visible.candidate as Record<string, unknown> : {};
  return { id: visible.id, namespace: visible.namespace, taskType: visible.taskType, complexity: visible.complexity,
    policyVersion: visible.policyVersion, reason: visible.reason, createdAt: visible.createdAt,
    candidate: { provider: candidate.provider, model: candidate.model, method: candidate.method } };
}
