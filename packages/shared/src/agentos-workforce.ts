import { z } from "zod";

export const createAgentosPortfolioSchema = z.object({
  id: z.uuid(), homeCompanyId: z.uuid(), name: z.string().trim().min(1).max(120),
}).strict();
export const createAgentosEmployeeSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(120), specialty: z.string().trim().max(4000).default(""),
}).strict();
export const createAgentosAssignmentSchema = z.object({
  id: z.uuid(), employeeId: z.uuid(), companyId: z.uuid(), agentId: z.uuid(),
  department: z.string().trim().min(1).max(120).nullable().default(null),
}).strict();
export const retireAgentosAssignmentSchema = z.object({
  expectedRevision: z.number().int().positive(), reason: z.string().trim().min(1).max(4000),
}).strict();
export type CreateAgentosPortfolio = z.infer<typeof createAgentosPortfolioSchema>;
export type CreateAgentosEmployee = z.infer<typeof createAgentosEmployeeSchema>;
export type CreateAgentosAssignment = z.infer<typeof createAgentosAssignmentSchema>;
export type RetireAgentosAssignment = z.infer<typeof retireAgentosAssignmentSchema>;
export interface AgentosPortfolio { id: string; homeCompanyId: string; name: string; revision: number }
export interface AgentosEmployee { id: string; name: string; specialty: string; revision: number }
export interface AgentosAssignment {
  id: string; employeeId: string; companyId: string; agentId: string; department: string | null;
  status: "active" | "retired"; revision: number; retirementReason: string | null; retiredAt: string | null;
  agentName: string; agentStatus: string; lifecycleState: string; role: string; managerId: string | null; harness: string;
}
export interface AgentosWorkforce {
  portfolio: AgentosPortfolio;
  canManage: boolean;
  companies: Array<{ id: string; name: string; issuePrefix: string; status: string; description: string | null; canManage: boolean }>;
  employees: AgentosEmployee[];
  assignments: AgentosAssignment[];
  observedAt: string;
}
