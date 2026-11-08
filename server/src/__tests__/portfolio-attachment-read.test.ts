import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { portfolioAttachmentQuerySchema } from "@paperclipai/shared";
import { createLocalDiskStorageProvider } from "../storage/local-disk-provider.js";
import { createStorageService } from "../storage/service.js";
import type { StorageService } from "../storage/types.js";
import { readPortfolioAttachmentChunk, samePortfolioAttachment } from "../services/portfolio-attachment-read.js";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(body = Buffer.from("a company-private file")) {
  const root = await mkdtemp(path.join(os.tmpdir(), "portfolio-attachment-")); roots.push(root);
  const storage = createStorageService(createLocalDiskStorageProvider(root));
  const targetCompanyId = randomUUID(), taskId = randomUUID(), attachmentId = randomUUID();
  const stored = await storage.putFile({ companyId: targetCompanyId, namespace: `issues/${taskId}`,
    originalFilename: "private.bin", contentType: "application/octet-stream", body });
  const source = { ...stored, attachmentId, taskId, assetId: randomUUID(), filename: stored.originalFilename };
  const query = portfolioAttachmentQuerySchema.parse({ mandateId: randomUUID(), revision: 1, targetCompanyId, taskId, attachmentId, sha256: stored.sha256 });
  return { storage, source, query, body };
}
describe("bounded portfolio attachment storage", () => {
  it("verifies a complete small file through the real storage service and local provider", async () => {
    const f = await fixture();
    const result = await readPortfolioAttachmentChunk(f.storage, f.source, f.query);
    expect(Buffer.from(result.body, "base64")).toEqual(f.body);
    expect(result).toMatchObject({ fullFileVerified: true, nextOffset: null, chunkSha256: f.source.sha256 });
  });
  it("reads stable bounded ranges and distinguishes chunk proof from whole-file verification", async () => {
    const f = await fixture(Buffer.from("😀file".repeat(20_000))), parts: Buffer[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const result = await readPortfolioAttachmentChunk(f.storage, f.source, { ...f.query, offset, limit: 65536 });
      const bytes = Buffer.from(result.body, "base64"); parts.push(bytes);
      expect(bytes.length).toBeLessThanOrEqual(65536); expect(result.chunkSha256).toBe(hash(bytes));
      expect(result.fullFileVerified).toBe(false); offset = result.nextOffset;
    }
    expect(hash(Buffer.concat(parts))).toBe(f.source.sha256); expect(Buffer.concat(parts)).toEqual(f.body);
  });
  it("rejects corrupted full-file bytes even when their size is unchanged", async () => {
    const f = await fixture();
    const storage = { provider: f.storage.provider, getObject: vi.fn(async () => ({ stream: Readable.from([Buffer.alloc(f.body.length)]), contentLength: f.body.length })) };
    await expect(readPortfolioAttachmentChunk(storage, f.source, f.query)).rejects.toMatchObject({ status: 409 });
  });
  it.each(["short", "oversized", "header"])("rejects a %s storage range", async kind => {
    const f = await fixture();
    const stream = Readable.from([Buffer.alloc(kind === "short" ? 1 : kind === "oversized" ? f.body.length + 1 : f.body.length)]);
    const storage = { provider: f.storage.provider, getObject: vi.fn(async () => ({ stream, ...(kind === "header" ? { contentLength: 999 } : {}) })) };
    await expect(readPortfolioAttachmentChunk(storage, f.source, f.query)).rejects.toMatchObject({ status: 409 });
    expect(stream.destroyed).toBe(true);
  });
  it("cancels a stalled response stream on the real request deadline", async () => {
    const f = await fixture(), stream = new Readable({ read() {} });
    const storage = { provider: f.storage.provider, getObject: vi.fn<StorageService["getObject"]>(async () => ({ stream })) };
    await expect(readPortfolioAttachmentChunk(storage, f.source, f.query, { timeoutMs: 15 })).rejects.toMatchObject({ status: 503 });
    expect(stream.destroyed).toBe(true); expect(storage.getObject.mock.calls[0][2]?.signal?.aborted).toBe(true);
  });
  it("destroys a late storage response after cancellation without exposing bytes", async () => {
    const f = await fixture(), abort = new AbortController(), stream = Readable.from([f.body]);
    let finish!: (value: { stream: Readable }) => void;
    const storage = { provider: f.storage.provider, getObject: vi.fn(() => new Promise<{ stream: Readable }>(resolve => { finish = resolve; })) };
    const pending = readPortfolioAttachmentChunk(storage, f.source, f.query, { signal: abort.signal });
    abort.abort(); await expect(pending).rejects.toMatchObject({ status: 503 });
    finish({ stream }); await new Promise(resolve => setImmediate(resolve)); expect(stream.destroyed).toBe(true);
  });
  it("rejects invalid versions/ranges before contacting storage and sanitizes provider errors", async () => {
    const f = await fixture(), getObject = vi.fn(async () => { throw new Error("s3://private-bucket/secret-key"); });
    for (const patch of [{ offset: f.body.length }, { offset: -1 }, { limit: 65537 }, { sha256: "b".repeat(64) }])
      await expect(readPortfolioAttachmentChunk({ provider: f.storage.provider, getObject }, f.source, { ...f.query, ...patch })).rejects.toBeDefined();
    expect(getObject).not.toHaveBeenCalled();
    await expect(readPortfolioAttachmentChunk({ provider: f.storage.provider, getObject }, f.source, f.query))
      .rejects.toMatchObject({ status: 503, message: "Attachment storage is unavailable; retry if still authorized" });
  });
  it("binds reauthorization to storage identity and bytes without retaining a stale filename", async () => {
    const f = await fixture();
    expect(samePortfolioAttachment(f.source, { ...f.source, filename: "renamed.bin" })).toBe(true);
    for (const patch of [{ objectKey: "different" }, { provider: "s3" }, { assetId: randomUUID() }, { byteSize: 1 },
      { sha256: "b".repeat(64) }, { taskId: randomUUID() }, { contentType: "text/plain" }])
      expect(samePortfolioAttachment(f.source, { ...f.source, ...patch })).toBe(false);
  });
});
