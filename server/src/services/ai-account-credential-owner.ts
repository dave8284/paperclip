import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  aiWorkspaceAccounts, aiWorkspaceAccountLinks, authUsers, companies,
  companyMemberships, connectionGrantMembers, connectionGrants,
  principalPermissionGrants, toolConnections, type Db,
} from "@paperclipai/db";
import { aiConnectionMetadataSchema, aiSubscriptionNeedsIsolatedLogin } from "@paperclipai/shared";
import { unprocessable } from "../errors.js";
import { authorizationService } from "./authorization.js";

export type AiCredentialSelection = {
  connection: typeof toolConnections.$inferSelect;
  grant: typeof connectionGrants.$inferSelect;
};
export interface AiCredentialOwnerBinding {
  accountId: string; accountRevision: number;
  /** The canonical source has no company alias. */
  linkId: string | null; linkRevision: number | null;
}
export type AiCredentialOwner = AiCredentialSelection & { binding?: AiCredentialOwnerBinding };

/** No credential bytes, account label, or company work enters this snapshot.
 * Callers separately bind the secret's epoch/version around credential reads. */
export function aiCredentialOwnerSnapshot(owner: AiCredentialOwner) {
  const ref = owner.grant.credentialSecretRefs.find(value => value.configPath === "ai.credential");
  return {
    companyId: owner.connection.companyId, connectionId: owner.connection.id, grantId: owner.grant.id,
    credential: ref ? { secretId: ref.secretId, versionSelector: ref.versionSelector ?? "latest" } : null,
    binding: owner.binding ? { ...owner.binding } : null,
  };
}
export type AiCredentialOwnerSnapshot = ReturnType<typeof aiCredentialOwnerSnapshot>;
export function sameAiCredentialOwner(left: AiCredentialOwnerSnapshot, right: AiCredentialOwnerSnapshot) {
  return isDeepStrictEqual(left, right);
}

function unavailable(): never {
  throw unprocessable("The connected AI account is unavailable for this company.", { code: "ai_workspace_account_unavailable" });
}
function nativeIdentity(selection: AiCredentialSelection) {
  if (selection.connection.companyId !== selection.grant.companyId || selection.connection.id !== selection.grant.connectionId) unavailable();
}
function activeSubscription(selection: AiCredentialSelection) {
  nativeIdentity(selection);
  const { connection, grant } = selection;
  const metadata = aiConnectionMetadataSchema.safeParse(connection.config.ai);
  if (connection.connectionPurpose !== "ai" || connection.transport !== "runtime_auth"
    || connection.credentialSource !== "paperclip_vault" || connection.externalCredential || grant.externalCredential
    || !connection.enabled || connection.status !== "active" || connection.healthStatus !== "ok"
    || grant.status !== "active" || grant.revokedAt
    || !metadata.success || metadata.data.method !== "subscription" || metadata.data.routing
    || aiSubscriptionNeedsIsolatedLogin(connection.config)) unavailable();
  return metadata.data;
}
function rootCredential(selection: AiCredentialSelection) {
  const refs = selection.grant.credentialSecretRefs.filter(ref => ref.configPath === "ai.credential");
  if (refs.length !== 1 || !refs[0]?.secretId) unavailable();
}

/** Resolve only credential custody. The caller must still authorize the native
 * target grant, responsible user and agent installation. This reads a fixed
 * number of local database records; it never contacts a provider or reads a
 * secret. `lock` is for a caller-owned transaction and takes NOWAIT share locks
 * before checking current authority, including after any earlier caller wait.
 *
 * This is execution authority, not a cleanup fallback. Revocation must settle
 * existing credential handoffs before disabling their account/link. */
