import { useQueries } from "@tanstack/react-query";
import type { Company } from "@paperclipai/shared";
import { attentionApi } from "@/api/attention";
import { fridayApi, fridayKey } from "@/api/friday";
import { queryKeys } from "@/lib/queryKeys";
import { fridayAttentionNavigation, type FridayNavigation } from "@/lib/friday-navigation";
import { useFridayRecentTask } from "@/hooks/useFridayRecentTask";
export function FridaySuggestions({ companies, navigate, onNew }: { companies: Company[]; navigate: (view: FridayNavigation) => void; onNew: () => void }) {
  const attention = useQueries({ queries: companies.map(company => ({ queryKey: [...queryKeys.attention(company.id), "preview"], queryFn: () => attentionApi.list(company.id, { limit: 3, sort: "decide" }) })) });
  const work = useQueries({ queries: companies.map(company => ({ queryKey: [...fridayKey(company.id), "summary"], queryFn: () => fridayApi.work(company.id, { limit: 1 }) })) });
  const { recent, failed } = useFridayRecentTask(companies);
  const next = attention.flatMap((feed, i) => feed.isSuccess && !feed.isFetching ? feed.data.items.filter(item => item.companyId === companies[i].id).map(item => ({ item, company: companies[i] })) : [])[0];
  const active = work.flatMap((feed, i) => feed.isSuccess && !feed.isFetching && (feed.data.counts.in_progress ?? 0) > 0 ? [{ company: companies[i], count: feed.data.counts.in_progress }] : [])[0];
  const scope = companies.length === 1 ? { companyId: companies[0].id } : { scope: "portfolio" as const };
  return <div className="agentos-prompt-chips" aria-label="Suggested next steps">
    {next ? <button type="button" onClick={() => navigate(fridayAttentionNavigation(next.company.id, next.item))}>Review: {next.item.subject.title ?? "the next decision"}</button> : <button type="button" onClick={() => navigate({ panel: "attention", ...scope })}>What needs me?</button>}
    {active ? <button type="button" onClick={() => navigate({ panel: "work", companyId: active.company.id, mode: "graph" })}>{active.count} {active.count === 1 ? "task" : "tasks"} in motion at {active.company.name}</button> : <button type="button" onClick={() => navigate({ panel: "projects", ...scope })}>Explore projects</button>}
    {recent ? <button type="button" onClick={() => navigate({ panel: "work", companyId: recent.company.id, taskId: recent.task.id, mode: "combined" })}>{recent.task.status === "done" ? "View completed work" : "Return to"}: {recent.task.title}</button> : <button type="button" onClick={onNew}>Start something new</button>}
    {(failed || attention.some(feed => feed.isError) || work.some(feed => feed.isError)) && <span role="status" className="text-sm text-muted-foreground">Some suggestions could not be refreshed.</span>}
  </div>;
}
