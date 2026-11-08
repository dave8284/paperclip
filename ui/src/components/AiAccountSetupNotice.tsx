import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AiWorkspaceAccountSetupResult } from "@paperclipai/shared";
import { aiWorkspaceAccountsApi, aiWorkspaceAccountKeys } from "@/api/ai-workspace-accounts";
import { Button } from "./ui/button";
import { useAccountIdentity } from "@/api/companies-query";

/** Setup retries reuse saved authorization. They never restart provider login. */
export function AiAccountSetupNotice({ result, onChange, onContinue }: {
  result: AiWorkspaceAccountSetupResult;
  onChange: (result: AiWorkspaceAccountSetupResult) => void;
  onContinue?: () => void;
}) {
  const client = useQueryClient();
  const retry = useMutation({ mutationFn: () => {
    if (!result.retry) throw new Error("Open AI account settings to review account access.");
    return aiWorkspaceAccountsApi.finishSetup(result.retry);
  }, onSuccess: async next => {
    onChange(next);
    await Promise.all([client.invalidateQueries({ queryKey: aiWorkspaceAccountKeys.all }),
      client.invalidateQueries({ queryKey: ["ai-account-company-setup"] }),
      client.invalidateQueries({ queryKey: ["ai-connections"] }), client.invalidateQueries({ queryKey: ["tools"] })]);
  } });
  if (result.status !== "pending") return null;
  return <section aria-label="AI account setup pending" className="flex flex-col gap-3 rounded-xl border p-5">
    <p className="text-sm font-semibold">Company access to your AI account still needs setup.</p>
    <p className="text-sm text-muted-foreground">Your saved sign-in is retained. Retry setup to finish connecting your companies.</p>
    {[...new Set(result.pending.map(item => item.message))].map(message => <p key={message} className="text-sm">{message}</p>)}
    {retry.isError && <p role="alert" className="text-sm text-destructive">Could not finish account setup. {retry.error.message}</p>}
    <div className="flex items-center justify-between gap-3">
      {onContinue ? <Button variant="ghost" disabled={retry.isPending} onClick={onContinue}>Continue with this company</Button> : <span />}
      {result.retry ? <Button disabled={retry.isPending} onClick={() => retry.mutate()}>{retry.isPending ? "Finishing setup…" : "Retry account setup"}</Button>
        : <p className="text-sm text-muted-foreground">Review this account in Settings → Connectors.</p>}
    </div>
  </section>;
}

/** A read-only status lookup restores unfinished setup after reload. */
export function AiCompanyAccountSetup({ companyId, refreshKey = 0 }: { companyId: string; refreshKey?: number }) {
  const { userId, settled, failed } = useAccountIdentity();
  const client = useQueryClient();
  const key = ["ai-account-company-setup", userId, companyId] as const;
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => aiWorkspaceAccountsApi.companySetup(companyId, signal),
    enabled: settled && Boolean(userId), retry: false, staleTime: 0, refetchOnMount: "always" });
  useEffect(() => { if (refreshKey && settled && userId) void query.refetch(); }, [refreshKey, settled, userId, query.refetch]);
  if (failed || !settled || !userId) return null;
  if (query.isError) return <p role="alert" className="text-sm text-destructive">Could not check automatic AI account setup. <Button variant="ghost" onClick={() => void query.refetch()}>Retry setup status</Button></p>;
  if (!query.isSuccess || !query.isFetchedAfterMount) return null;
  return <AiAccountSetupNotice key={`${userId}:${companyId}`} result={query.data} onChange={result => client.setQueryData(key, result)} />;
}
