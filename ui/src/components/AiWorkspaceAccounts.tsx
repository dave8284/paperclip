import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AI_CONNECTION_CAPABILITIES, type AiConnectionList, type AiManagedConnectionSummary, type AiWorkspaceAccountSummary } from "@paperclipai/shared";
import { authApi } from "@/api/auth";
import { aiConnectionsApi } from "@/api/ai-connections";
import { aiWorkspaceAccountsApi, aiWorkspaceAccountKeys } from "@/api/ai-workspace-accounts";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "./ui/button";
import { AiProviderSetup } from "./ai-connections/AiProviderSetup";
import { AiCompanyAccountSetup } from "./AiAccountSetupNotice";

export function useAiWorkspaceAccounts(companyId: string) {
  const session = useQuery({ queryKey: queryKeys.auth.session, queryFn: authApi.getSession, retry: false });
  const userId = session.isSuccess ? session.data?.user.id ?? null : null;
  const accounts = useQuery({ queryKey: aiWorkspaceAccountKeys.list(userId, companyId),
    queryFn: ({ signal }) => aiWorkspaceAccountsApi.list(signal), enabled: Boolean(userId), retry: false,
    staleTime: 0, refetchOnMount: "always" });
  const readable = Boolean(userId) && session.isSuccess && accounts.isSuccess && accounts.isFetchedAfterMount;
  return { session, userId, accounts, readable,
    owned: readable ? accounts.data!.filter(account => account.ownerUserId === userId) : [] };
}

export function AiWorkspaceAccounts({ companyId, connections }: { companyId: string; connections?: AiConnectionList }) {
  const state = useAiWorkspaceAccounts(companyId);
  if (state.session.isPending) return <p role="status">Loading account access…</p>;
  if (state.session.isError) return <p role="alert" className="text-sm text-destructive">Could not verify your account. <Button variant="ghost" onClick={() => void state.session.refetch()}>Retry account access</Button></p>;
  if (!state.userId) return <p className="text-sm text-muted-foreground">Sign in as the account owner to manage AI accounts across your companies.</p>;
  return <AccountControls key={`${state.userId}:${companyId}`} companyId={companyId} connections={connections} state={state} />;
}

