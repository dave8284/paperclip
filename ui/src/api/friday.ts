import type { FridayWork, FridayWorkQuery } from "@paperclipai/shared";
import { api, type RequestOptions } from "./client";
import { applicationQueryKey } from "../hooks/useApplicationUpdates";

export const fridayKey = (companyId: string) => [...applicationQueryKey(companyId), "friday"] as const;
function queryString(query: Partial<FridayWorkQuery>) {
  return new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => [key, String(value)])).toString();
}
export const fridayApi = {
  work: (companyId: string, query: Partial<FridayWorkQuery> = {}, options?: RequestOptions) => api.get<FridayWork>(`/companies/${companyId}/friday/work?${queryString(query)}`, options),
};
