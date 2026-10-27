import { z } from "zod";
export const createDepartmentSchema = z.object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(4000).default("") }).strict();
export const updateDepartmentSchema = createDepartmentSchema.extend({ expectedRevision: z.number().int().positive() });
export const assignDepartmentProjectSchema = z.object({ departmentId: z.string().uuid().nullable() }).strict();
export interface AgentOSDepartment { id: string; companyId: string; name: string; description: string; revision: number; projectIds: string[] }
