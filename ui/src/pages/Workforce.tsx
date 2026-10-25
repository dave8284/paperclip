import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentosAssignment, AgentosWorkforce } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { useAccountIdentity } from "@/api/companies-query";
import { workforceApi, workforceKeys } from "@/api/workforce";
import { agentsApi } from "@/api/agents";
import { detachInflightGet } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/utils";

// Reuse a request ID after uncertain delivery. Changing the submitted payload
// is a new intent; a retry of the same payload remains idempotent.
function useRequestId() {
  const requests = useRef(new Map<string, string>());
  return (input: unknown) => {
    const key = JSON.stringify(input);
    let id = requests.current.get(key);
    if (!id) { id = crypto.randomUUID(); requests.current.set(key, id); }
    return id;
  };
}

function Failure({ error }: { error: unknown }) {
  return error ? <p role="alert" className="text-sm text-destructive">{error instanceof Error ? error.message : "The change could not be saved. Please try again."}</p> : null;
}

export function Workforce({ embedded = false }: { embedded?: boolean }) {
  const identity = useAccountIdentity();
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => { if (!embedded) setBreadcrumbs([{ label: "Portfolio & workforce" }]); }, [setBreadcrumbs, embedded]);
  if (identity.failed) return <Failure error={new Error("Your session could not be checked. Refresh to try again.")} />;
  if (!identity.settled) return <p className="text-sm text-muted-foreground">Loading your portfolio…</p>;
  // Reset forms and pending selections when the account changes.
  return <WorkforceAccount key={identity.userId ?? "local"} userId={identity.userId} />;
}

function WorkforceAccount({ userId }: { userId: string | null }) {
  const { companies, selectedCompanyId } = useCompany();
  const client = useQueryClient();
  const [selectedPortfolio, setSelectedPortfolio] = useState("");
  const [name, setName] = useState("My portfolio");
  const [homeCompanyId, setHomeCompanyId] = useState(selectedCompanyId ?? "");
  const requestId = useRequestId();
  const portfolios = useQuery({ queryKey: workforceKeys.list(userId), queryFn: ({ signal }) => workforceApi.list(signal), retry: false });
  const portfolioId = portfolios.data?.some(row => row.id === selectedPortfolio) ? selectedPortfolio : portfolios.data?.[0]?.id ?? "";
  const workforce = useQuery({ queryKey: workforceKeys.detail(userId, portfolioId), queryFn: ({ signal }) => workforceApi.get(portfolioId, signal), enabled: !!portfolioId, retry: false });
  const create = useMutation({
    mutationFn: () => {
      const input = { name: name.trim(), homeCompanyId };
      return workforceApi.create({ ...input, id: requestId(input) });
    },
    onSuccess: async result => {
      setSelectedPortfolio(result.id);
      await client.invalidateQueries({ queryKey: workforceKeys.account(userId) });
    },
  });
  return <div className="flex flex-col gap-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Portfolio & workforce</h1><p className="text-sm text-muted-foreground">Your companies and the specialists working across them.</p></div>
      <Button variant="outline" onClick={() => void client.invalidateQueries({ queryKey: workforceKeys.account(userId) })}>Refresh</Button>
    </div>
    <Failure error={portfolios.error ?? workforce.error} />
    {portfolios.isPending ? <p>Loading portfolios…</p> : portfolios.data?.length === 0 ?
      <Card className="p-6">
        <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); create.mutate(); }}>
          <div><h2 className="text-lg font-medium">Create your portfolio</h2><p className="text-sm text-muted-foreground">Group your ventures and give each specialist one identity across their company assignments. Existing companies and work stay in place.</p></div>
          <label className="flex flex-col gap-1 text-sm">Portfolio name<Input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm">Home company<NativeSelect required value={homeCompanyId} onChange={event => setHomeCompanyId(event.target.value)}><option value="">Select a company</option>{companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</NativeSelect><span className="text-muted-foreground">Portfolio administration and its audit history belong to this company.</span></label>
          <Failure error={create.error} />
          <div className="flex items-center justify-between gap-3"><Link to="/companies" className="text-sm underline">Manage companies</Link><Button type="submit" disabled={create.isPending || !homeCompanyId || !name.trim()}>{create.isPending ? "Creating…" : "Create portfolio"}</Button></div>
        </form>
      </Card> : null}
    {(portfolios.data?.length ?? 0) > 1 && <NativeSelect aria-label="Portfolio" value={portfolioId} onChange={event => setSelectedPortfolio(event.target.value)}>{portfolios.data?.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</NativeSelect>}
    {!!portfolioId && workforce.isPending && <p>Loading workforce…</p>}
    {workforce.data && !workforce.error && <PortfolioWorkforce key={portfolioId} userId={userId} data={workforce.data} />}
  </div>;
}

