import { useEffect, useMemo, useReducer } from "react";
import { useQueries } from "@tanstack/react-query";
import type { Company } from "@paperclipai/shared";
import { useAccountIdentity } from "@/api/companies-query";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { getRecentTasksStorageKey, readRecentTasks, RECENT_TASKS_UPDATED_EVENT } from "@/lib/recent-tasks";

/** Existing personal recents supply IDs and ordering, never display authority.
 * Native task summaries must confirm the current account can still read them. */
export function useFridayRecentTask(companies: Company[]) {
  const { userId, settled } = useAccountIdentity();
  const scope = JSON.stringify([settled, userId, companies.map(company => company.id)]);
  const [revision, refresh] = useReducer(value => value + 1, 0);
  const history = useMemo(() => settled ? companies.map(company => ({
    company,
    storageKey: getRecentTasksStorageKey(company.id, userId),
    entries: readRecentTasks(getRecentTasksStorageKey(company.id, userId), company.id),
  })) : [], [scope, revision]);
  useEffect(() => {
    const keys = new Set(history.map(item => item.storageKey));
    const storage = (event: StorageEvent) => { if (event.key === null || keys.has(event.key)) refresh(); };
    const activity = (event: Event) => {
      const key = (event as CustomEvent<{ storageKey?: string }>).detail?.storageKey;
      if (key && keys.has(key)) refresh();
    };
    window.addEventListener("storage", storage);
    window.addEventListener(RECENT_TASKS_UPDATED_EVENT, activity);
    return () => {
      window.removeEventListener("storage", storage);
      window.removeEventListener(RECENT_TASKS_UPDATED_EVENT, activity);
    };
  }, [scope]);
  const summaries = useQueries({ queries: history.map(({ company, entries }) => {
    const ids = entries.map(entry => entry.id).sort();
    return {
      queryKey: queryKeys.issues.summaryBatch(company.id, userId, ids),
      queryFn: ({ signal }: { signal: AbortSignal }) => issuesApi.summaries(company.id, ids, { signal }),
      enabled: ids.length > 0,
      retry: false,
      staleTime: 0,
      refetchOnMount: "always" as const,
    };
  }) });
  const candidates = summaries.flatMap((query, index) => {
    // Do not offer old cached titles while rechecking access or after failure.
    if (!query.isSuccess || query.isFetching) return [];
    const { company, entries } = history[index];
    return query.data.flatMap(task => {
      const entry = entries.find(item => item.id === task.id);
      if (!entry || task.companyId !== company.id || task.status === "cancelled") return [];
      return [{ task, company, recordedAt: entry.recordedAt }];
    });
  }).sort((left, right) => right.recordedAt - left.recordedAt || left.task.id.localeCompare(right.task.id));
  return { recent: candidates[0], failed: summaries.some(query => query.isError) };
}
