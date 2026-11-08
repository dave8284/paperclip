/** Internal provider bookkeeping belongs in run logs, including older notice records. */
export function isRunLogOnlyProviderEvent(
  eventType: string,
  payload: Record<string, unknown>,
): boolean {
  if (eventType === "harness.diagnostic") {
    const receipt = payload.contextReceipt as Record<string, unknown> | null | undefined;
    return payload.code === "codex_unrelated_information"
      || (payload.code === "context.tool_result_written" && payload.severity === "info"
        && receipt?.schema === "paperclip.provider-context-receipt.v1" && receipt.stage === "transport_written");
  }
  // Older runners dropped the classification when converting this diagnostic
  // into a notice. Match its complete notice shape so real warnings stay visible.
  return eventType === "provider.notice.recorded"
    && payload.schema === "paperclip.provider.notice.v1"
    && payload.severity === "warning"
    && payload.category === "warning"
    && payload.summary === "ignored unrelated provider information";
}
