import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminPerson, AdminUserUpdate } from "@paperclipai/shared";
import { administrationApi, adminKey } from "@/api/administration";
import { accessApi } from "@/api/access";
import { companyDirectoryQueryOptions } from "@/api/companies-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AdminPeople({ userId, pendingOnly = false }: { userId: string | null; pendingOnly?: boolean }) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const status = pendingOnly ? "pending" : "";
  const people = useQuery({ queryKey: [...adminKey(userId), "people", query, status, offset], queryFn: () => administrationApi.people(query, status, offset) });
  const person = people.data?.people.find(row => row.id === selected);
  const refresh = async () => { await client.invalidateQueries({ queryKey: adminKey(userId) }); };
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-medium">{pendingOnly ? "Registrations to review" : "People"}</h2><p className="mt-1 text-sm text-muted-foreground">{pendingOnly ? "Approval and company membership are separate. Review the person, then assign their companies." : "Manage accounts, company access and administrator roles."}</p></div><Button variant="outline" onClick={() => void refresh()}>Refresh</Button></div>
    <form className="flex max-w-md gap-2" onSubmit={event => { event.preventDefault(); setQuery(search); setOffset(0); setSelected(null); }}><Input aria-label="Search name or email" placeholder="Search name or email" value={search} onChange={event => setSearch(event.target.value)} /><Button variant="outline">Search</Button></form>
    {people.error && <p role="alert" className="text-sm text-destructive">{people.error.message}</p>}
    {people.isPending ? <p role="status">Loading people…</p> : <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-left text-sm"><thead className="bg-muted/40 text-muted-foreground"><tr><th className="px-4 py-3">Person</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Companies</th><th className="px-4 py-3">Sign-in</th></tr></thead><tbody>{people.data?.people.map(row => <tr key={row.id} className="border-t border-border"><td className="px-4 py-3"><button className="text-left underline-offset-4 hover:underline" onClick={() => setSelected(row.id)}><span className="block font-medium">{row.name}</span><span className="text-muted-foreground">{row.email}</span></button></td><td className="px-4 py-3 capitalize">{row.approvalStatus}</td><td className="px-4 py-3">{row.isInstanceAdmin ? "Administrator" : "Member"}</td><td className="px-4 py-3">{row.activeCompanyMembershipCount}</td><td className="px-4 py-3">{row.providers.join(", ") || "No provider"}</td></tr>)}</tbody></table>{people.data?.people.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">{pendingOnly ? "No registrations need review." : "No matching accounts."}</p>}</div>}
    {people.data && <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground"><span>{people.data.total} accounts</span><div className="flex gap-2"><Button variant="outline" disabled={!offset} onClick={() => { setOffset(Math.max(0, offset - 30)); setSelected(null); }}>Previous</Button><Button variant="outline" disabled={offset + people.data.people.length >= people.data.total} onClick={() => { setOffset(offset + 30); setSelected(null); }}>Next</Button></div></div>}
    {person && <AdminPersonDetail key={`${person.id}:${person.approvalRevision}`} person={person} viewerId={userId} onClose={() => setSelected(null)} onChanged={refresh} />}
  </div>;
}

