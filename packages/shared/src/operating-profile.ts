import { z } from "zod";

export const updateOperatingProfileSchema = z.object({
  fridayAgentId: z.string().uuid().nullable(),
  /** Compare-and-set: changing the coordinator must not overwrite another operator. */
  expectedRevision: z.number().int().min(0),
}).strict();

export interface OperatingProfile {
  companyId: string;
  fridayAgentId: string | null;
  revision: number;
  modelBilling: "subscription_only";
}
export type UpdateOperatingProfile = z.infer<typeof updateOperatingProfileSchema>;
