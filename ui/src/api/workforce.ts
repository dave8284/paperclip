import type { AgentosPortfolio, AgentosWorkforce, CreateAgentosPortfolio, CreateAgentosEmployee, CreateAgentosAssignment, RetireAgentosAssignment,
  AgentosCapabilities, AgentosCapabilityRelease, PublishAgentosCapability, DecideAgentosCapability,
  PortfolioReadMandate, SavePortfolioReadMandate, SetBoardDirectionAuthority } from "@paperclipai/shared";
import { api, detachInflightGet } from "./client";

const root = "/agentos/portfolios";
// Account-specific queries must not coalesce with a previous session's request.
function read<T>(path: string, signal?: AbortSignal) {
  detachInflightGet(path);
  return api.get<T>(path, { signal, cache: "no-store" });
}
export const workforceApi = {
  list: (signal?: AbortSignal) => read<AgentosPortfolio[]>(root, signal),
  get: (id: string, signal?: AbortSignal) => read<AgentosWorkforce>(`${root}/${id}`, signal),
  create: (input: CreateAgentosPortfolio) => api.post<AgentosPortfolio>(root, input),
  linkCompany: (id: string, companyId: string) => api.post(`${root}/${id}/companies`, { companyId }),
  createEmployee: (id: string, input: CreateAgentosEmployee) => api.post(`${root}/${id}/employees`, input),
  assign: (id: string, input: CreateAgentosAssignment) => api.post(`${root}/${id}/assignments`, input),
  retire: (id: string, assignmentId: string, input: RetireAgentosAssignment) => api.post(`${root}/${id}/assignments/${assignmentId}/retire`, input),
  capabilities: (id: string, employeeId: string, signal?: AbortSignal, offset = 0) => read<AgentosCapabilities>(`${root}/${id}/employees/${employeeId}/capabilities?offset=${offset}`, signal),
  publishCapability: (id: string, input: PublishAgentosCapability) => api.post<AgentosCapabilityRelease>(`${root}/${id}/capabilities`, input),
  decideCapability: (id: string, assignmentId: string, input: DecideAgentosCapability) => api.post(`${root}/${id}/assignments/${assignmentId}/capabilities`, input),
  mandates: (id: string, signal?: AbortSignal) => read<PortfolioReadMandate[]>(`${root}/${id}/read-mandates`, signal),
  saveMandate: (id: string, input: SavePortfolioReadMandate) => api.post<PortfolioReadMandate>(`${root}/${id}/read-mandates`, input),
  revokeMandate: (id: string, mandateId: string, expectedRevision: number) => api.post<PortfolioReadMandate>(`${root}/${id}/read-mandates/${mandateId}/revoke`, { expectedRevision }),
  setBoardDirectionAuthority: (id: string, mandateId: string, input: SetBoardDirectionAuthority) => api.post<PortfolioReadMandate>(`${root}/${id}/read-mandates/${mandateId}/board-direction-authority`, input),
};
export const workforceKeys = {
  account: (userId: string | null) => ["agentos-workforce", userId] as const,
  list: (userId: string | null) => [...workforceKeys.account(userId), "portfolios"] as const,
  detail: (userId: string | null, portfolioId: string) => [...workforceKeys.account(userId), portfolioId] as const,
};
