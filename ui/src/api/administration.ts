import {
  adminEventSchema, adminInvitationSchema, adminOverviewSchema, adminPeopleResponseSchema, adminModelIntelligenceSchema,
  publicAuthOptionsSchema, registrationStateSchema, type AdminUserUpdate,
} from "@paperclipai/shared";
import { api, requestResponse } from "./client";
import { readApiJson } from "./response";

// Identity-sensitive reads bypass the shared URL-only in-flight cache.
async function read<T>(path: string, schema: { parse(value: unknown): T }) {
  const response = await requestResponse(path, { cache: "no-store" });
  return schema.parse(await readApiJson(response));
}
export const administrationApi = {
  registration: () => read("/registration", registrationStateSchema),
  authOptions: () => read("/registration/options", publicAuthOptionsSchema),
  overview: () => read("/admin/overview", adminOverviewSchema),
  people: (query: string, status: string, offset: number) => read(`/admin/people?${new URLSearchParams({ query, ...(status ? { status } : {}), offset: String(offset) })}`, adminPeopleResponseSchema),
  update: (id: string, input: AdminUserUpdate) => api.patch(`/admin/people/${encodeURIComponent(id)}`, input),
  delete: (id: string, expectedRevision: number, confirmEmail: string) => api.delete(`/admin/people/${encodeURIComponent(id)}`, { expectedRevision, confirmEmail }),
  invitations: () => read("/admin/preapprovals", adminInvitationSchema.array()),
  invite: (name: string, email: string) => api.post("/admin/preapprovals", { name, email }),
  revokeInvitation: (id: string) => api.delete(`/admin/preapprovals/${encodeURIComponent(id)}`),
  events: () => read("/admin/events", adminEventSchema.array()),
  intelligence: () => read("/admin/model-intelligence", adminModelIntelligenceSchema),
};
export const registrationKey = (userId: string | null) => ["registration", userId] as const;
export const adminKey = (userId: string | null) => ["administration", userId] as const;
