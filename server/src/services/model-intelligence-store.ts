import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createDb } from "@paperclipai/db";
import { createModelIntelligence, type ModelIntelligence } from "@agentos/model-intelligence";
import { createPostgresModelIntelligence, type AsyncModelIntelligence } from "@agentos/model-intelligence/postgres";
import type { ModelMigrationConnection } from "@agentos/model-intelligence/migration";

type Store = ModelIntelligence | AsyncModelIntelligence;
let product: Store | null = null;
let currentPath: string | undefined;
let remote: ReturnType<typeof createDb> | null = null;
let initialization: Promise<void> | null = null;
let acceptedConfiguration: string | null = null;
const remoteKeys = ["AGENTOS_MODEL_INTELLIGENCE_POSTGRES_URL", "AGENTOS_MODEL_INTELLIGENCE_DESTINATION_ID",
  "AGENTOS_MODEL_INTELLIGENCE_ACTIVATION_ID", "AGENTOS_MODEL_INTELLIGENCE_MANIFEST_SHA256"] as const;
const configured = () => remoteKeys.some(key => !!process.env[key]);
const configuration = () => JSON.stringify(remoteKeys.map(key => process.env[key] ?? null));

/** Synchronous handle lookup; operations may await the independent store.
 * Remote initialization belongs to startup, never a request-time reconnect or
 * implicit migration. Driver pooling handles ordinary idle reconnection. */
export function modelIntelligenceProduct(): Store | null {
  if (configured() || remote) {
    if (!remote || !product || process.env.AGENTOS_MODEL_INTELLIGENCE_DB || acceptedConfiguration !== configuration()) throw new Error("Model Intelligence PostgreSQL configuration requires successful startup initialization");
    return product;
  }
  const path = process.env.AGENTOS_MODEL_INTELLIGENCE_DB;
  if (!path) return null;
  if (!product || path !== currentPath) {
    if (product) void product.close();
    mkdirSync(dirname(path), { recursive: true }); product = createModelIntelligence(path); currentPath = path;
  }
  return product;
}

export async function initializeModelIntelligenceStore(): Promise<void> {
  if (initialization) return initialization;
  if (remote) { modelIntelligenceProduct(); return; }
  if (!configured()) return;
  if (process.env.AGENTOS_MODEL_INTELLIGENCE_DB || remoteKeys.some(key => !process.env[key])) throw new Error("Configure one Model Intelligence store and all accepted PostgreSQL identities");
  const selectedConfiguration = configuration();
  initialization = (async () => {
    // Host owns a separate bounded pool through the shared database lifecycle.
    // The independent package receives only its narrow SQL connection port.
    let db: ReturnType<typeof createDb> | null = null;
    try {
      db = createDb(process.env.AGENTOS_MODEL_INTELLIGENCE_POSTGRES_URL!, {
        maxConnections: 4, idleTimeoutSeconds: 60, connectTimeoutSeconds: 5, prepare: false,
        applicationName: "agentos-model-intelligence",
      });
      const store = await createPostgresModelIntelligence(db.$client as unknown as ModelMigrationConnection, {
        destinationId: process.env.AGENTOS_MODEL_INTELLIGENCE_DESTINATION_ID!,
        activationId: process.env.AGENTOS_MODEL_INTELLIGENCE_ACTIVATION_ID!,
        manifestSha256: process.env.AGENTOS_MODEL_INTELLIGENCE_MANIFEST_SHA256!,
      });
      if (selectedConfiguration !== configuration()) { await store.close(); throw new Error("Model Intelligence configuration changed during startup"); }
      await product?.close(); product = store; remote = db; acceptedConfiguration = selectedConfiguration;
    } catch {
      await db?.$client.end({ timeout: 5 }).catch(() => {});
      // URL parsing and connection setup may echo credentials. Startup logs
      // receive this bounded message, never the driver's error or cause.
      throw new Error("Model Intelligence PostgreSQL initialization failed; verify the accepted destination configuration");
    }
  })();
  try { await initialization; } finally { initialization = null; }
}

export async function closeModelIntelligenceStore(): Promise<void> {
  await initialization?.catch(() => {});
  const store = product, db = remote;
  product = null; remote = null; currentPath = undefined; acceptedConfiguration = null;
  try { await store?.close(); } finally { await db?.$client.end({ timeout: 5 }); }
}
