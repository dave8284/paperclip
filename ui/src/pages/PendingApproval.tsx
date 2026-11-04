import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AgentOSBrand } from "@/components/AgentOSBrand";
import { Clock3 } from "lucide-react";
import { Navigate } from "@/lib/router";
import { administrationApi, registrationKey } from "@/api/administration";
import { authApi } from "@/api/auth";
import { useAccountIdentity } from "@/api/companies-query";
import { Button } from "@/components/ui/button";
import { WaitlistCelebration } from "@/components/WaitlistCelebration";
import { navigateTopLevel } from "@/lib/browserNavigation";

export function PendingApproval() {
  const client = useQueryClient();
  const { userId, settled, failed } = useAccountIdentity();
  const [refreshedFor, setRefreshedFor] = useState<string | null | undefined>(undefined);
  const state = useQuery({ queryKey: registrationKey(userId), queryFn: administrationApi.registration, enabled: settled && !failed, retry: false, staleTime: 0, refetchOnMount: "always" });
  const signOut = useMutation({ mutationFn: authApi.signOut, onSuccess: result => { client.clear(); navigateTopLevel(result?.redirectTo ?? "/welcome"); } });
  const checking = !failed && (!settled || state.isPending);
  const status = !failed && !state.error && settled ? state.data?.status : undefined;
  // Revalidate cached access before redirecting or celebrating a registration.
  if (!state.isFetching && status === "approved") return <Navigate to="/workspace" replace />;
  if (!state.isFetching && status === "anonymous") return <Navigate to="/auth" replace />;
  const pending = status === "pending";
  const error = failed ? "Unable to check your session. Refresh this page and try again." : state.error?.message;
  async function refreshStatus() {
    setRefreshedFor(undefined);
    const result = await state.refetch();
    if (!result.error && result.data?.status === "pending") setRefreshedFor(userId);
  }
  return <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-6 py-12">
    <WaitlistCelebration key={userId ?? "anonymous"} enabled={pending && !state.isFetching} />
    <AgentOSBrand to="/welcome" />
    <div className="space-y-5 rounded-2xl border border-border bg-card p-8">
      <Clock3 className="size-7 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-2xl font-medium">{checking ? "Checking your account…" : error ? "Unable to check access" : pending ? "Thank you for joining the waiting list" : "Your account is not active."}</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">{pending ? "Your registration is complete. An administrator will review your request for access." : status === "suspended" ? "Your access has been suspended. Contact your administrator to review it." : status === "rejected" ? "Your registration was not approved. Contact your administrator if this needs another review." : "Your account status will appear here."}</p>
      {pending && <p className="text-sm leading-relaxed text-muted-foreground">Refresh your approval status to check for an update. Once approved, you’ll continue to your workspace.</p>}
      {(error || signOut.error) && <p role="alert" className="text-sm text-destructive">{error || signOut.error?.message}</p>}
      {pending && refreshedFor === userId && !state.isFetching && <p role="status" className="text-sm text-muted-foreground">Status refreshed. Your account is still waiting for approval.</p>}
      <div className="flex flex-wrap gap-3">
        <Button disabled={!settled || failed || state.isFetching} onClick={() => void refreshStatus()}>{state.isFetching ? "Checking approval…" : "Refresh approval status"}</Button>
        <Button variant="outline" disabled={signOut.isPending} onClick={() => signOut.mutate()}>{signOut.isPending ? "Signing out…" : "Sign out"}</Button>
      </div>
    </div>
  </main>;
}
