import { z } from "zod";
import type { FridayWork } from "./friday-workspace.js";
import type { PortfolioReadScope } from "./agentos-portfolio-mandates.js";

export const employeeAwarenessQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(5).default(3),
  mandateId: z.uuid().optional(),
  revision: z.coerce.number().int().positive().optional(),
  assignmentId: z.uuid().optional(),
  assignmentRevision: z.coerce.number().int().positive().optional(),
  workOffset: z.coerce.number().int().min(0).max(100000).optional(),
  projectOffset: z.coerce.number().int().min(0).max(100000).optional(),
}).strict().refine(value => !!value.mandateId === (value.revision !== undefined), "Supply the mandate and its exact revision together")
  .refine(value => !!value.assignmentId === (value.assignmentRevision !== undefined), "Supply the assignment and its exact revision together")
  .refine(value => !value.assignmentId || (!!value.mandateId && value.offset === 0), "Assignment continuation requires a mandate and no assignment-list offset")
  .refine(value => (value.workOffset === undefined && value.projectOffset === undefined) || !!value.assignmentId,
    "Work continuation requires an exact assignment");
export type EmployeeAwarenessQuery = z.infer<typeof employeeAwarenessQuerySchema>;

/** Native evidence visible to the requesting actor. A shared identity is not a
 * company permission and this response never implies hidden assignments exist. */
export interface EmployeeAwareness {
  observedAt: string;
  scope: "current_company" | "authorized_companies" | "authorized_assignments";
  mandate?: { id: string; revision: number; readScope: PortfolioReadScope };
  employee: { id: string; name: string; specialty: string } | null;
  assignments: Array<{
    assignmentId: string | null;
    assignmentRevision?: number;
    readScope?: "current_company" | PortfolioReadScope;
    company: { id: string; name: string };
    agent: { id: string; name: string; status: string };
    department: string | null;
    work: FridayWork;
  }>;
  /** Offset among authorized assignments only. Task/project pagination within
   * a delegated assignment uses this endpoint with the mandate, assignment ID,
   * assignment revision and workOffset/projectOffset. Ordinary local/board
   * reads retain the company Friday work endpoint. */
  nextOffset: number | null;
}
