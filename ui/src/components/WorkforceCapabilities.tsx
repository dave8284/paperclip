import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentosCapabilities, AgentosCapabilityAssignment, AgentosCapabilityRelease, AgentosWorkforce } from "@paperclipai/shared";
import { workforceApi, workforceKeys } from "@/api/workforce";
import { companySkillsApi } from "@/api/companySkills";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/lib/router";
import { formatDateTime } from "@/lib/utils";

function Failure({ error }: { error: unknown }) {
  return error ? <p role="alert" className="text-sm text-destructive">{error instanceof Error ? error.message : "The capability change could not be saved."}</p> : null;
}
function useIntentId() {
  const ids = useRef(new Map<string, string>());
  return (input: unknown) => { const key = JSON.stringify(input); let id = ids.current.get(key); if (!id) { id = crypto.randomUUID(); ids.current.set(key, id); } return id; };
}

export function WorkforceCapabilities({ userId, employeeId, workforce }: { userId: string | null; employeeId: string; workforce: AgentosWorkforce }) {
  const [open, setOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [offset, setOffset] = useState(0);
  const client = useQueryClient();
  const queryKey = [...workforceKeys.detail(userId, workforce.portfolio.id), "capabilities", employeeId, offset];
  const query = useQuery({ queryKey, queryFn: ({ signal }) => workforceApi.capabilities(workforce.portfolio.id, employeeId, signal, offset), enabled: open, retry: false });
  const refresh = async () => { await client.invalidateQueries({ queryKey: workforceKeys.detail(userId, workforce.portfolio.id) }); };
  return <div className="flex flex-col gap-3">
    <div><Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "Hide capabilities" : "Reviewed capabilities"}</Button></div>
    {open && <>
      <p className="text-sm text-muted-foreground">Publish a reviewed skill, then choose separately which company adopts it. Existing work keeps its captured version.</p>
      <Failure error={query.error} />
      {query.isPending && <p className="text-sm">Loading capabilities…</p>}
      {query.error && <div><Button variant="outline" size="sm" onClick={() => void query.refetch()}>Retry</Button></div>}
      {query.data && !query.error && <>
        {query.data.canPublish && !publishing && offset === 0 && <div><Button variant="outline" size="sm" onClick={() => setPublishing(true)}>Publish reviewed release</Button></div>}
        {publishing && query.data.canPublish && <PublishRelease key={employeeId} userId={userId} employeeId={employeeId} workforce={workforce} data={query.data} close={() => setPublishing(false)} refresh={refresh} />}
        {query.data.releases.length === 0 && <p className="text-sm text-muted-foreground">No reviewed capabilities have been published for this employee.</p>}
        {query.data.releases.map(release => <div key={release.id} className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3">
          <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{release.name}</span><Badge variant="secondary">Version {release.revision}</Badge></div>
          <p className="text-sm">{release.evaluationSummary}</p>
          <details><summary className="cursor-pointer text-sm">Preview published skill</summary><pre className="whitespace-pre-wrap break-words text-xs font-mono">{release.markdown}</pre></details>
          {query.data!.assignments.map(assignment => <CapabilityDecision key={assignment.assignmentId} release={release} assignment={assignment} workforce={workforce} refresh={refresh} />)}
        </div>)}
        {(offset > 0 || query.data.hasMoreReleases) && <div className="flex items-center justify-between gap-3"><Button variant="ghost" size="sm" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 100))}>Newer releases</Button><span className="text-xs text-muted-foreground">100 releases per page; selected versions always included.</span><Button variant="outline" size="sm" disabled={!query.data.hasMoreReleases} onClick={() => setOffset(value => value + 100)}>Older releases</Button></div>}
        {query.data.assignments.map(assignment => assignment.decisions.length > 0 && <details key={assignment.assignmentId}>
          <summary className="cursor-pointer text-sm">{workforce.companies.find(company => company.id === assignment.companyId)?.name} · decision history</summary>
          <div className="flex flex-col gap-2">{assignment.decisions.map(decision => <p key={decision.id} className="text-sm"><span className="font-medium">{decision.action === "refuse" ? "Refused" : decision.action === "rollback" ? "Rolled back" : "Adopted"}</span> · {query.data!.releases.find(release => release.id === decision.releaseId)?.name ?? "Earlier release"} · {decision.reason} <time className="text-xs text-muted-foreground" dateTime={decision.createdAt}>{formatDateTime(decision.createdAt)}</time></p>)}</div>
          {assignment.decisions.length >= 100 && <p className="text-xs text-muted-foreground">Showing the latest 100 decisions.</p>}
        </details>)}
      </>}
    </>}
  </div>;
}

