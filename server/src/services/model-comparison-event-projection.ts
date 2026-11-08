import { sql, type SQL } from "drizzle-orm";
import { heartbeatRunEvents } from "@paperclipai/db";
import { NATIVE_COMPARISON_SOURCE } from "./native-runtime/native-comparison-event-projection.js";

// Finalization needs identities and receipts, never model prose, tool results
// or attachments. Project inside PostgreSQL so large logs stay in their owner.
type Shape = { [key: string]: true | Shape };
const receipt: Shape = { schema: true, stage: true, source: true, parametersSha256: true,
  instructionsSha256: true, promptSha256: true, modelEnvelopeSha256: true };
const shape: Shape = { prpEvent: {
  runId: true, sourceInstanceId: true, sourceEventId: true, sourceSeq: true, eventType: true,
  normalizedSessionId: true, turnId: true,
  payload: { providerTurnId: true, runTerminalState: true, inputReceipt: receipt, code: true,
    contextReceipt: { schema: true, stage: true, source: true, callId: true, operationId: true,
      providerTurnId: true, resultSha256: true, resultBytes: true, isError: true },
    providerDescriptor: { observedCodexIdentity: { contextReceipt: receipt } },
    semantic_tool: { operationId: true, callId: true, idempotencyKey: true, outcome: true,
      correlation: { runId: true, turnId: true, normalizedSessionId: true }, input: { idempotencyKey: true } },
  },
} };
function project(fields: Shape, path: string[] = []): SQL {
  return sql`jsonb_build_object(${sql.join(Object.entries(fields).flatMap(([key, value]) => [sql`${key}::text`,
    value === true ? sql`${heartbeatRunEvents.payload} #> ${`{${[...path, key].join(",")}}`}::text[]`
      : project(value, [...path, key]),
  ]), sql`, `)})`;
}
const projected = project(shape);
export const modelComparisonEventProjection = {
  companyId: heartbeatRunEvents.companyId, runId: heartbeatRunEvents.runId, agentId: heartbeatRunEvents.agentId,
  eventType: heartbeatRunEvents.eventType, sourceInstanceId: heartbeatRunEvents.sourceInstanceId,
  sourceEventId: heartbeatRunEvents.sourceEventId, sourceSeq: heartbeatRunEvents.sourceSeq,
  sourcePayloadSha256: heartbeatRunEvents.sourcePayloadSha256, protocolSchemaVersion: heartbeatRunEvents.protocolSchemaVersion,
  // Oversized or specially encoded metadata cannot establish a count. Retain
  // its row as a missing-evidence witness instead of silently dropping it.
  payload: sql<Record<string, unknown> | null>`case
    when ${heartbeatRunEvents.payload} ? '$paperclipRunEventJsonV1' then null
    when octet_length((${projected})::text) <= 8192 then ${projected}
    else null end`,
};
export type ModelComparisonEvent = Pick<typeof heartbeatRunEvents.$inferSelect, keyof typeof modelComparisonEventProjection>;

// These rows are written only by the authenticated native commit sink, under a
// separate namespace from the facade's transcript. The stored digest remains
// that of the original native event, not this deliberately incomplete body.
export const nativeModelComparisonEventProjection = {
  companyId: heartbeatRunEvents.companyId, runId: heartbeatRunEvents.runId, agentId: heartbeatRunEvents.agentId,
  eventType: sql<string>`${heartbeatRunEvents.payload}->'event'->>'eventType'`,
  sourceInstanceId: sql<string | null>`substring(${heartbeatRunEvents.sourceInstanceId} from ${NATIVE_COMPARISON_SOURCE.length + 1}::int)`,
  sourceEventId: sql<string | null>`substring(${heartbeatRunEvents.sourceEventId} from ${NATIVE_COMPARISON_SOURCE.length + 1}::int)`,
  sourceSeq: heartbeatRunEvents.sourceSeq, sourcePayloadSha256: heartbeatRunEvents.sourcePayloadSha256,
  protocolSchemaVersion: heartbeatRunEvents.protocolSchemaVersion,
  payload: sql<Record<string, unknown> | null>`case
    when ${heartbeatRunEvents.payload}->>'schema' = 'agentos.native-comparison-event.v1'
      and ${heartbeatRunEvents.sourceInstanceId} like ${`${NATIVE_COMPARISON_SOURCE}%`}
      and ${heartbeatRunEvents.sourceEventId} like ${`${NATIVE_COMPARISON_SOURCE}%`}
      and octet_length((${heartbeatRunEvents.payload})::text) <= 9216
    then jsonb_build_object('nativeEvidenceSchema', 'agentos.native-comparison-event.v1',
      'prpEvent', ${heartbeatRunEvents.payload}->'event') else null end`,
};
