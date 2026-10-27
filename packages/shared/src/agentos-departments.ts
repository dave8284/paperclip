import { z } from "zod";
export const createDepartmentSchema = z.object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(4000).default(""), leadAgentId: z.string().uuid().nullable().optional() }).strict();
export const updateDepartmentSchema = createDepartmentSchema.extend({ expectedRevision: z.number().int().positive() });
export const assignDepartmentProjectSchema = z.object({ departmentId: z.string().uuid().nullable() }).strict();
export interface AgentOSDepartment { id: string; companyId: string; name: string; description: string; leadAgentId: string | null; revision: number; projectIds: string[] }
