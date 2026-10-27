import type { AgentOSDepartment } from "@paperclipai/shared";
import { api } from "./client";
export const departmentKey = (companyId: string) => ["agentos-departments", companyId] as const;
export const departmentsApi = {
  list: (companyId: string) => api.get<AgentOSDepartment[]>(`/companies/${companyId}/friday/departments`),
  create: (companyId: string, data: { name: string; description: string; leadAgentId?: string | null }) => api.post<AgentOSDepartment>(`/companies/${companyId}/friday/departments`, data),
  update: (companyId: string, id: string, data: { name: string; description: string; leadAgentId?: string | null; expectedRevision: number }) => api.patch<AgentOSDepartment>(`/companies/${companyId}/friday/departments/${id}`, data),
  remove: (companyId: string, id: string, revision: number) => api.delete<void>(`/companies/${companyId}/friday/departments/${id}?revision=${revision}`),
  assign: (companyId: string, projectId: string, departmentId: string | null) => api.put(`/companies/${companyId}/friday/projects/${projectId}/department`, { departmentId }),
};
