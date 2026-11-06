// @vitest-environment jsdom
import { webcrypto, createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { platformChangesApi } from "./platform-changes";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const document = { companyId: "business", source: { kind: "document" as const, issueId: "task", documentId: "doc", revisionId: "old" } };
const attachment = { companyId: "business", source: { kind: "attachment" as const, issueId: "task", attachmentId: "file" } };
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());

it("rereads the exact native revision with account-sensitive requests, never substitutes latest", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ text: "Selected café", sha256: digest("Selected café") }));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  expect(await platformChangesApi.source(document, controller.signal)).toEqual({ text: "Selected café", sha256: digest("Selected café") });
  expect(fetch.mock.calls).toEqual([
    ["/api/companies/business/friday/platform-component-sources/task/documents/doc/revisions/old", expect.objectContaining({ cache: "no-store", signal: controller.signal })],
  ]);
});
it("does not fall back to another revision or history after the exact source is denied", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ error: "Component source not found" }, { status: 404 }));
  vi.stubGlobal("fetch", fetch);
  await expect(platformChangesApi.source(document)).rejects.toThrow("Component source not found");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("reads HTML as literal text from the native file owner and verifies its immutable hash", async () => {
  const text = "\uFEFF<script>window.privateData='café never executed'</script>";
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const fetch = vi.fn().mockResolvedValueOnce(Response.json([{ id: "file", companyId: "business", issueId: "task", contentType: "text/html", byteSize: text.length, sha256: digest(text), contentPath: "https://foreign.test/secret" }]))
    .mockResolvedValueOnce(new Response(stream));
  vi.stubGlobal("fetch", fetch);
  expect(await platformChangesApi.source(attachment)).toEqual({ text, sha256: digest(text) });
  expect(fetch.mock.calls[1][0]).toBe("/api/attachments/file/content");
  expect((window as unknown as { privateData?: string }).privateData).toBeUndefined();
});
it("rejects altered bytes, binary data and oversized source streams", async () => {
  const metadata = [{ id: "file", companyId: "business", issueId: "task", contentType: "text/html", byteSize: 1, sha256: digest("expected") }];
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(metadata)).mockResolvedValueOnce(new Response("altered"));
  vi.stubGlobal("fetch", fetch);
  await expect(platformChangesApi.source(attachment)).rejects.toThrow("saved hash");
  fetch.mockResolvedValueOnce(Response.json(metadata)).mockResolvedValueOnce(new Response(new Uint8Array([0xff])));
  await expect(platformChangesApi.source(attachment)).rejects.toThrow();
  fetch.mockResolvedValueOnce(Response.json(metadata)).mockResolvedValueOnce(new Response("x".repeat(262_145)));
  await expect(platformChangesApi.source(attachment)).rejects.toThrow("256 KiB");
});
it("does not coalesce company inventories across accounts", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(Response.json([]))));
  await Promise.all([platformChangesApi.companies(), platformChangesApi.companies()]);
  expect(fetch).toHaveBeenCalledTimes(2);
});
