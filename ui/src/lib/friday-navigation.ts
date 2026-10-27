import { fridayViewSchema, type FridayView } from "@paperclipai/shared";

export type FridayNavigation = Omit<FridayView, "version" | "panel"> & { panel: FridayView["panel"] | "library" | "canvas" | null; speakerId?: string; speakerCompanyId?: string };
export function readFridayNavigation(search: string): FridayNavigation {
  const params = new URLSearchParams(search);
  const panel = params.get("panel");
  const result = fridayViewSchema.safeParse({ version: 1, panel,
    ...Object.fromEntries(["companyId", "departmentId", "decisionId", "projectId", "applicationId", "agentId", "taskId", "mode"].flatMap(key => params.get(key) ? [[key, params.get(key)]] : [])) });
  const speaker = fridayViewSchema.shape.agentId.safeParse(params.get("speakerId") ?? undefined);
  const speakerId = speaker.success ? speaker.data : undefined;
  const company = fridayViewSchema.shape.companyId.safeParse(params.get("speakerCompanyId") ?? undefined);
  const speakerCompanyId = company.success ? company.data : undefined;
  const speakerScope = { ...(speakerId ? { speakerId } : {}), ...(speakerId && speakerCompanyId ? { speakerCompanyId } : {}) };
  if (result.success) { const { version: _, ...view } = result.data; return { ...view, ...speakerScope }; }
  return panel === "library" || panel === "canvas" ? { panel, ...speakerScope } : { panel: null };
}
// Opening a display must retain the conversation which produced it. The top-level
// Friday navigation deliberately starts with Friday again.
export function fridayConversationView(next: FridayNavigation, speakerId?: string, speakerCompanyId?: string): FridayNavigation {
  return next.panel && next.panel !== "chat" && speakerId ? { ...next, speakerId, ...(speakerCompanyId ? { speakerCompanyId } : {}) } : next;
}
export function fridayNavigationSearch(view: FridayNavigation) {
  return new URLSearchParams(Object.entries(view).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)])).toString();
}
export function parseFridayView(body: string): FridayView | null {
  try { const result = fridayViewSchema.safeParse(JSON.parse(body)); return result.success ? result.data : null; } catch { return null; }
}
