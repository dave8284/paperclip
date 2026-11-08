export interface ModelBackupManifest {
  schema: "agentos.model-intelligence-backup-manifest.v1";
  purpose: "offline_inventory_only";
  userVersion: 5;
  fileBytes: string;
  fileSha256: string;
  schemaSha256: string;
  totalRows: number;
  tables: Array<{
    name: string;
    columns: Array<{ cid: number; name: string; type: string; notnull: number; pk: number; hidden: number; defaultExpressionSha256: string | null }>;
    rows: number;
    rowidMinimum: string | null;
    rowidMaximum: string | null;
    contentSha256: string;
  }>;
  manifestSha256: string;
}
export interface ModelBackupInventoryOptions { maxRows?: number; maxCellBytes?: number }
/** Offline operator use only. Scans all rows synchronously within an async file
 * integrity check; never call on the live HTTP/runtime thread. Does not upgrade,
 * export, checkpoint, import or accept a migration. */
export function inspectModelIntelligenceBackup(path: string, options?: ModelBackupInventoryOptions): Promise<ModelBackupManifest>;
export function verifyModelIntelligenceBackup(path: string, manifest: unknown, options?: ModelBackupInventoryOptions): Promise<ModelBackupManifest>;
