import { useQuery } from "@tanstack/react-query";
import type { AttentionItem } from "@paperclipai/shared";
import { approvalsApi } from "../api/approvals";
import { decisionsApi } from "../api/decisions";
import { attentionDecisionSummary } from "../lib/attention";
import { queryKeys } from "../lib/queryKeys";

type ProposalContext = { id: string; companyId: string; payload?: Record<string, unknown>; body?: string };

export function AttentionDecisionSummary({ item, companyId }: { item: AttentionItem; companyId: string }) {
  if (item.sourceKind === "approval" || item.sourceKind === "decision") {
    return <NativeProposalSummary item={item} companyId={companyId} />;
  }
  return <Summary text={attentionDecisionSummary(item)} />;
}

function NativeProposalSummary({ item, companyId }: { item: AttentionItem; companyId: string }) {
  const isDecision = item.sourceKind === "decision";
  // The existing action resolver owns fetching. Observe its cache so old feeds
  // with only a title/generic reason can still show real proposal context, without
  // adding another detail request or exposing stale data after a read failure.
  const detail = useQuery<ProposalContext>({
    queryKey: isDecision ? queryKeys.decisions.detail(item.subject.id) : queryKeys.approvals.detail(item.subject.id),
    queryFn: () => isDecision ? decisionsApi.get(item.subject.id) : approvalsApi.get(item.subject.id),
    enabled: false,
  });
  const proposal = !detail.error && detail.data?.id === item.subject.id && detail.data.companyId === companyId
    ? detail.data : undefined;
  return <Summary text={attentionDecisionSummary(item, proposal)} />;
}

function Summary({ text }: { text: string }) {
  return <p data-attention-summary aria-label="Decision summary" className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{text}</p>;
}
