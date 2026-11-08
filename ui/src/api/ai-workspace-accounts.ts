import type {
  AiWorkspaceAccountSummary, AiWorkspaceAccountLinkSummary, EnrollAiWorkspaceAccount,
  InstallAiWorkspaceAccount, UpdateAiWorkspaceAccount,
  AiWorkspaceAccountSetupResult, AiWorkspaceAccountSetupRetry,
} from "@paperclipai/shared";
import { api, detachInflightGet } from "./client";

const path = "/instance/ai-accounts";
export const aiWorkspaceAccountsApi = {
  companySetup: (companyId: string, signal?: AbortSignal) => {
    const statusPath = `${path}/companies/${companyId}/setup`;
    detachInflightGet(statusPath);
    return api.get<AiWorkspaceAccountSetupResult>(statusPath, { signal, cache: "no-store" });
  },
  list: (signal?: AbortSignal) => {
    // A new session must never join the previous owner's in-flight request.
    detachInflightGet(path);
    return api.get<AiWorkspaceAccountSummary[]>(path, { signal, cache: "no-store" });
  },
  enroll: (input: EnrollAiWorkspaceAccount) => api.post<AiWorkspaceAccountSummary>(`${path}/enroll`, input),
  update: (id: string, input: UpdateAiWorkspaceAccount) => api.patch<AiWorkspaceAccountSummary>(`${path}/${id}`, input),
  install: (id: string, companyId: string, input: InstallAiWorkspaceAccount) =>
    api.post<AiWorkspaceAccountLinkSummary | { source: true; companyId: string; connectionId: string; grantId: string }>(`${path}/${id}/companies/${companyId}`, input),
  revoke: (id: string, companyId: string, input: InstallAiWorkspaceAccount) =>
    api.delete<AiWorkspaceAccountLinkSummary>(`${path}/${id}/companies/${companyId}`, input),
  finishSetup: (retry: AiWorkspaceAccountSetupRetry) => {
    if (retry.kind === "connection") return api.post<AiWorkspaceAccountSetupResult>(`${path}/setup`, {
      companyId: retry.companyId, connectionId: retry.connectionId, grantId: retry.grantId,
    });
    if (retry.kind === "account") return api.post<AiWorkspaceAccountSetupResult>(`${path}/${retry.accountId}/setup`, {});
    return api.post<AiWorkspaceAccountSetupResult>(`${path}/companies/${retry.companyId}/setup`, {});
  },
};

export const aiWorkspaceAccountKeys = {
  all: ["ai-workspace-accounts"] as const,
  list: (userId: string | null, companyId: string) => ["ai-workspace-accounts", userId, companyId] as const,
};
