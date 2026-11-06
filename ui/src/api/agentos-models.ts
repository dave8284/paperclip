import type { Analytics } from "@agentos/model-intelligence";
import type { AiConnectionList, ModelProfileQualification, ModelProfileQualificationList, RegisterModelProfileQualification } from "@paperclipai/shared";
import { api, requestResponse } from "./client";
import { readApiJson } from "./response";

export interface AgentOSModelCatalog {
  learning: Analytics | null;
  learningAccess?: "admin" | "restricted";
  models: Array<{ id: string; label: string; provider: string; observed: boolean; configuredAgents: Array<{ id: string; name: string }> }>;
}

// These account-sensitive reads bypass the shared URL-only in-flight cache.
async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  return readApiJson<T>(await requestResponse(path, { method: "GET", cache: "no-store", signal }));
}
const base = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/friday/model-qualifications`;
export const agentosModelsKey = (companyId: string, userId: string | null) => ["agentos-model-settings", companyId, userId] as const;
export const agentosModelsApi = {
  accounts: (companyId: string, signal?: AbortSignal) => read<AiConnectionList>(`/companies/${encodeURIComponent(companyId)}/ai-connections`, signal),
  catalog: (companyId: string, signal?: AbortSignal) => read<AgentOSModelCatalog>(`/companies/${encodeURIComponent(companyId)}/friday/models`, signal),
  qualifications: (companyId: string, signal?: AbortSignal) => read<ModelProfileQualificationList>(base(companyId), signal),
  register: (companyId: string, input: RegisterModelProfileQualification) => api.post<{ created: boolean; qualification: ModelProfileQualification }>(base(companyId), input),
  revoke: (companyId: string, id: string) => api.delete<ModelProfileQualification>(`${base(companyId)}/${encodeURIComponent(id)}`),
};