export async function resolveAiCredentialOwner(
  db: Db, selected: AiCredentialSelection, options: { lock?: boolean } = {},
): Promise<AiCredentialOwner> {
  const lock = options.lock === true;
  const noWait = { noWait: true } as const;
  nativeIdentity(selected);
  try {
    const linkQuery = db.select().from(aiWorkspaceAccountLinks).where(or(
      eq(aiWorkspaceAccountLinks.grantId, selected.grant.id),
      eq(aiWorkspaceAccountLinks.connectionId, selected.connection.id),
    )).limit(2);
    const links = await (lock ? linkQuery.for("share", noWait) : linkQuery);
    if (links.length > 1) unavailable();
    const link = links[0];
    if (link && (link.companyId !== selected.connection.companyId || link.connectionId !== selected.connection.id
      || link.grantId !== selected.grant.id || !link.enabled || link.revision < 1)) unavailable();
    const accountQuery = db.select().from(aiWorkspaceAccounts).where(link
      ? eq(aiWorkspaceAccounts.id, link.accountId)
      : eq(aiWorkspaceAccounts.sourceGrantId, selected.grant.id)).limit(1);
    const [account] = await (lock ? accountQuery.for("share", noWait) : accountQuery);
    if (!account) {
      if (link || selected.connection.config.aiWorkspaceAccount === true) unavailable();
      // A disappeared alias relation has no local credential to fall back to.
      // Preserve genuine no-auth API connections, which never carry a secret.
      const metadata = aiConnectionMetadataSchema.safeParse(selected.connection.config.ai);
      if (metadata.success && metadata.data.routing?.auth === "none") return selected;
      rootCredential(selected);
      return selected;
    }
    if (!account.enabled || account.revision < 1) unavailable();
    if (!link && (account.sourceCompanyId !== selected.connection.companyId
      || account.sourceConnectionId !== selected.connection.id || account.sourceGrantId !== selected.grant.id)) unavailable();

    const companyIds = [...new Set([account.sourceCompanyId, selected.connection.companyId])].sort();
    const companyQuery = db.select().from(companies).where(inArray(companies.id, companyIds)).orderBy(companies.id);
    const currentCompanies = await (lock ? companyQuery.for("share", noWait) : companyQuery);
    if (currentCompanies.length !== companyIds.length || currentCompanies.some(company => company.status !== "active")) unavailable();
    const userQuery = db.select().from(authUsers).where(eq(authUsers.id, account.ownerUserId));
    const [owner] = await (lock ? userQuery.for("share", noWait) : userQuery);
    if (!owner || owner.approvalStatus !== "approved") unavailable();
    const membershipsQuery = db.select().from(companyMemberships).where(and(
      inArray(companyMemberships.companyId, companyIds), eq(companyMemberships.principalType, "user"),
      eq(companyMemberships.principalId, account.ownerUserId),
    )).orderBy(companyMemberships.companyId);
    const memberships = await (lock ? membershipsQuery.for("share", noWait) : membershipsQuery);
    if (memberships.length !== companyIds.length || memberships.some(member => member.status !== "active" || member.membershipRole === "viewer")) unavailable();
    // Lock explicit permission rows before the native authorization owner reads
    // them. Role defaults remain owned by that service, not reimplemented here.
    const permissionsQuery = db.select().from(principalPermissionGrants).where(and(
      inArray(principalPermissionGrants.companyId, companyIds), eq(principalPermissionGrants.principalType, "user"),
      eq(principalPermissionGrants.principalId, account.ownerUserId), eq(principalPermissionGrants.permissionKey, "tools:manage_connections"),
    )).orderBy(principalPermissionGrants.companyId);
    await (lock ? permissionsQuery.for("share", noWait) : permissionsQuery);
    for (const companyId of companyIds) {
      const authority = await authorizationService(db).decidePrincipalGrant({ companyId, principalType: "user",
        principalId: account.ownerUserId, action: "tools:manage_connections", permissionKey: "tools:manage_connections" });
      if (!authority.allowed) unavailable();
    }

    const connectionIds = [...new Set([account.sourceConnectionId, selected.connection.id])].sort();
    const connectionQuery = db.select().from(toolConnections).where(inArray(toolConnections.id, connectionIds)).orderBy(toolConnections.id);
    const connections = await (lock ? connectionQuery.for("share", noWait) : connectionQuery);
    const grantIds = [...new Set([account.sourceGrantId, selected.grant.id])].sort();
    const grantQuery = db.select().from(connectionGrants).where(inArray(connectionGrants.id, grantIds)).orderBy(connectionGrants.id);
    const grants = await (lock ? grantQuery.for("share", noWait) : grantQuery);
    const sourceConnection = connections.find(row => row.id === account.sourceConnectionId);
    const sourceGrant = grants.find(row => row.id === account.sourceGrantId);
    const targetConnection = connections.find(row => row.id === selected.connection.id);
    const targetGrant = grants.find(row => row.id === selected.grant.id);
    if (!sourceConnection || !sourceGrant || !targetConnection || !targetGrant
      || sourceConnection.companyId !== account.sourceCompanyId || targetConnection.companyId !== selected.connection.companyId) unavailable();
    const source = { connection: sourceConnection, grant: sourceGrant };
    const target = { connection: targetConnection, grant: targetGrant };
    const sourceMetadata = activeSubscription(source), targetMetadata = activeSubscription(target);
    if (!isDeepStrictEqual(sourceMetadata, targetMetadata)
      || !isDeepStrictEqual(aiConnectionMetadataSchema.safeParse(selected.connection.config.ai).data, targetMetadata)) unavailable();
    rootCredential(source);

    const nestedQuery = db.select().from(aiWorkspaceAccountLinks).where(or(
      eq(aiWorkspaceAccountLinks.grantId, account.sourceGrantId),
      eq(aiWorkspaceAccountLinks.connectionId, account.sourceConnectionId),
    )).limit(1);
    if ((await (lock ? nestedQuery.for("share", noWait) : nestedQuery)).length
      || sourceConnection.config.aiWorkspaceAccount === true) unavailable();
    const sourceMembership = memberships.find(row => row.companyId === account.sourceCompanyId)!;
    if (sourceGrant.kind === "organization" ? sourceMembership.membershipRole !== "owner"
      : sourceGrant.kind !== "user" || sourceGrant.subjectUserId !== account.ownerUserId) unavailable();
    const audienceQuery = db.select().from(connectionGrantMembers).where(and(
      eq(connectionGrantMembers.companyId, account.sourceCompanyId), eq(connectionGrantMembers.grantId, account.sourceGrantId),
    )).orderBy(connectionGrantMembers.id);
    const audience = await (lock ? audienceQuery.for("share", noWait) : audienceQuery);
    if (sourceGrant.kind === "organization" && audience.length && !audience.some(member => member.subjectType === "user" && member.subjectId === account.ownerUserId)) unavailable();
    if (link) {
      if (targetGrant.kind !== "organization" || memberships.find(row => row.companyId === link.companyId)?.membershipRole !== "owner"
        || targetGrant.credentialSecretRefs.length || targetConnection.credentialSecretRefs.length || targetConnection.credentialRefs.length) unavailable();
    }
    return { ...source, binding: { accountId: account.id, accountRevision: account.revision,
      linkId: link?.id ?? null, linkRevision: link?.revision ?? null } };
  } catch (error) {
    let cause: unknown = error;
    for (let depth = 0; depth < 4 && cause && typeof cause === "object"; depth++) {
      const value = cause as { code?: unknown; cause?: unknown };
      if (value.code === "55P03") throw unprocessable("The AI account is changing. Retry shortly.", { code: "ai_connection_busy" });
      cause = value.cause;
    }
    throw error;
  }
}