type AccountState = ReturnType<typeof useAiWorkspaceAccounts>;
type Confirmation = { kind: "disable" | "revoke"; accountId: string } | { kind: "enroll"; connectionId: string };
function AccountControls({ companyId, connections, state }: { companyId: string; connections?: AiConnectionList; state: AccountState }) {
  const client = useQueryClient();
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [reconnectId, setReconnectId] = useState<string | null>(null);
  const enrollmentIds = useRef(new Map<string, string>());
  const refresh = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: aiWorkspaceAccountKeys.all }),
      client.invalidateQueries({ queryKey: ["ai-account-company-setup"] }),
      client.invalidateQueries({ queryKey: ["ai-connections"] }), client.invalidateQueries({ queryKey: ["tools"] })]);
  };
  const mutation = useMutation({ mutationFn: async (operation: () => Promise<unknown>) => {
    if (!state.readable) throw new Error("Reload your accounts before changing access.");
    return operation();
  }, onSuccess: async () => { setConfirmation(null); await refresh(); } });
  const owned = state.owned;
  const registered = new Set(owned.flatMap(account => [account.sourceConnectionId, ...account.links.map(link => link.connectionId)]));
  const candidates = state.readable && connections?.currentUserId === state.userId && connections.canManageConnections
    ? connections.connections.filter(row => row.method === "subscription" && row.status === "connected" && !row.workspaceAccountManaged && !registered.has(row.id)
      && (row.ownership === "shared" || row.ownerUserId === state.userId)) : [];
  const selectedAccount = confirmation && confirmation.kind !== "enroll" ? owned.find(account => account.id === confirmation.accountId) : undefined;
  const selectedConnection = confirmation?.kind === "enroll" ? candidates.find(row => row.id === confirmation.connectionId) : undefined;
  const reconnect = owned.find(account => account.id === reconnectId);
  const change = (operation: () => Promise<unknown>) => mutation.mutate(operation);
  const confirm = (next: Confirmation) => { mutation.reset(); setConfirmation(next); setReconnectId(null); };
  const install = (account: AiWorkspaceAccountSummary) => change(() => aiWorkspaceAccountsApi.install(account.id, companyId, {
    expectedRevision: account.revision, expectedLinkRevision: account.links.find(link => link.companyId === companyId)?.revision ?? null,
  }));
  const enroll = (connection: AiManagedConnectionSummary) => {
    if (!enrollmentIds.current.has(connection.id)) enrollmentIds.current.set(connection.id, crypto.randomUUID());
    change(() => aiWorkspaceAccountsApi.enroll({ id: enrollmentIds.current.get(connection.id)!, sourceCompanyId: companyId,
      sourceConnectionId: connection.id, sourceGrantId: connection.grantId, autoInstall: true }));
  };
  const busy = mutation.isPending || !state.readable;
  return <section id="agentos-ai-accounts" aria-labelledby="agentos-ai-accounts-title" className="flex flex-col gap-4">
    <div className="flex flex-col gap-2"><h3 id="agentos-ai-accounts-title" className="font-semibold">AgentOS AI accounts</h3>
      <p className="text-sm text-muted-foreground">Connect your subscription once through AgentOS and use it in companies you own. Each company keeps its work and employee permissions separate.</p></div>
    {state.accounts.isPending && <p role="status">Loading your AI accounts…</p>}
    {state.accounts.isError && <p role="alert" className="text-sm text-destructive">Could not load your AI accounts. {state.accounts.error.message} <Button variant="ghost" onClick={() => void state.accounts.refetch()}>Retry AI accounts</Button></p>}
    {mutation.isError && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
    <AiCompanyAccountSetup companyId={companyId} />
    {state.readable && !owned.length && <p className="text-sm text-muted-foreground">Your reusable accounts will appear here after you connect a subscription or add an existing account below.</p>}
    {owned.map(account => {
      const local = account.sourceCompanyId === companyId || account.links.some(link => link.companyId === companyId && link.enabled);
      const connected = account.enabled && account.available && local;
      return <section key={account.id} aria-label={account.name} className="flex flex-col gap-3 rounded-xl border p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-col gap-1"><h4 className="font-semibold">{account.name}</h4><p className="text-sm text-muted-foreground">{AI_CONNECTION_CAPABILITIES[account.provider].name} subscription</p></div>
          <span className="agentos-pill">{!account.enabled ? "Disabled in all companies" : !account.available ? "Needs attention" : connected ? "Connected to this company" : "Not used by this company"}</span></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={account.autoInstall} disabled={busy} onChange={event => {
          const autoInstall = event.target.checked;
          change(() => aiWorkspaceAccountsApi.update(account.id, { expectedRevision: account.revision, autoInstall }));
        }} />Automatically use in new companies I own</label>
        <div className="flex flex-wrap gap-2">
          {account.enabled && account.available && !local && <Button size="sm" disabled={busy} onClick={() => install(account)}>Use in this company</Button>}
          {!account.enabled && <Button size="sm" disabled={busy || !account.available} onClick={() => change(() => aiWorkspaceAccountsApi.update(account.id, { expectedRevision: account.revision, enabled: true }))}>Enable account</Button>}
          {!account.available && <Button size="sm" variant="outline" disabled={busy} onClick={() => { mutation.reset(); setConfirmation(null); setReconnectId(account.id); }}>Reconnect account</Button>}
          {account.enabled && local && account.sourceCompanyId !== companyId && <Button size="sm" variant="outline" disabled={busy} onClick={() => confirm({ kind: "revoke", accountId: account.id })}>Remove from this company</Button>}
          {account.enabled && <Button size="sm" variant="ghost" disabled={busy} onClick={() => confirm({ kind: "disable", accountId: account.id })}>Disable in all companies</Button>}
        </div>
      </section>;
    })}
    {!!candidates.length && <div className="flex flex-col gap-3"><h4 className="text-sm font-semibold">Existing company subscriptions</h4>{candidates.map(connection => <div key={connection.id} className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm">{connection.name}</span><Button size="sm" variant="outline" disabled={busy} onClick={() => confirm({ kind: "enroll", connectionId: connection.id })}>Use across my companies</Button></div>)}</div>}
    {(selectedAccount || selectedConnection) && <section aria-label="Confirm AI account change" className="flex flex-col gap-3 rounded-xl border p-5">
      <h4 className="font-semibold">{selectedConnection ? `Use ${selectedConnection.name} across your companies?` : confirmation?.kind === "disable" ? `Disable ${selectedAccount!.name} in all companies?` : `Remove ${selectedAccount!.name} from this company?`}</h4>
      <p className="text-sm">{selectedConnection ? "AgentOS will reuse this sign-in for companies you own, including new companies. Company work and employee access remain separate. You can change automatic reuse at any time."
        : confirmation?.kind === "disable" ? "Every company using this account will lose access until you enable it again. Existing work must finish before this change can be saved."
          : "This company's employees will lose access to this account. Your other companies keep their access, and this change will not sign you out of the provider."}</p>
      <div className="flex items-center justify-between gap-3"><Button variant="ghost" disabled={mutation.isPending} onClick={() => setConfirmation(null)}>Cancel</Button>
        <Button variant={selectedConnection ? "default" : "destructive"} disabled={busy} onClick={() => {
          if (selectedConnection) enroll(selectedConnection);
          else if (selectedAccount && confirmation?.kind === "disable") change(() => aiWorkspaceAccountsApi.update(selectedAccount.id, { expectedRevision: selectedAccount.revision, enabled: false }));
          else if (selectedAccount) change(() => aiWorkspaceAccountsApi.revoke(selectedAccount.id, companyId, { expectedRevision: selectedAccount.revision, expectedLinkRevision: selectedAccount.links.find(link => link.companyId === companyId)?.revision ?? null }));
        }}>{selectedConnection ? "Use across my companies" : confirmation?.kind === "disable" ? "Disable account" : "Remove company access"}</Button>
      </div>
    </section>}
    {reconnect && <ReconnectAccount key={reconnect.id} account={reconnect} userId={state.userId!} onCancel={() => setReconnectId(null)} onComplete={() => { setReconnectId(null); void refresh(); }} />}
  </section>;
}

function ReconnectAccount({ account, userId, onCancel, onComplete }: { account: AiWorkspaceAccountSummary; userId: string; onCancel: () => void; onComplete: () => void }) {
  const source = useQuery({ queryKey: ["ai-connections", account.sourceCompanyId, "workspace-reconnect", userId],
    queryFn: () => aiConnectionsApi.list(account.sourceCompanyId), retry: false, staleTime: 0, refetchOnMount: "always" });
  const connection = source.isSuccess && source.isFetchedAfterMount && source.data.currentUserId === userId
    ? source.data.connections.find(row => row.id === account.sourceConnectionId && row.grantId === account.sourceGrantId) : undefined;
  if (source.isPending) return <p role="status">Preparing account sign-in…</p>;
  if (!connection) return <div className="flex flex-col gap-3"><p role="alert" className="text-sm text-destructive">Could not load this account for sign-in. {source.error?.message}</p><div className="flex items-center justify-between gap-3"><Button variant="ghost" onClick={onCancel}>Cancel</Button><Button variant="outline" onClick={() => void source.refetch()}>Retry account sign-in</Button></div></div>;
  return <AiProviderSetup companyId={account.sourceCompanyId} reconnect={connection} onCancel={onCancel} onComplete={onComplete} />;
}
