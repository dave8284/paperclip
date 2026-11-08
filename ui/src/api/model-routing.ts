import type { ConfigureModelRouting, RollbackModelRouting, ModelRoutingDiscovery } from "@paperclipai/shared";
import { api, requestResponse } from "./client";
import { readApiJson } from "./response";
const path = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/friday/model-routing`;
export const modelRoutingKey = (companyId: string, userId: string | null) => ["model-routing", companyId, userId] as const;
export const modelRoutingApi = {
  discover: async (companyId: string, signal?: AbortSignal) => readApiJson<ModelRoutingDiscovery>(await requestResponse(path(companyId), { method: "GET", cache: "no-store", signal })),
  configure: (companyId: string, input: ConfigureModelRouting) => api.post<{ revision: number; mode: ConfigureModelRouting["mode"] }>(`${path(companyId)}/policy`, input),
  rollback: (companyId: string, input: RollbackModelRouting) => api.post<{ releaseId: string; state: "rolled_back" }>(`${path(companyId)}/rollback`, input),
};
