import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { toolConnections, type Db } from "@paperclipai/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toolAccessService } from "./tool-access.js";

const mocks = vi.hoisted(() => ({ sync: vi.fn(async () => undefined), slot: vi.fn(async () => undefined), emit: vi.fn() }));
vi.mock("./tool-access/oauth/credential-store.js", () => ({ createOAuthCredentialStore: () => ({ syncCredentialBindings: mocks.sync }) }));
vi.mock("./tool-access/runtime/slots.js", () => ({ createToolRuntimeSlots: () => ({ ensureRuntimeSlot: mocks.slot }) }));
vi.mock("./connector-telemetry.js", async original => ({ ...await original<typeof import("./connector-telemetry.js")>(), emitConnectionUpdated: mocks.emit }));
beforeEach(() => vi.clearAllMocks());

function fixture(enrollAtFence = false) {
  const id = "7536c942-4b27-40c5-8f4e-1442a4fcaa87", companyId = "64b68e80-f001-431f-a752-8a760153cba8";
  const now = new Date().toISOString();
  let current: Record<string, unknown> = { id, companyId, applicationId: "app", uid: "connection", name: "Old name", connectionPurpose: "ai",
    transport: "runtime_auth", status: "active", enabled: true, config: { ai: { provider: "openai", method: "subscription" } },
    transportConfig: {}, credentialRefs: [], credentialSecretRefs: [], credentialPolicy: "shared", createdAt: now, updatedAt: now };
  let firstRead = true, enrolled = false;
  const queries: { text: string; params: unknown[] }[] = [], columns = getTableColumns(toolConnections);
  const values = (row: Record<string, unknown>) => Object.keys(columns).map(key => row[key] ?? null);
  const db = drizzle(async (text, params) => {
    queries.push({ text, params });
    if (text.includes('from "tool_connections"')) {
      const snapshot = structuredClone(current);
      if (firstRead) {
        firstRead = false;
        // Another lifecycle operation commits after the initial request read.
        current = { ...current, status: "archived", enabled: false,
          config: { ai: { provider: "openai", method: "subscription" }, generation: "current" },
          transportConfig: { generation: "current" }, credentialRefs: [{ secretId: "current-ref" }],
          credentialSecretRefs: [{ secretId: "current-secret-ref", configPath: "credential" }] };
      }
      return { rows: [text.startsWith('select "status" from') ? [snapshot.status] : values(snapshot)] };
    }
    if (text.includes("pg_advisory_xact_lock")) { enrolled = enrollAtFence; return { rows: [] }; }
    if (text.includes('from "ai_workspace_accounts"')) return { rows: enrolled ? [["enrolled-account"]] : [] };
    if (text.includes('from "ai_workspace_account_links"')) return { rows: [] };
    if (text.startsWith('update "tool_connections"')) {
      for (const [, name, parameter] of text.slice(0, text.indexOf(" where ")).matchAll(/"([^"]+)" = \$(\d+)/g)) {
        const key = Object.keys(columns).find(key => columns[key as keyof typeof columns].name === name)!;
        const value = params[Number(parameter) - 1];
        current[key] = columns[key as keyof typeof columns].columnType === "PgJsonb" && typeof value === "string" ? JSON.parse(value) : value;
      }
      return { rows: [values(current)] };
    }
    throw new Error(`Unexpected update query: ${text}`);
  }) as unknown as Db;
  db.transaction = ((work: (tx: Db) => Promise<unknown>) => work(db)) as unknown as Db["transaction"];
  return { id, queries, service: toolAccessService(db, { vercelConnectClient: null }), current: () => current };
}

describe("AI connection cosmetic changes preserve current authority", () => {
  it.each([{ name: "Renamed account" }, { agentInstructions: { enabled: true, text: "Updated instructions" } }])("does not replay stale lifecycle or credential fields for %j", async input => {
    const f = fixture();
    await f.service.updateConnection(f.id, input);
    expect(f.current()).toMatchObject({ ...input, status: "archived", enabled: false,
      config: { generation: "current" }, transportConfig: { generation: "current" },
      credentialRefs: [{ secretId: "current-ref" }], credentialSecretRefs: [{ secretId: "current-secret-ref" }] });
    const write = f.queries.find(query => query.text.startsWith('update "tool_connections"'))!.text.split(" where ")[0];
    expect(write).not.toMatch(/"(status|enabled|config|transport_config|credential_refs|credential_secret_refs|credential_policy)" =/);
    expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({ status: "archived", enabled: false, config: expect.objectContaining({ generation: "current" }) }));
  });

  it("rechecks enrollment after the fence before changing AI status", async () => {
    const f = fixture(true);
    await expect(f.service.updateConnection(f.id, { enabled: false })).rejects.toMatchObject({ details: { code: "workspace_ai_account_managed" } });
    expect(f.queries.some(query => query.text.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(f.queries.some(query => query.text.startsWith('update "tool_connections"'))).toBe(false);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it.each([{ enabled: true }, { status: "active" as const }])("cannot explicitly revive a connection removed after its initial read: %j", async input => {
    const f = fixture();
    await expect(f.service.updateConnection(f.id, input)).rejects.toMatchObject({ details: { code: "ai_connection_removed" } });
    const fence = f.queries.findIndex(query => query.text.includes("pg_advisory_xact_lock"));
    const recheck = f.queries.findIndex(query => query.text.startsWith('select "status" from "tool_connections"'));
    expect(fence).toBeGreaterThanOrEqual(0);
    expect(recheck).toBeGreaterThan(fence);
    expect(f.queries[recheck].text).toContain("for update");
    expect(f.queries.some(query => query.text.startsWith('update "tool_connections"'))).toBe(false);
    expect(f.current()).toMatchObject({ status: "archived", enabled: false });
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.slot).not.toHaveBeenCalled();
  });
});
