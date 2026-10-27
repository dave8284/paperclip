/** Portable task taxonomy. Classification is transparent and rule-based;
 * model preference is learned separately from reviewed execution outcomes. */
export const TASK_FAMILIES = [
  { id: "engineering.debugging", name: "Debugging", signals: "bug, regression, crash, error", checks: "Reproduction fails before the fix; relevant checks pass after it.", pattern: /\b(bug|regression|crash|debug|exception)\b/ },
  { id: "engineering.testing", name: "Test work", signals: "test, coverage, fixture", checks: "Tests detect the intended failure and cover meaningful behavior.", pattern: /\b(test|tests|coverage|fixture)\b/ },
  { id: "engineering.building", name: "Implementation", signals: "code, implement, refactor", checks: "Acceptance criteria, type checks and relevant integration tests pass.", pattern: /\b(code|implement|refactor|develop|feature)\b/ },
  { id: "operations.production", name: "Production operations", signals: "deploy, incident, monitor", checks: "Health receipts, successful verification and a recoverable release.", pattern: /\b(deploy|incident|monitor|uptime|production)\b/ },
  { id: "content.campaign", name: "Campaign planning", signals: "campaign, marketing, audience", checks: "Audience, objective, channel, measurement and brand constraints match.", pattern: /\b(campaign|marketing|audience|growth)\b/ },
  { id: "content.writing", name: "Content creation", signals: "copy, video, content, social", checks: "Claims checked, brief fulfilled and output reviewed before publication.", pattern: /\b(copy|video|content|social|post|write)\b/ },
  { id: "analysis.research", name: "Research & analysis", signals: "research, compare, analyse", checks: "Cited evidence, reproducible analysis and explicit uncertainties.", pattern: /\b(analy[sz]e|research|compare|investigate)\b/ },
  { id: "product.planning", name: "Product & strategy", signals: "strategy, roadmap, plan", checks: "Problem, constraints, prioritisation and success criteria are explicit.", pattern: /\b(strategy|roadmap|plan|product)\b/ },
  { id: "operations.support", name: "Support & reporting", signals: "invoice, support, report", checks: "Source records reconcile and the requested outcome is verified.", pattern: /\b(invoice|subscription|support|report|finance)\b/ },
  { id: "coordination.general", name: "Coordination", signals: "Fallback when no specific family matches", checks: "Owner, next action, dependencies and follow-through are recorded.", pattern: null },
];
export function classifyWork(title, description) {
  const text = `${title} ${description ?? ""}`.toLowerCase();
  const family = TASK_FAMILIES.find(row => row.pattern?.test(text)) ?? TASK_FAMILIES.at(-1);
  return { taskType: family.id, complexity: /\b(production|security|migration|architecture|financial|payment|refund|critical|incident|strategy)\b/.test(text) || text.length > 4000 ? "complex" : "routine" };
}
export const taskFamilyCatalog = () => TASK_FAMILIES.map(({ pattern, ...row }) => row);
