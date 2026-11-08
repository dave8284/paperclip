import type { agentosPortfolioMandates, principalPermissionGrants } from "@paperclipai/db";
type Mandate = typeof agentosPortfolioMandates.$inferSelect;
type Grant = typeof principalPermissionGrants.$inferSelect;
export const PORTFOLIO_READ_PERMISSION = "workforce:portfolio_read" as const;
export function portfolioMandateGrantScope(row: Pick<Mandate, "id" | "portfolioId" | "revision" | "sourceCompanyId" | "sourceAgentId" | "targetCompanyIds" | "action" | "readScope" | "expiresAt">) {
  return { mandateId: row.id, portfolioId: row.portfolioId, revision: row.revision,
    sourceCompanyId: row.sourceCompanyId, sourceAgentId: row.sourceAgentId, targetCompanyIds: [...row.targetCompanyIds].sort(),
    action: row.action, readScope: row.readScope, expiresAt: row.expiresAt?.toISOString() ?? null };
}
export function matchesPortfolioMandateGrant(row: Mandate, grant: Grant | undefined) {
  if (!grant || grant.id !== row.grantId || grant.companyId !== row.sourceCompanyId || grant.principalType !== "agent"
    || grant.principalId !== row.sourceAgentId || grant.permissionKey !== PORTFOLIO_READ_PERMISSION || grant.grantedByUserId !== row.ownerUserId) return false;
  const expected = portfolioMandateGrantScope(row);
  return grant.scope !== null && JSON.stringify(Object.keys(grant.scope).sort()) === JSON.stringify(Object.keys(expected).sort())
    && Object.entries(expected).every(([key, value]) => JSON.stringify(grant.scope![key]) === JSON.stringify(value));
}
