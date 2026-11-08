import type { ModelComparisonDiscovery, PreparedModelComparisonResult, PrepareModelComparison } from "@paperclipai/shared";
import { api, requestResponse } from "./client";
import { readApiJson } from "./response";
import type { CurrentBoardAccess } from "./access";

const path = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/friday/model-comparisons`;
export const modelComparisonsKey = (companyId: string, userId: string | null) => ["model-comparisons", companyId, userId] as const;
export const modelComparisonsApi = {
  access: async (signal?: AbortSignal) => readApiJson<CurrentBoardAccess>(await requestResponse("/cli-auth/me", { method: "GET", cache: "no-store", signal })),
  // Bypass URL-only coalescing: separate accounts must never share private task
  // choices, even while the prior account's request is still in flight.
  discover: async (companyId: string, signal?: AbortSignal) => readApiJson<ModelComparisonDiscovery>(await requestResponse(path(companyId), { method: "GET", cache: "no-store", signal })),
  prepare: (companyId: string, input: PrepareModelComparison) => api.post<PreparedModelComparisonResult>(`${path(companyId)}/prepare`, input),
};
