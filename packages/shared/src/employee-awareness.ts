import { z } from "zod";
import type { FridayWork } from "./friday-workspace.js";

export const employeeAwarenessQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(5).default(3),
}).strict();
export type EmployeeAwarenessQuery = z.infer<typeof employeeAwarenessQuerySchema>;

/** Native evidence visible to the requesting actor. A shared identity is not a
 * company permission and this response never implies hidden assignments exist. */
export interface EmployeeAwareness {
  observedAt: string;
  scope: "current_company" | "authorized_companies";
  employee: { id: string; name: string; specialty: string } | null;
  assignments: Array<{
    assignmentId: string | null;
    company: { id: string; name: string };
    agent: { id: string; name: string; status: string };
    department: string | null;
    work: FridayWork;
  }>;
  /** Offset among authorized assignments only. Task/project pagination within
   * an assignment uses its existing company Friday work endpoint. */
  nextOffset: number | null;
}
