import type { Agent } from "@paperclipai/shared";
export const agentCategories = ["Coordination", "Engineering", "Marketing", "Product", "Sales", "Operations", "Specialist"] as const;
export type AgentCategory = typeof agentCategories[number];
/** Display grouping from the employee's declared role/title, not inferred skill. */
export function agentCategory(agent?: Pick<Agent, "role" | "title">): AgentCategory {
  const role = `${agent?.role ?? ""} ${agent?.title ?? ""}`.toLowerCase();
  if (/ceo|coordinat|chief of staff|director/.test(role)) return "Coordination";
  if (/engineer|develop|code|cto|qa|test/.test(role)) return "Engineering";
  if (/market|content|social|growth|creative/.test(role)) return "Marketing";
  if (/product|design|research/.test(role)) return "Product";
  if (/sales|revenue|account exec/.test(role)) return "Sales";
  if (/operat|finance|support|security|legal/.test(role)) return "Operations";
  return "Specialist";
}