function PortfolioWorkforce({ userId, data }: { userId: string | null; data: AgentosWorkforce }) {
  const { companies } = useCompany();
  const client = useQueryClient();
  const requestId = useRequestId();
  const [companyId, setCompanyId] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [adding, setAdding] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const refresh = async () => { await client.invalidateQueries({ queryKey: workforceKeys.detail(userId, data.portfolio.id) }); };
  const link = useMutation({ mutationFn: () => workforceApi.linkCompany(data.portfolio.id, companyId), onSuccess: async () => { setCompanyId(""); await refresh(); } });
  const create = useMutation({
    mutationFn: () => { const input = { name: employeeName.trim(), specialty: specialty.trim() }; return workforceApi.createEmployee(data.portfolio.id, { ...input, id: requestId(input) }); },
    onSuccess: async () => { setAdding(false); setEmployeeName(""); setSpecialty(""); await refresh(); },
  });
  const unlinked = companies.filter(company => !data.companies.some(row => row.id === company.id));
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-medium">{data.portfolio.name}</h2><div className="flex items-center gap-3"><Link to="/companies" className="text-sm underline">Manage companies</Link><p className="text-xs text-muted-foreground">Updated {relativeTime(data.observedAt)}</p></div></div>
    <section aria-label="Companies" className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{data.companies.map(company => <Card key={company.id} className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3"><Link className="font-medium underline" to={`/${company.issuePrefix}/friday`}>{company.name}</Link><Badge variant="secondary">{company.status}</Badge></div>
        {company.description && <p className="text-sm text-muted-foreground">{company.description}</p>}
        <p className="text-sm">{data.assignments.filter(row => row.companyId === company.id && row.status === "active").length} shared employee assignments</p>
        <div className="flex flex-wrap gap-3 text-sm">{[["projects", "Projects"], ["routines", "Routines"], ["artifacts", "Artefacts"], ["company/settings", "Company profile"]].map(([path, label]) => <Link key={path} className="underline" to={`/${company.issuePrefix}/${path}`}>{label}</Link>)}</div>
      </Card>)}</div>
      {data.canManage && unlinked.length > 0 && <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); link.mutate(); }}>
        <label className="flex flex-col gap-1 text-sm">Add an existing company<NativeSelect required value={companyId} onChange={event => setCompanyId(event.target.value)}><option value="">Select a company</option>{unlinked.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</NativeSelect></label>
        <Failure error={link.error} /><div className="flex justify-end"><Button type="submit" variant="outline" disabled={link.isPending || !companyId}>Add company</Button></div>
      </form>}
    </section>
    <section aria-label="Shared employees" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-medium">Shared employees</h2>{data.canManage && !adding && <Button variant="outline" onClick={() => setAdding(true)}>Add specialist</Button>}</div>
      {adding && <Card className="p-4"><form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); create.mutate(); }}>
        <label className="flex flex-col gap-1 text-sm">Employee name<Input required maxLength={120} value={employeeName} onChange={event => setEmployeeName(event.target.value)} /></label>
        <label className="flex flex-col gap-1 text-sm">Specialty<Textarea maxLength={4000} value={specialty} onChange={event => setSpecialty(event.target.value)} placeholder="What this specialist is responsible for" /></label>
        <Failure error={create.error} /><div className="flex items-center justify-between gap-3"><Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button><Button type="submit" disabled={create.isPending || !employeeName.trim()}>Create employee</Button></div>
      </form></Card>}
      {!data.employees.length && <p className="text-sm text-muted-foreground">Add a specialist, then connect their existing company agents. Each assignment keeps its own skills, instructions, access and execution history.</p>}
      {data.employees.map(employee => {
        const assignments = data.assignments.filter(row => row.employeeId === employee.id);
        return <Card key={employee.id} className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">{employee.name}</h3><p className="text-sm text-muted-foreground">{employee.specialty || "Specialist"}</p></div>{data.canManage && <Button size="sm" variant="outline" onClick={() => setAssigning(employee.id)}>Assign to company</Button>}</div>
          {assignments.length === 0 && <p className="text-sm text-muted-foreground">No company assignments yet.</p>}
          {assignments.map(assignment => <Assignment key={assignment.id} assignment={assignment} data={data} refresh={refresh} />)}
          {assigning === employee.id && <AssignmentForm userId={userId} employeeId={employee.id} data={data} close={() => setAssigning(null)} refresh={refresh} />}
        </Card>;
      })}
    </section>
  </>;
}

