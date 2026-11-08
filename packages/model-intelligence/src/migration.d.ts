import type { ModelBackupManifest, ModelBackupInventoryOptions } from "./migration-manifest.js";
export { inspectModelIntelligenceBackup, verifyModelIntelligenceBackup } from "./migration-manifest.js";
export interface ModelMigrationProgress { table_name: string; last_rowid: string | null; row_count: string }
export interface ModelMigrationResult {
  destinationId: string;
  manifestSha256: string;
  state: "imported_unaccepted";
  rows: number;
  runtimeEnabled: false;
}
export type ModelMigrationValue = string | number | boolean | null;
/** Narrow postgres.js query/transaction contract; the caller owns TLS,
 * credentials, destination qualification, pool lifetime and authorization. */
export interface ModelMigrationSql {
  unsafe(text: string, parameters?: ModelMigrationValue[]): PromiseLike<Record<string, unknown>[]>;
}
export interface ModelMigrationConnection extends ModelMigrationSql {
  begin<T>(work: (tx: ModelMigrationSql) => Promise<T>): PromiseLike<T>;
}
export interface ModelMigrationTarget {
  initialize(): Promise<{ destinationId: string; state: "empty" | "importing" | "imported_unaccepted"; runtimeEnabled: false }>;
  start(manifest: ModelBackupManifest): Promise<{ state: "importing" | "imported_unaccepted"; progress: ModelMigrationProgress[] }>;
  writeBatch(manifest: ModelBackupManifest, table: string, after: string | null, rows: Array<Array<string | null>>): Promise<{ lastRowid: string }>;
  finish(manifest: ModelBackupManifest): Promise<ModelMigrationResult>;
}
export function createPostgresMigrationTarget(sql: ModelMigrationConnection, identity: { destinationId: string }): ModelMigrationTarget;
/** Cancellation is checked between bounded batches; an in-flight destination
 * transaction may commit before it is observed. Retry retains the same IDs. */
export function importModelIntelligenceBackup(path: string, manifest: ModelBackupManifest,
  destination: Pick<ModelMigrationTarget, "start" | "writeBatch" | "finish">,
  options?: ModelBackupInventoryOptions & { batchRows?: number; maxBatchBytes?: number; signal?: AbortSignal }): Promise<ModelMigrationResult>;
