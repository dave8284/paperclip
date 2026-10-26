import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Link, useSearchParams } from "@/lib/router";
import { administrationApi, adminKey } from "@/api/administration";
import { useAccountIdentity } from "@/api/companies-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdminPeople } from "@/components/AdminPeople";
import { AdminModelIntelligence } from "@/components/AdminModelIntelligence";

const tabs = [
  ["overview", "Overview"], ["pending", "Pending approval"], ["users", "Users"],
  ["add", "Add people"], ["intelligence", "Model Intelligence"], ["audit", "Audit trail"],
] as const;

export function Administration() {
  const { userId } = useAccountIdentity();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "overview";
  const overview = useQuery({ queryKey: [...adminKey(userId), "overview"], queryFn: administrationApi.overview, retry: false });
  return <div className="min-h-dvh bg-background text-foreground">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-5"><Link to="/workspace" className="flex items-center gap-2 font-medium"><ArrowLeft className="size-4" />Agent OS</Link><div className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="size-4" />Administration</div></header>
    {overview.error ? <main className="mx-auto max-w-xl space-y-3 px-6 py-16"><h1 className="text-xl font-medium">Administrator access required</h1><p role="alert" className="text-sm text-destructive">{overview.error.message}</p><Button variant="outline" onClick={() => void overview.refetch()}>Try again</Button></main> : overview.isPending ? <p role="status" className="p-8">Loading administration…</p> : <div className="mx-auto grid max-w-7xl md:grid-cols-4">
      <aside className="border-b border-border p-4 md:min-h-dvh md:border-r md:border-b-0"><nav className="flex flex-wrap gap-1 md:flex-col" aria-label="Administration">{tabs.map(([value, label]) => <button key={value} aria-current={tab === value ? "page" : undefined} onClick={() => setParams({ tab: value })} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-3 text-left text-sm ${tab === value ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50"}`}>{label}{value === "pending" && overview.data.counts.pending > 0 && <span className="rounded-full bg-foreground px-2 py-0.5 text-xs text-background">{overview.data.counts.pending}</span>}</button>)}</nav></aside>
      <main className="min-w-0 space-y-6 p-6 md:col-span-3 md:p-8">
        {tab === "overview" && <>
          <div><p className="text-xs uppercase tracking-widest text-muted-foreground">Instance control</p><h1 className="mt-2 text-3xl font-medium">A clear view of access.</h1></div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[["People", overview.data.counts.users], ["Awaiting approval", overview.data.counts.pending], ["Approved", overview.data.counts.approved], ["Administrators", overview.data.counts.admins]].map(([label, count]) => <article key={label} className="rounded-xl border border-border p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-3 text-3xl font-medium">{count}</p></article>)}</div>
          <section className="space-y-3 rounded-xl border border-border p-6"><h2 className="font-medium">Registration & Google sign-in</h2><p className="text-sm text-muted-foreground">Public registrations wait for your approval before accessing companies or agents.</p><p className="text-sm">Google: <strong>{overview.data.google.configured ? "Credentials configured" : "Setup required"}</strong> · Mode: {overview.data.mode === "local_trusted" ? "Trusted local development" : "Authenticated"}</p>{!overview.data.google.configured && <p className="text-sm text-muted-foreground">Set PAPERCLIP_GOOGLE_CLIENT_ID and PAPERCLIP_GOOGLE_CLIENT_SECRET in the server's secret configuration, then restart the server. Register your public origin followed by <code>{overview.data.google.callbackPath}</code> as the Google OAuth redirect URI.</p>}{overview.data.mode === "local_trusted" && <p className="text-sm text-muted-foreground">This local instance trusts the device. Switch to authenticated mode before opening registration on a public deployment.</p>}<Button variant="outline" onClick={() => setParams({ tab: "pending" })}>Review registrations</Button><Button variant="ghost" asChild><Link to="/welcome">View landing page</Link></Button></section>
        </>}
        {(tab === "pending" || tab === "users") && <AdminPeople key={tab} userId={userId} pendingOnly={tab === "pending"} />}
        {tab === "add" && <AdminPreapprovals userId={userId} />}
        {tab === "intelligence" && <AdminModelIntelligence userId={userId} />}
        {tab === "audit" && <AdminAudit userId={userId} />}
      </main>
    </div>}
  </div>;
}

function AdminPreapprovals({ userId }: { userId: string | null }) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const key = [...adminKey(userId), "preapprovals"];
  const list = useQuery({ queryKey: key, queryFn: administrationApi.invitations });
  const refresh = () => client.invalidateQueries({ queryKey: adminKey(userId) });
  const add = useMutation({ mutationFn: () => administrationApi.invite(name, email), onSuccess: async () => { setName(""); setEmail(""); await refresh(); } });
  const revoke = useMutation({ mutationFn: administrationApi.revokeInvitation, onSuccess: refresh });
  return <div className="space-y-5"><div><h1 className="text-xl font-medium">Add people</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Preapprove a person for seven days. They create their own account with Google using this verified email. Password registrations remain in the review queue until you approve them. No email is sent automatically.</p></div>
    <form className="grid max-w-2xl gap-3 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); add.mutate(); }}><label className="space-y-2 text-sm">Name<Input required value={name} onChange={event => setName(event.target.value)} maxLength={120} /></label><label className="space-y-2 text-sm">Email<Input required type="email" value={email} onChange={event => setEmail(event.target.value)} /></label><div><Button disabled={add.isPending}>Preapprove person</Button></div></form>
    {add.isSuccess && <p role="status" className="text-sm">Preapproval saved. Share the landing page link so they can register.</p>}
    {(list.error || add.error || revoke.error) && <p role="alert" className="text-sm text-destructive">{(list.error || add.error || revoke.error)?.message}</p>}
    <div className="divide-y divide-border rounded-xl border border-border">{list.data?.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-sm font-medium">{row.name} · {row.email}</p><p className="text-xs text-muted-foreground">{row.revokedAt ? "Revoked" : `Expires ${new Date(row.expiresAt).toLocaleString()}`}</p></div><Button size="sm" variant="outline" disabled={!!row.revokedAt || revoke.isPending} onClick={() => revoke.mutate(row.id)}>Revoke</Button></div>)}{list.data?.length === 0 && <p className="p-6 text-sm text-muted-foreground">No preapprovals yet.</p>}</div>
  </div>;
}

function AdminAudit({ userId }: { userId: string | null }) {
  const events = useQuery({ queryKey: [...adminKey(userId), "events"], queryFn: administrationApi.events });
  return <div className="space-y-5"><div className="flex items-center justify-between gap-3"><h1 className="text-xl font-medium">Administration audit trail</h1><Button variant="outline" onClick={() => void events.refetch()}>Refresh</Button></div><p className="text-sm text-muted-foreground">The latest 100 account and access changes. Company work retains its own audit trail.</p>{events.error && <p role="alert" className="text-sm text-destructive">{events.error.message}</p>}<ol className="divide-y divide-border">{events.data?.map(row => <li key={row.id} className="space-y-2 py-4"><div className="flex flex-wrap justify-between gap-2"><span className="text-sm font-medium">{row.action.replaceAll("_", " ")}</span><time className="text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</time></div><p className="break-all text-xs text-muted-foreground">By {row.actorUserId}{row.targetUserId ? ` · User ${row.targetUserId}` : ""}</p><details className="text-xs"><summary className="cursor-pointer">Details</summary><pre className="mt-2 overflow-auto rounded-lg bg-muted p-3">{JSON.stringify(row.details, null, 2)}</pre></details></li>)}</ol>{events.data?.length === 0 && <p className="text-sm text-muted-foreground">No administration events recorded yet.</p>}</div>;
}
