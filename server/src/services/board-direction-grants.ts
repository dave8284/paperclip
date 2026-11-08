import type { agentosPortfolioMandates, principalPermissionGrants } from "@paperclipai/db";
import { portfolioMandateGrantScope } from "./portfolio-mandate-grants.js";

type Mandate = typeof agentosPortfolioMandates.$inferSelect;
type Grant = typeof principalPermissionGrants.$inferSelect;
export const BOARD_DIRECTION_PERMISSION = "workforce:board_direct" as const;
export function boardDirectionGrantScope(row: Mandate) {
  return { ...portfolioMandateGrantScope(row), action: "board_direction:create", readGrantId: row.grantId };
}
export function matchesBoardDirectionGrant(row: Mandate, grant: Grant | undefined, now = new Date()) {
  if (!grant || row.revokedAt || (row.expiresAt && row.expiresAt <= now) || !row.grantId
    || row.readScope !== "owner_accessible_private" || grant.companyId !== row.sourceCompanyId
    || grant.principalType !== "agent" || grant.principalId !== row.sourceAgentId
    || grant.permissionKey !== BOARD_DIRECTION_PERMISSION || grant.grantedByUserId !== row.ownerUserId) return false;
  const expected = boardDirectionGrantScope(row), actual = grant.scope;
  return actual !== null && JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(Object.keys(expected).sort())
    && Object.entries(expected).every(([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value));
}
