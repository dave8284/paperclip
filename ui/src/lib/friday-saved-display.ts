import { fridayViewSchema, type IssueDocument } from "@paperclipai/shared";

/** Presentation data only. Native APIs retain authorization and query ownership. */
export interface FridaySavedDisplay {
  version: 1;
  kind: "table" | "list" | "board";
  title: string;
  source: "tasks" | "projects";
  companyId: string;
  projectId?: string;
  status: "all" | "active" | "completed";
  limit: number;
}
export interface FridayDisplayScope {
  issueId: string | null;
  sourceCompanyId: string;
  accessibleCompanyIds: readonly string[];
  companyId?: string;
  projectId?: string;
}
const fields = new Set(["version", "kind", "title", "source", "companyId", "projectId", "status", "limit"]);
export const isFridayDisplayKey = (key: string) => /^friday-display-[a-z0-9][a-z0-9-]{0,63}$/.test(key);
export function parseFridaySavedDisplay(body: string): FridaySavedDisplay | null {
  if (body.length > 8192) return null;
  try {
    const value = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.has(key))) return null;
    if (value.version !== 1 || !["table", "list", "board"].includes(value.kind) || !["tasks", "projects"].includes(value.source)) return null;
    if (value.kind === "board" && value.source !== "tasks") return null;
    if (typeof value.title !== "string" || !value.title.trim() || value.title.length > 120) return null;
    if (typeof value.companyId !== "string" || !fridayViewSchema.shape.companyId.safeParse(value.companyId).success) return null;
    if (value.projectId !== undefined && (typeof value.projectId !== "string" || !fridayViewSchema.shape.projectId.safeParse(value.projectId).success)) return null;
    const status = value.status === undefined ? "all" : value.status, limit = value.limit === undefined ? 50 : value.limit;
    if (!["all", "active", "completed"].includes(status) || value.source === "projects" && status !== "all") return null;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return null;
    return { ...value, title: value.title.trim(), status, limit };
  } catch { return null; }
}
export function scopedFridaySavedDisplay(document: IssueDocument, scope: FridayDisplayScope): FridaySavedDisplay | null {
  if (!scope.issueId || document.issueId !== scope.issueId || document.companyId !== scope.sourceCompanyId || !isFridayDisplayKey(document.key)) return null;
  const display = parseFridaySavedDisplay(document.body);
  if (!display || !scope.accessibleCompanyIds.includes(display.companyId)) return null;
  if (scope.companyId && scope.companyId !== display.companyId || scope.projectId && scope.projectId !== display.projectId) return null;
  return display;
}
export function savedFridayDisplays(documents: IssueDocument[], scope: FridayDisplayScope) {
  return documents.flatMap(document => {
    const display = scopedFridaySavedDisplay(document, scope);
    return display ? [{ document, display }] : [];
  });
}