function CapabilityDecision({ release, assignment, workforce, refresh }: {
  release: AgentosCapabilityRelease; assignment: AgentosCapabilityAssignment; workforce: AgentosWorkforce; refresh: () => Promise<void>;
}) {
  const [action, setAction] = useState<"adopt" | "refuse" | "rollback" | null>(null);
  const [reason, setReason] = useState("");
  const intent = useIntentId();
  const selected = assignment.selected.some(row => row.releaseId === release.id);
  const adoptedBefore = assignment.previouslyAdoptedReleaseIds.includes(release.id);
  const company = workforce.companies.find(row => row.id === assignment.companyId);
  const mutation = useMutation({ mutationFn: () => {
    if (!action) throw new Error("Choose a capability decision");
    const input = { releaseId: release.id, action, reason: reason.trim(), expectedAssignmentRevision: assignment.revision, expectedSelectionHash: assignment.selectionHash };
    return workforceApi.decideCapability(workforce.portfolio.id, assignment.assignmentId, { ...input, id: intent(input) });
  }, onSuccess: async () => { setAction(null); setReason(""); await refresh(); } });
  return <div className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm">{company?.name} · {selected ? "Selected for future work" : "Not selected"}</p>
      {assignment.canManage && !action && <div className="flex gap-2">{!selected && <Button size="sm" variant="outline" onClick={() => setAction(adoptedBefore ? "rollback" : "adopt")}>{adoptedBefore ? "Roll back to this version" : "Adopt"}</Button>}<Button size="sm" variant="ghost" onClick={() => setAction("refuse")}>Refuse</Button></div>}
    </div>
    {action && assignment.canManage && <form className="flex flex-col gap-3" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}>
      <p className="text-sm">{action === "refuse" ? "Record why this release is unsuitable. Selected skills stay unchanged." : `Use version ${release.revision} for ${company?.name}'s future work. Other companies and running tasks stay on their existing versions.`}</p>
      <label className="flex flex-col gap-1 text-sm">Reason<Textarea required maxLength={4000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <Failure error={mutation.error} />
      <div className="flex items-center justify-between gap-3"><Button type="button" variant="ghost" disabled={mutation.isPending} onClick={() => setAction(null)}>Cancel</Button><Button type="submit" disabled={mutation.isPending || !reason.trim()}>{mutation.isPending ? "Saving…" : action === "refuse" ? "Record refusal" : action === "rollback" ? "Roll back" : "Adopt version"}</Button></div>
    </form>}
  </div>;
}