function AdminPersonDetail({ person, viewerId, onClose, onChanged }: { person: AdminPerson; viewerId: string | null; onClose: () => void; onChanged: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [name, setName] = useState(person.name);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [confirmAction, setConfirmAction] = useState<AdminUserUpdate["action"] | null>(null);
  const mutation = useMutation({ mutationFn: (action: AdminUserUpdate["action"]) => administrationApi.update(person.id, { action, expectedRevision: person.approvalRevision, reason, ...(action === "rename" ? { name } : {}) }), onSuccess: onChanged });
  const remove = useMutation({ mutationFn: () => administrationApi.delete(person.id, person.approvalRevision, confirmation), onSuccess: async () => { onClose(); await onChanged(); } });
  const own = person.id === viewerId;
  const busy = mutation.isPending || remove.isPending;
  return <section aria-label={`Manage ${person.name}`} className="space-y-5 rounded-2xl border border-border bg-card p-6">
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-medium">{person.name}</h3><p className="text-sm text-muted-foreground">{person.email} · {person.emailVerified ? "Verified email" : "Email not verified"}</p></div><Button variant="ghost" onClick={onClose}>Close</Button></div>
    <div className="flex max-w-lg gap-2"><Input aria-label="Display name" value={name} onChange={event => setName(event.target.value)} maxLength={120} /><Button disabled={busy || !name.trim() || name === person.name} variant="outline" onClick={() => mutation.mutate("rename")}>Save name</Button></div>
    <label className="block text-sm">Reason for change<Input className="mt-2" value={reason} onChange={event => setReason(event.target.value)} placeholder="Optional context for the audit trail" maxLength={1000} /></label>
    <div className="flex flex-wrap gap-2">
      {person.approvalStatus !== "approved" && <Button disabled={busy} onClick={() => mutation.mutate("approve")}>Approve access</Button>}
      {person.approvalStatus === "pending" && <Button disabled={busy || own} variant="outline" onClick={() => setConfirmAction("reject")}>Reject</Button>}
      {person.approvalStatus === "approved" && <Button disabled={busy || own} variant="outline" onClick={() => setConfirmAction("suspend")}>Suspend</Button>}
      <Button disabled={busy || own || person.approvalStatus !== "approved"} variant="outline" onClick={() => setConfirmAction(person.isInstanceAdmin ? "demote" : "promote")}>{person.isInstanceAdmin ? "Remove admin role" : "Make administrator"}</Button>
      <Button disabled={busy} variant="outline" onClick={() => setConfirmAction("revoke_sessions")}>Revoke sessions & API keys</Button>
      <Button disabled={busy || own} variant="outline" onClick={() => setDeleting(!deleting)}>Delete account</Button>
    </div>
    {confirmAction && <div className="space-y-3 rounded-xl bg-muted p-4"><p className="text-sm">{confirmAction === "promote" ? "Administrators can manage all users and instance settings. Grant this role?" : confirmAction === "revoke_sessions" ? "Sign this person out of every session and revoke their board API keys?" : `Apply ${confirmAction.replaceAll("_", " ")} to this account?`}</p><div className="flex gap-2"><Button disabled={busy} onClick={() => mutation.mutate(confirmAction)}>Confirm</Button><Button variant="ghost" onClick={() => setConfirmAction(null)}>Cancel</Button></div></div>}
    {deleting && <div className="space-y-3 rounded-xl border border-destructive/30 p-4"><p className="text-sm">Delete this identity and its sign-in credentials. Business history stays intact. Company and portfolio ownership must be transferred first.</p><Input aria-label="Type email to confirm deletion" placeholder={person.email} value={confirmation} onChange={event => setConfirmation(event.target.value)} /><Button variant="destructive" disabled={busy || confirmation.toLowerCase() !== person.email.toLowerCase()} onClick={() => remove.mutate()}>Permanently delete account</Button></div>}
    {(mutation.error || remove.error) && <p role="alert" className="text-sm text-destructive">{(mutation.error || remove.error)?.message}</p>}
    <AdminCompanyAccess person={person} viewerId={viewerId} onChanged={onChanged} />
  </section>;
}

function AdminCompanyAccess({ person, viewerId, onChanged }: { person: AdminPerson; viewerId: string | null; onChanged: () => Promise<void> }) {
  const client = useQueryClient();
  const key = [...adminKey(viewerId), "company-access", person.id];
  const access = useQuery({ queryKey: key, queryFn: () => accessApi.getUserCompanyAccess(person.id) });
  const companies = useQuery(companyDirectoryQueryOptions(viewerId));
  const [draft, setDraft] = useState<string[] | null>(null);
  const ids = draft ?? access.data?.companyAccess.filter(row => row.status === "active").map(row => row.companyId) ?? [];
  const save = useMutation({ mutationFn: () => accessApi.setUserCompanyAccess(person.id, ids), onSuccess: async () => { setDraft(null); await client.invalidateQueries({ queryKey: key }); await onChanged(); } });
  return <div className="space-y-3 border-t border-border pt-5"><h4 className="font-medium">Company access</h4><p className="text-sm text-muted-foreground">Assign company membership after approval. Ownership and company administrator roles are managed in each company's access settings.</p>
    {access.isPending || companies.isPending ? <p className="text-sm">Loading companies…</p> : <div className="flex flex-wrap gap-3">{companies.data?.map(company => <label key={company.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"><input type="checkbox" checked={ids.includes(company.id)} disabled={person.approvalStatus !== "approved" || save.isPending} onChange={event => setDraft(event.target.checked ? [...ids, company.id] : ids.filter(id => id !== company.id))} />{company.name}</label>)}</div>}
    {(access.error || companies.error || save.error) && <p role="alert" className="text-sm text-destructive">{(access.error || companies.error || save.error)?.message}</p>}
    <Button variant="outline" disabled={!draft || save.isPending || person.approvalStatus !== "approved"} onClick={() => save.mutate()}>Save company access</Button>
  </div>;
}
