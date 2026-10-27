import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { applicationQueryKey } from "./useApplicationUpdates";
import { departmentKey } from "../api/departments";
import { queryKeys } from "../lib/queryKeys";

/** Coalesce observed changes; no idle polling and no hidden-tab work. */
export function useFridayUpdates(companyId: string) {
  const client = useQueryClient();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const refresh = () => {
    if (document.hidden || !dirty.current) return;
    dirty.current = false;
    void client.invalidateQueries({ queryKey: applicationQueryKey(companyId) });
    void client.invalidateQueries({ queryKey: queryKeys.attention(companyId) });
    void client.invalidateQueries({ queryKey: departmentKey(companyId) });
    void client.invalidateQueries({ queryKey: ["company-performance", companyId] });
  };
  useCompanyLiveEvent(event => {
    if (event.companyId !== companyId || event.type !== "activity.logged" && !event.type.startsWith("heartbeat.run.")) return;
    dirty.current = true;
    if (document.hidden || pending.current) return;
    pending.current = setTimeout(() => { pending.current = null; refresh(); }, 1000);
  });
  useEffect(() => {
    document.addEventListener("visibilitychange", refresh);
    return () => { document.removeEventListener("visibilitychange", refresh); if (pending.current) clearTimeout(pending.current); pending.current = null; dirty.current = false; };
  }, [companyId, client]);
}
