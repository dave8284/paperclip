import type { ModelIntelligence } from "./index.js";
import type { ModelBackupManifest } from "./migration-manifest.js";
import type { ModelMigrationConnection } from "./migration.js";

export type AsyncModelIntelligence = {
  [K in keyof ModelIntelligence]: K extends "subscribeRoutingWork" ? ModelIntelligence[K]
    : ModelIntelligence[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<R> : never;
};
export interface ModelStorageIdentity { destinationId: string; activationId: string; manifestSha256: string }
export class ModelStorageError extends Error { code?: string }
/** Opens an explicitly accepted destination; never migrates or activates it.
 * The caller owns TLS, credentials, pool sizing, connection timeouts and end(). */
export function createPostgresModelIntelligence(sql: ModelMigrationConnection, identity: ModelStorageIdentity): Promise<AsyncModelIntelligence>;
/** Operator-only mutation after external rehearsal review. The acceptance
 * reference locates that review; merely supplying a string is not proof. */
export function activatePostgresModelIntelligence(sql: ModelMigrationConnection,
  input: Omit<ModelStorageIdentity, "manifestSha256"> & { manifest: ModelBackupManifest; acceptanceRef: string }): Promise<ModelStorageIdentity & { active: true }>;
/** Stops subsequent writes and waits for currently admitted writes to commit. */
export function deactivatePostgresModelIntelligence(sql: ModelMigrationConnection, identity: ModelStorageIdentity): Promise<ModelStorageIdentity & { active: false }>;
