import { useQuery } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import { agentsApi } from "../api/agents";
import { fridayApi, fridayKey } from "../api/friday";
import { Link } from "../lib/router";
import type { FridayNavigation } from "../lib/friday-navigation";
import { Button } from "./ui/button";

export function FridayTeam({ companyId, agents, agentId, navigate }: { companyId: string; agents: Agent[]; agentId?: string; navigate: (view: FridayNavigation) => void }) {
  const agent = agents.find(item => item.id === agentId);
  const work = useQuery({ queryKey: [...fridayKey(companyId), "agent", agentId], queryFn: () => fridayApi.work(companyId, { agentId }), enabled: !!agent });
  const skills = useQuery({ queryKey: ["friday-agent-skills", companyId, agentId], queryFn: () => agentsApi.skills(agentId!, companyId), enabled: !!agent });
  return <div className="space-y-4">
    <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" aria-label="Inspect agent" value={agentId ?? ""} onChange={event => navigate({ panel: "team", agentId: event.target.value || undefined })}><option value="">All agents</option>{agents.map(item => <option key={item.id} value={item.id}>{item.name} · {item.title ?? item.role}</option>)}</select>
    {!agent && <div className="friday-team-grid">{agents.map(item => <button type="button" key={item.id} className="friday-work-task" onClick={() => navigate({ panel: "team", agentId: item.id })}><span className="block text-sm font-semibold">{item.name}</span><span className="block text-xs text-muted-foreground">{item.title ?? item.role} · {item.status.replaceAll("_", " ")}</span></button>)}</div>}
    {agent && <><div><h3 className="font-semibold">{agent.name}</h3><p className="text-sm text-muted-foreground">{agent.title ?? agent.role} · {agent.status.replaceAll("_", " ")}</p><p className="mt-2 text-sm">{agent.capabilities || "No capability description recorded yet."}</p></div>
      <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => navigate({ panel: "chat", agentId: agent.id })}>Talk to {agent.name}</Button><Button variant="outline" size="sm" onClick={() => navigate({ panel: "work", agentId: agent.id, mode: "combined" })}>See all work</Button><Button variant="ghost" size="sm" asChild><Link to={`/agents/${agent.id}`}>Profile & instructions</Link></Button></div>
      {[work.error, skills.error].filter(Boolean).map((error, index) => <p role="alert" className="text-sm text-destructive" key={index}>{error!.message}</p>)}
      {work.data && !work.error && <section className="space-y-2"><h4 className="text-sm font-semibold">Across {work.data.projectCount} projects</h4>{work.data.projects.map(project => <button type="button" className="friday-work-task" key={project.id} onClick={() => navigate({ panel: "work", projectId: project.id, agentId: agent.id, mode: "combined" })}><span className="text-sm">{project.name}</span><span className="ml-2 text-xs text-muted-foreground">{project.leadAgentId === agent.id ? "Project lead" : "Assigned work"}</span></button>)}<p className="text-xs text-muted-foreground">{Object.entries(work.data.counts).map(([state, count]) => `${count} ${state.replaceAll("_", " ")}`).join(" · ") || "No assigned tasks."}{work.data.nextProjectOffset != null ? " Open all work to page through more projects." : ""}</p></section>}
      {skills.data && !skills.error && <section className="space-y-2"><h4 className="text-sm font-semibold">Skills</h4>{skills.data.entries.filter(skill => skill.desired || skill.state === "installed").map(skill => <div key={skill.key} className="rounded-md border p-3"><p className="text-sm">{skill.runtimeName ?? skill.key}</p><p className="text-xs text-muted-foreground">{skill.state}{skill.versionId ? ` · version ${skill.versionId.slice(0, 8)}` : ""}</p></div>)}{!skills.data.entries.some(skill => skill.desired || skill.state === "installed") && <p className="text-sm text-muted-foreground">No installed or assigned skills reported. Role instructions are available in the profile.</p>}{skills.data.warnings.map(warning => <p key={warning} className="text-xs text-muted-foreground">{warning}</p>)}</section>}
    </>}
  </div>;
}
