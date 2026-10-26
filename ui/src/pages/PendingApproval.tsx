import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3 } from "lucide-react";
import { Link, Navigate } from "@/lib/router";
import { administrationApi, registrationKey } from "@/api/administration";
import { authApi } from "@/api/auth";
import { useAccountIdentity } from "@/api/companies-query";
import { Button } from "@/components/ui/button";
import { navigateTopLevel } from "@/lib/browserNavigation";

export function PendingApproval() {
  const client = useQueryClient();
  const { userId } = useAccountIdentity();
  const state = useQuery({ queryKey: registrationKey(userId), queryFn: administrationApi.registration, retry: false, staleTime: 0 });
  const signOut = useMutation({ mutationFn: authApi.signOut, onSuccess: result => { client.clear(); navigateTopLevel(result?.redirectTo ?? "/welcome"); } });
  if (state.data?.status === "approved") return <Navigate to="/workspace" replace />;
  if (state.data?.status === "anonymous") return <Navigate to="/auth" replace />;
  const pending = state.data?.status === "pending";
  return <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-6 py-12">
    <Link to="/welcome" className="text-lg font-semibold">Agent OS</Link>
    <div className="space-y-5 rounded-2xl border border-border bg-card p-8">
      <Clock3 className="size-7 text-muted-foreground" />
      <h1 className="text-2xl font-medium">{state.isPending ? "Checking your account…" : state.error ? "Unable to check access" : pending ? "You're on the list." : "Your account is not active."}</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">{pending ? "Your account is registered and waiting for administrator approval. Your companies and agents will become available after your access is approved and company access is assigned." : state.data?.status === "suspended" ? "Your access has been suspended. Contact your administrator to review it." : state.data?.status === "rejected" ? "Your registration was not approved. Contact your administrator if this needs another review." : "Your account status will appear here."}</p>
      {(state.error || signOut.error) && <p role="alert" className="text-sm text-destructive">{(state.error || signOut.error)?.message}</p>}
      <div className="flex flex-wrap gap-3"><Button disabled={state.isFetching} onClick={() => void state.refetch()}>Check status</Button><Button variant="outline" disabled={signOut.isPending} onClick={() => signOut.mutate()}>Sign out</Button></div>
    </div>
  </main>;
}
