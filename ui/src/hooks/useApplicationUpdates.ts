import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCompanyLiveEvent } from "../context/LiveUpdatesProvider";
import { operatingProfileKey } from "../api/operating-profile";

export const applicationQueryKey = (companyId: string | null) => ["managedApplications", companyId] as const;

export function useApplicationUpdates(companyId: string | null) {
  const client = useQueryClient();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useCompanyLiveEvent(event => {
    if (event.companyId !== companyId || pending.current) return;
    if (event.type !== "activity.logged" && !event.type.startsWith("heartbeat.run.")) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      void client.invalidateQueries({ queryKey: applicationQueryKey(companyId) });
      void client.invalidateQueries({ queryKey: operatingProfileKey(companyId) });
    }, 300);
  });
  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current);
    pending.current = null;
  }, [companyId]);
}
