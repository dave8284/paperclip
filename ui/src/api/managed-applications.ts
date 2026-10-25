import type { ApplicationWork, CreateManagedApplication, ManagedApplication, ManagedApplicationPage, UpdateManagedApplication } from "@paperclipai/shared";
import { api } from "./client";

const base = (companyId: string) => `/companies/${encodeURIComponent(companyId)}/managed-applications`;
export const managedApplicationsApi = {
  list: (companyId: string, after?: string) => api.get<ManagedApplicationPage>(`${base(companyId)}${after ? `?after=${encodeURIComponent(after)}` : ""}`),
  create: (companyId: string, body: CreateManagedApplication) => api.post<ManagedApplication>(base(companyId), body),
  update: (companyId: string, id: string, body: UpdateManagedApplication) => api.patch<ManagedApplication>(`${base(companyId)}/${id}`, body),
  work: (companyId: string, id: string, offset = 0, projectId?: string, assigneeAgentId?: string) => {
    const query = new URLSearchParams({ offset: String(offset) });
    if (projectId) query.set("projectId", projectId);
    if (assigneeAgentId) query.set("assigneeAgentId", assigneeAgentId);
    return api.get<ApplicationWork>(`${base(companyId)}/${id}/work?${query}`);
  },
  linkProject: (companyId: string, id: string, projectId: string) => api.post<void>(`${base(companyId)}/${id}/projects`, { projectId }),
  unlinkProject: (companyId: string, id: string, projectId: string) => api.delete<void>(`${base(companyId)}/${id}/projects/${projectId}`),
};
