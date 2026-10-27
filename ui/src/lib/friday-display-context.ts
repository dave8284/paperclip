import { issuesApi } from "@/api/issues";
import { ApiError } from "@/api/client";
import type { FridayNavigation } from "./friday-navigation";
let selection: { companyId: string; panel: string; record: Record<string, string> } | null = null;
export function setFridayDisplaySelection(companyId: string, panel: string, record: Record<string, string>) { selection = { companyId, panel, record }; }
export function clearFridayDisplaySelection() { selection = null; }
/** Native, revisioned context accompanies the next turn. It is descriptive UI
 * state, never an action, permission grant or approval. No execution is started. */
export async function syncFridayDisplayContext(issueId: string, view: FridayNavigation, nativePath?: string) {
  const { speakerId: _, speakerCompanyId: __, ...display } = view;
  const body = JSON.stringify({ version: 1, display, ...(nativePath ? { nativePath } : {}), selection: selection?.companyId === view.companyId && selection?.panel === view.panel ? selection.record : null });
  for (let attempt = 0; attempt < 2; attempt++) {
    const previous = await issuesApi.getDocument(issueId, "friday-current-display").catch(error => { if (error instanceof ApiError && error.status === 404) return null; throw error; });
    if (previous?.body === body) return;
    try {
      await issuesApi.upsertDocument(issueId, "friday-current-display", { title: "Current display", format: "markdown", body, baseRevisionId: previous?.latestRevisionId ?? null, changeSummary: "Record the user's current display for conversational context. This is not an approval." });
      return;
    } catch (error) { if (!(error instanceof ApiError && error.status === 409 && attempt === 0)) throw error; }
  }
}
