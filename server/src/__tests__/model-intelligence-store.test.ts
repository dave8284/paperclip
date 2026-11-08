import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createDb: vi.fn(), createPostgres: vi.fn(), close: vi.fn(), end: vi.fn() }));
vi.mock("@paperclipai/db", () => ({ createDb: mocks.createDb }));
vi.mock("@agentos/model-intelligence/postgres", () => ({ createPostgresModelIntelligence: mocks.createPostgres }));
import { initializeModelIntelligenceStore, closeModelIntelligenceStore, modelIntelligenceProduct } from "../services/model-intelligence-store.js";

const keys = ["AGENTOS_MODEL_INTELLIGENCE_DB", "AGENTOS_MODEL_INTELLIGENCE_POSTGRES_URL", "AGENTOS_MODEL_INTELLIGENCE_DESTINATION_ID",
  "AGENTOS_MODEL_INTELLIGENCE_ACTIVATION_ID", "AGENTOS_MODEL_INTELLIGENCE_MANIFEST_SHA256"];
const remote = () => {
  vi.stubEnv(keys[1], "postgres://fixture:private-password@fixture.invalid/model");
  vi.stubEnv(keys[2], "00000000-0000-4000-8000-000000000001");
  vi.stubEnv(keys[3], "00000000-0000-4000-8000-000000000002"); vi.stubEnv(keys[4], "a".repeat(64));
};
beforeEach(() => {
  vi.clearAllMocks(); for (const key of keys) vi.stubEnv(key, "");
  mocks.end.mockResolvedValue(undefined); mocks.close.mockResolvedValue(undefined);
  mocks.createDb.mockReturnValue({ $client: { end: mocks.end } });
  mocks.createPostgres.mockResolvedValue({ close: mocks.close, analytics: vi.fn() });
});
afterEach(async () => { await closeModelIntelligenceStore(); vi.unstubAllEnvs(); });

describe("Model Intelligence store lifecycle", () => {
  it("does no remote work when unconfigured and preserves the synchronous SQLite API", async () => {
    await initializeModelIntelligenceStore(); expect(modelIntelligenceProduct()).toBeNull(); expect(mocks.createDb).not.toHaveBeenCalled();
    vi.stubEnv(keys[0], ":memory:");
    expect(modelIntelligenceProduct()?.analytics()).toMatchObject({ counts: { selections: 0 } });
    expect(mocks.createPostgres).not.toHaveBeenCalled();
  });
  it("rejects ambiguous or partial remote configuration before opening a connection", async () => {
    vi.stubEnv(keys[1], "postgres://fixture.invalid/model");
    await expect(initializeModelIntelligenceStore()).rejects.toThrow("Configure one");
    remote(); vi.stubEnv(keys[0], ":memory:");
    await expect(initializeModelIntelligenceStore()).rejects.toThrow("Configure one"); expect(mocks.createDb).not.toHaveBeenCalled();
  });
  it("shares pending startup and publishes the handle only after acceptance verification", async () => {
    remote(); let release!: (value: unknown) => void;
    mocks.createPostgres.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const first = initializeModelIntelligenceStore(), second = initializeModelIntelligenceStore();
    expect(() => modelIntelligenceProduct()).toThrow("startup initialization"); expect(mocks.createDb).toHaveBeenCalledTimes(1);
    const store = { close: mocks.close }; release(store); await Promise.all([first, second]);
    expect(modelIntelligenceProduct()).toBe(store);
    expect(mocks.createDb).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ maxConnections: 4, idleTimeoutSeconds: 60, connectTimeoutSeconds: 5 }));
    vi.stubEnv(keys[0], ":memory:"); await expect(initializeModelIntelligenceStore()).rejects.toThrow("startup initialization");
    vi.stubEnv(keys[0], ""); vi.stubEnv(keys[3], "changed"); expect(() => modelIntelligenceProduct()).toThrow("startup initialization");
    for (const key of keys) vi.stubEnv(key, "");
    await expect(initializeModelIntelligenceStore()).rejects.toThrow("startup initialization");
  });
  it("cleans a failed startup pool and strips private parser/driver errors", async () => {
    remote(); mocks.createPostgres.mockRejectedValue(new Error("private-password private-host secret SQL"));
    await expect(initializeModelIntelligenceStore()).rejects.toThrow("initialization failed");
    expect(mocks.end).toHaveBeenCalledWith({ timeout: 5 }); expect(() => modelIntelligenceProduct()).toThrow("startup initialization");
    mocks.createDb.mockImplementation(() => { throw new Error("private-password invalid URL"); });
    await expect(initializeModelIntelligenceStore()).rejects.toMatchObject({ message: "Model Intelligence PostgreSQL initialization failed; verify the accepted destination configuration" });
  });
  it("shutdown awaits admitted storage work before closing its pool", async () => {
    remote(); await initializeModelIntelligenceStore(); let release!: () => void;
    mocks.close.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
    const pending = closeModelIntelligenceStore(); await Promise.resolve();
    expect(mocks.end).not.toHaveBeenCalled(); release(); await pending;
    expect(mocks.end).toHaveBeenCalledOnce();
  });
});