function PublishRelease({ userId, employeeId, workforce, data, close, refresh }: {
  userId: string | null; employeeId: string; workforce: AgentosWorkforce; data: AgentosCapabilities; close: () => void; refresh: () => Promise<void>;
}) {
  const [companyId, setCompanyId] = useState("");
  const [skillId, setSkillId] = useState("");
  const [testId, setTestId] = useState("");
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const intent = useIntentId();
  const root = [...workforceKeys.account(userId), "capability-publication"];
  const skills = useQuery({ queryKey: [...root, companyId, "skills"], queryFn: () => companySkillsApi.list(companyId), enabled: !!companyId });
  const tests = useQuery({ queryKey: [...root, companyId, skillId, "tests"], queryFn: () => companySkillsApi.testRuns(companyId, skillId), enabled: !!companyId && !!skillId });
  const eligibleTests = !skills.error && !tests.error ? tests.data?.filter(test => test.status === "succeeded" && !test.deletedAt && !test.supersededAt && test.outputSnapshot.trim()) ?? [] : [];
  const test = eligibleTests.find(row => row.id === testId);
  const version = useQuery({ queryKey: [...root, companyId, skillId, test?.skillVersionId], queryFn: () => companySkillsApi.version(companyId, skillId, test!.skillVersionId), enabled: !!test });
  const markdown = test && !version.error ? version.data?.fileInventory.find(file => file.path === "SKILL.md")?.content : undefined;
  const validVersion = !skills.error && !tests.error && !version.error && !!version.data && !version.data.repositorySnapshotId && version.data.fileInventory.length === 1
    && version.data.fileInventory[0].path === "SKILL.md" && version.data.fileInventory[0].encoding !== "base64" && !version.data.fileInventory[0].executable;
  const current = data.latestRevisions[key] ?? 0;
  const mutation = useMutation({ mutationFn: () => {
    if (!test || !reviewed || !validVersion) throw new Error("Review the published skill and its test output first");
    const input = { employeeId, capabilityKey: key, name: name.trim(), expectedLatestRevision: current,
      sourceCompanyId: companyId, sourceSkillId: skillId, sourceVersionId: test.skillVersionId, sourceTestRunId: test.id,
      evaluationSummary: summary.trim(), reviewedAndSanitized: true as const };
    return workforceApi.publishCapability(workforce.portfolio.id, { ...input, id: intent(input) });
  }, onSuccess: async () => { await refresh(); close(); } });
  const company = workforce.companies.find(row => row.id === companyId);
  return <form className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3" onSubmit={event => { event.preventDefault(); mutation.mutate(); }}>
    <p className="text-sm">Publish the exact Markdown version you tested. Review the outcome and remove private company information in the source skill before testing it. Publication shares only the skill and your evaluation summary.</p>
    <label className="flex flex-col gap-1 text-sm">Source company<NativeSelect required value={companyId} onChange={event => { setCompanyId(event.target.value); setSkillId(""); setTestId(""); setReviewed(false); }}><option value="">Select company</option>{workforce.companies.filter(row => row.canManage).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</NativeSelect></label>
    <label className="flex flex-col gap-1 text-sm">Source skill<NativeSelect required value={skillId} disabled={!companyId || skills.isPending || !!skills.error} onChange={event => { setSkillId(event.target.value); setTestId(""); setReviewed(false); }}><option value="">Select skill</option>{!skills.error && skills.data?.map(skill => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</NativeSelect></label>
    {company && <Link className="text-sm underline" to={`/${company.issuePrefix}/skills${skillId ? `/${skillId}` : ""}`}>Open Skill Studio to edit or test the source</Link>}
    <label className="flex flex-col gap-1 text-sm">Completed test<NativeSelect required value={testId} disabled={!skillId || tests.isPending} onChange={event => { setTestId(event.target.value); setReviewed(false); }}><option value="">Select completed test</option>{eligibleTests.map(row => <option key={row.id} value={row.id}>{formatDateTime(row.createdAt)}</option>)}</NativeSelect></label>
    {!!skillId && !tests.isPending && !eligibleTests.length && <p className="text-sm text-muted-foreground">Run a test in Skill Studio and review its output before publishing.</p>}
    {test && <details open><summary className="cursor-pointer text-sm">Test output to review</summary><pre className="whitespace-pre-wrap break-words text-xs font-mono">{test.outputSnapshot}</pre></details>}
    {markdown && <details open><summary className="cursor-pointer text-sm">Exact skill to publish</summary><pre className="whitespace-pre-wrap break-words text-xs font-mono">{markdown}</pre></details>}
    {version.data && !validVersion && <p role="alert" className="text-sm text-destructive">This version contains repository files or scripts. Create and test a standalone Markdown-only skill first.</p>}
    <label className="flex flex-col gap-1 text-sm">Capability key<Input required pattern="[a-z][a-z0-9-]*" maxLength={80} value={key} onChange={event => setKey(event.target.value)} placeholder="review-release-plan" /><span className="text-xs text-muted-foreground">Reuse the same key to publish the next version of a capability.</span></label>
    <label className="flex flex-col gap-1 text-sm">Release name<Input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
    <label className="flex flex-col gap-1 text-sm">Reviewed evaluation summary<Textarea required maxLength={4000} value={summary} onChange={event => { setSummary(event.target.value); setReviewed(false); }} placeholder="What this skill is good for, what the test showed, and its limits" /></label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed the exact skill and test output, accepted the result, and checked the skill and summary contain no private company information.</label>
    <Failure error={mutation.error ?? skills.error ?? tests.error ?? version.error} />
    <div className="flex items-center justify-between gap-3"><Button type="button" variant="ghost" disabled={mutation.isPending} onClick={close}>Cancel</Button><Button type="submit" disabled={mutation.isPending || !validVersion || !test || !reviewed || !key || !name.trim() || !summary.trim()}>{mutation.isPending ? "Publishing…" : `Publish version ${current + 1}`}</Button></div>
  </form>;
}
