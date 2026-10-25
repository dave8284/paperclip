import type { OperatingProfile, UpdateOperatingProfile } from "@paperclipai/shared";
import { api } from "./client";
export const operatingProfileKey = (companyId: string | null) => ["operatingProfile", companyId] as const;
export const operatingProfileApi = {
  get: (companyId: string) => api.get<OperatingProfile>(`/companies/${companyId}/operating-profile`),
  update: (companyId: string, input: UpdateOperatingProfile) => api.put<OperatingProfile>(`/companies/${companyId}/operating-profile`, input),
};