function AssignmentForm({ userId, employeeId, data, close, refresh }: { userId: string | null; employeeId: string; data: AgentosWorkforce; close: () => void; refresh: () => Promise<void> }) {
  const [companyId, setCompanyId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [department, setDepartment] = useState("");
  const requestId = useRequestId();
  const choices = data.companies.filter(company => company.canManage && !data.assignments.some(row => row.employeeId === employeeId && row.companyId === company.id && row.status === "active"));
  const agents = useQuery({ queryKey: [...workforceKeys.account(userId), "available-agents", companyId], queryFn: () => { detachInflightGet(`/companies/${companyId}/agents`); return agentsApi.list(companyId); }, enabled: !!companyId });
  const available = agents.data?.filter(agent => !["terminated", "pending_approval"].includes(agent.status) && !["terminating", "cleaning_up", "rejected", "deleting"].includes(agent.lifecycleState ?? "") && !data.assignments.some(row => row.agentId === agent.id)) ?? [];
  const mutation = useMutation({
    mutationFn: () => { const input = { employeeId, companyId, agentId, department: department.trim() || null }; return workforceApi.assign(data.portfolio.id, { ...input, id: requestId(input) }); },
    onSuccess: async () => { await refresh(); close(); },
  });
  function submit(event: FormEvent) { event.preventDefault(); mutation.mutate(); }
  return <form className="flex flex-col gap-3" onSubmit={submit}>
    <label className="flex flex-col gap-1 text-sm">Company<NativeSelect required value={companyId} onChange={event => { setCompanyId(event.target.value); setAgentId(""); }}><option value="">Select a company</option>{choices.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</NativeSelect></label>
    <label className="flex flex-col gap-1 text-sm">Company agent<NativeSelect required disabled={!companyId || agents.isPending} value={agentId} onChange={event => setAgentId(event.target.value)}><option value="">Select an existing agent</option>{available.map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.adapterType}</option>)}</NativeSelect></label>
    {!!companyId && !agents.isPending && available.length === 0 && <p className="text-sm text-muted-foreground">No available agents. <Link className="underline" to={`/${data.companies.find(company => company.id === companyId)?.issuePrefix}/agents`}>Open company agents</Link> to hire one.</p>}
    <label className="flex flex-col gap-1 text-sm">Department (optional)<Input maxLength={120} value={department} onChange={event => setDepartment(event.target.value)} placeholder="Engineering, marketing, product…" /></label>
    <Failure error={mutation.error ?? agents.error} /><div className="flex items-center justify-between gap-3"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button type="submit" disabled={mutation.isPending || !agentId || !companyId}>Assign employee</Button></div>
  </form>;
}

function Assignment({ assignment, data, refresh }: { assignment: AgentosAssignment; data: AgentosWorkforce; refresh: () => Promise<void> }) {
  const [retiring, setRetiring] = useState(false);
  const [reason, setReason] = useState("");
  const company = data.companies.find(row => row.id === assignment.companyId)!;
  const mutation = useMutation({ mutationFn: () => workforceApi.retire(data.portfolio.id, assignment.id, { expectedRevision: assignment.revision, reason: reason.trim() }), onSuccess: async () => { setRetiring(false); await refresh(); } });
  return <div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{company.name}</span><Badge variant="secondary">{assignment.status === "retired" ? "Retired" : assignment.agentStatus}</Badge>{assignment.department && <span className="text-sm text-muted-foreground">{assignment.department}</span>}</div>
      <div className="flex flex-wrap items-center gap-3 text-sm"><Link className="underline" to={`/${company.issuePrefix}/agents/${assignment.agentId}`}>{assignment.agentName} · profile, skills & chat</Link>{assignment.status === "active" && data.canManage && company.canManage && <Button size="sm" variant="ghost" onClick={() => setRetiring(true)}>Retire assignment</Button>}</div>
    </div>
    <p className="text-xs text-muted-foreground">{assignment.harness}{assignment.status === "retired" && <> · {assignment.retirementReason}{assignment.lifecycleState !== "terminated" && assignment.lifecycleState !== "rejected" ? " · Runtime cleanup pending" : ""}</>}</p>
    {retiring && <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}>
      <p className="text-sm">Retire this company assignment and stop its agent. The employee's other company assignments continue. Task reassignment and replacement hiring remain separate actions.</p>
      <label className="flex flex-col gap-1 text-sm">Reason for retirement<Textarea required maxLength={4000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <Failure error={mutation.error} /><div className="flex items-center justify-between gap-3"><Button type="button" variant="ghost" onClick={() => setRetiring(false)}>Cancel</Button><Button type="submit" variant="destructive" disabled={mutation.isPending || !reason.trim()}>Retire from {company.name}</Button></div>
    </form>}
  </div>;
}
