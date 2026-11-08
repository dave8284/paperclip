import type { DurableRecoveryCommittedEvent, DurableRecoveryIdentity } from "../contracts/durable-recovery.js";
import { providerTurnInputReceipt } from "../contracts/provider-context-receipt.js";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

/** The durable control plane has authenticated these events. Bind the receipt to
 * this exact accepted turn, never a preceding turn or another authority epoch. */
export function acceptedRunnerTurnInputReceipt(events: readonly DurableRecoveryCommittedEvent[], identity: DurableRecoveryIdentity,
  providerTurnId: string, providerSessionId: string | null) {
  if (!providerSessionId) return undefined;
  const matching = events.filter(row => {
    const envelope = row.envelope, event = record(envelope.payload), payload = record(event.payload);
    return row.eventType === "turn.accepted" && event.eventType === row.eventType
      && Object.entries(identity).every(([key, value]) => (envelope as unknown as Record<string, unknown>)[key] === value)
      && event.runId === identity.runId && event.normalizedSessionId === identity.normalizedSessionId
      && event.sourceInstanceId === identity.runnerInstanceId && event.sourceEventId === row.sourceEventId
      && event.sourceSeq === row.sourceSeq && payload.providerTurnId === providerTurnId
      && payload.providerSessionId === providerSessionId;
  });
  if (matching.length !== 1) return undefined;
  return providerTurnInputReceipt(record(record(matching[0]!.envelope.payload).payload).inputReceipt);
}
